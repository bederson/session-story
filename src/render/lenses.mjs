import { escapeHtml, renderEdit, renderViews } from './diff.mjs';
import { icon } from './icons.mjs';
import { buildFileBases } from '../ir/file-state.mjs';

// Reconstructed pre-edit file texts, memoised per story: all three lenses
// need them and chaining is pure string work.
const BASES = new WeakMap();
function basesFor(story) {
  if (!BASES.has(story)) BASES.set(story, buildFileBases(story));
  return BASES.get(story);
}

/** Edits to files that live inside the project directory. */
function inProject(edits) {
  return edits.filter((edit) => !edit.outside_cwd);
}

/**
 * Every number that depends on the scope filter is rendered twice, once
 * for each scope; CSS shows whichever matches the current toggle, so the
 * page needs no arithmetic of its own.
 */
export function dual(inValue, allValue) {
  return `<span class="v-in">${inValue}</span><span class="v-all">${allValue}</span>`;
}

const MINUS = '−'; // U+2212, reads as a proper minus next to "+"

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function formatTokens(n) {
  if (!isNum(n)) return null;
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1e6).toFixed(1)}M`;
}

export function formatCost(usd) {
  if (!isNum(usd)) return null;
  return usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`;
}

/** Input tokens including cache reads and writes, or null if any part is unknown. */
export function inputWithCache(u) {
  const parts = [u.input_tokens, u.cache_read_tokens, u.cache_creation_tokens];
  return parts.every(isNum) ? parts.reduce((a, b) => a + b, 0) : null;
}

/**
 * The three usage numbers the header and the library show, from
 * `story.metrics.usage`; each is null when the session did not record it.
 */
export function usageTotals(story) {
  const u = (story && story.metrics && story.metrics.usage) || {};
  return {
    input_tokens: inputWithCache(u),
    output_tokens: isNum(u.output_tokens) ? u.output_tokens : null,
    cost_usd: isNum(u.total_cost_usd) ? u.total_cost_usd : null,
  };
}

/** Stat tiles for token usage and cost; tiles for unknown values are left out. */
function usageTiles(story) {
  const u = usageTotals(story);
  const input = formatTokens(u.input_tokens);
  const output = formatTokens(u.output_tokens);
  const cost = formatCost(u.cost_usd);
  return (
    (input ? statTile('sparkle', input, 'input tokens incl. cache') : '') +
    (output ? statTile('sparkle', output, 'output tokens') : '') +
    (cost ? statTile('cost', cost, 'cost') : '')
  );
}
export const OUTCOME_LABELS = { completed: 'Completed', partial: 'Partial', failed: 'Failed', blocked: 'Blocked' };

function shortSha(sha) {
  return sha ? sha.slice(0, 7) : '';
}

/** Longest title we render; Claude is asked to stay under it too. */
const TITLE_MAX = 60;

/**
 * What to call this session. Used for the page <title>, the header heading,
 * the library filename slug, and the index card. In order: the title Claude
 * wrote, then the harness's own `ai-title` for the session, then the first
 * *line* of the first prompt — prompts are often multi-line pastes, and only
 * their opening line reads as a title. Everything but Claude's title, which
 * is length-checked in strict validation, is clamped to TITLE_MAX.
 */
export function storyTitle(story) {
  if (story.session.title) return story.session.title;
  if (story.session.ai_title) return clampTitle(story.session.ai_title);
  const firstPrompt = story.turns[0] ? story.turns[0].prompt : 'Session story';
  return clampTitle(firstPrompt.split('\n')[0].trim() || 'Session story');
}

function clampTitle(text) {
  return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX)}…` : text;
}

export function formatDuration(ms) {
  if (!ms) return '0m';
  const totalMinutes = Math.round(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

/**
 * When a session ran, start to end: "2026-09-10 10:00 → 10:05 UTC". The end
 * repeats the date only when the session crossed midnight.
 */
export function formatRange(startIso, endIso) {
  const start = formatDate(startIso);
  const end = formatDate(endIso);
  if (!start || !end || end === start) return start;
  const endShown = end.slice(0, 10) === start.slice(0, 10) ? end.slice(11) : end;
  return `${start.slice(0, -4)} → ${endShown}`;
}

export function plural(n, word) {
  return `${word}${n === 1 ? '' : 's'}`;
}

function excerpt(text, max = 120) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function statsOf(edits) {
  return edits.reduce(
    (acc, e) => ({ added: acc.added + e.stats.added, removed: acc.removed + e.stats.removed }),
    { added: 0, removed: 0 }
  );
}

/** The busiest turn in each scope, so bars are comparable within a scope. */
function maxTurnTotals(turns) {
  let inMax = 0;
  let allMax = 0;
  for (const turn of turns) {
    const inS = statsOf(inProject(turn.edits));
    const allS = statsOf(turn.edits);
    inMax = Math.max(inMax, inS.added + inS.removed);
    allMax = Math.max(allMax, allS.added + allS.removed);
  }
  return { in: inMax, all: allMax };
}

function pct(value, max) {
  if (!value || !max) return 0;
  return Math.max(1, Math.round((value / max) * 100));
}

function barSegments(added, removed, max) {
  const add = pct(added, max);
  const del = pct(removed, max);
  return (
    (add ? `<span class="bar-add" style="width:${add}%"></span>` : '') +
    (del ? `<span class="bar-del" style="width:${del}%"></span>` : '')
  );
}

/**
 * Per-turn activity bar: added/removed line counts as two thin segments,
 * scaled against the busiest turn in the session so bars compare across
 * turns. The numeric label always accompanies the bar; color never carries
 * the meaning alone.
 */
function renderActivityBar(turn, max) {
  const inS = statsOf(inProject(turn.edits));
  const allS = statsOf(turn.edits);
  const label = (s) => `+${s.added} ${MINUS}${s.removed}`;
  return (
    `<div class="turn-bars">` +
    `<span class="bar-track" data-scope="in">${barSegments(inS.added, inS.removed, max.in)}</span>` +
    `<span class="bar-track" data-scope="all">${barSegments(allS.added, allS.removed, max.all)}</span>` +
    `<span class="bar-label">${dual(label(inS), label(allS))}</span>` +
    `</div>`
  );
}

/**
 * Session strip: one segment per turn, width proportional to how many lines
 * that turn touched, split into its added/removed share. Shows at a glance
 * where in the session the work happened.
 */
function renderStrip(turns, scope) {
  const segments = turns
    .map((turn) => {
      const edits = scope === 'in' ? inProject(turn.edits) : turn.edits;
      const { added, removed } = statsOf(edits);
      const total = added + removed;
      if (total === 0) {
        return `<span class="strip-seg empty" style="flex-grow:1" title="Turn ${turn.index}: no edits"></span>`;
      }
      return (
        `<span class="strip-seg" style="flex-grow:${total}" title="Turn ${turn.index}: +${added} ${MINUS}${removed}">` +
        barSegments(added, removed, total) +
        `</span>`
      );
    })
    .join('');
  return (
    `<div class="session-strip" data-scope="${scope}" role="img" ` +
    `aria-label="Lines changed per turn, left to right">${segments}</div>`
  );
}

function renderSessionStrip(turns) {
  if (turns.length === 0) return '';
  return (
    `<div class="session-strip-wrap">` +
    renderStrip(turns, 'in') +
    renderStrip(turns, 'all') +
    `<div class="strip-caption"><span>turn 1</span><span>turn ${turns.length}</span></div>` +
    `</div>`
  );
}

function renderMotif() {
  return (
    `<svg class="header-motif" viewBox="0 0 640 220" preserveAspectRatio="xMaxYMid slice" aria-hidden="true" focusable="false">` +
    `<defs><pattern id="motif-dots" width="18" height="18" patternUnits="userSpaceOnUse">` +
    `<circle cx="1.5" cy="1.5" r="1.4" fill="currentColor"/></pattern></defs>` +
    `<rect width="640" height="220" fill="url(#motif-dots)" opacity="0.5"/>` +
    `<g fill="none" stroke="currentColor" stroke-width="1.25" opacity="0.7">` +
    `<circle cx="560" cy="110" r="52"/><circle cx="560" cy="110" r="92"/>` +
    `<circle cx="560" cy="110" r="132"/><circle cx="560" cy="110" r="172"/><circle cx="560" cy="110" r="212"/>` +
    `</g>` +
    `<path d="M0 190 C 160 150, 300 210, 640 120" fill="none" stroke="currentColor" stroke-width="1.25" opacity="0.45"/>` +
    `</svg>`
  );
}

export function statTile(name, value, label, extraClass = '') {
  return (
    `<div class="stat-tile${extraClass ? ` ${extraClass}` : ''}">` +
    `<span class="stat-icon">${icon(name)}</span>` +
    `<span class="stat-text"><span class="stat-value">${value}</span> <span class="stat-label">${label}</span></span>` +
    `</div>`
  );
}

export function renderHeader(story) {
  const { session, totals } = story;
  const report = story.report || null;
  const title = storyTitle(story);
  const blindSpots = (session.blind_spots || [])
    .map((b) => `<li>${icon('warning')}<span>${escapeHtml(b)}</span></li>`)
    .join('');
  const started = formatRange(session.started_at, session.ended_at);

  const outcome = report && report.outcome;
  const outcomePill = outcome
    ? `<span class="outcome-pill outcome-${escapeHtml(outcome)}">${OUTCOME_LABELS[outcome] || escapeHtml(outcome)}</span>`
    : '';

  const git = report && report.git;
  const commitRange = git && git.start_commit && git.end_commit
    ? `<span class="commits">${icon('commit')}<span><code>${shortSha(git.start_commit.sha)}</code> → <code>${shortSha(git.end_commit.sha)}</code></span></span>`
    : '';

  const allEdits = story.turns.flatMap((t) => t.edits);
  // A `combined_into` edit repeats a share of another turn's diff; the
  // session totals skip it, so the project-only numbers must too.
  const insideEdits = inProject(allEdits.filter((e) => !e.combined_into));
  const inFiles = new Set(insideEdits.map((e) => e.rel)).size;
  const inStats = statsOf(insideEdits);
  const outsideEdits = allEdits.filter((e) => e.outside_cwd && !e.combined_into);
  const outsideFiles = new Set(outsideEdits.map((e) => e.rel)).size;
  const outsideNote = outsideEdits.length > 0
    ? `<p class="outside-note only-when-filtered">${icon('filter')}<span>` +
      `${outsideFiles} ${plural(outsideFiles, 'file')} outside the project ` +
      `(${outsideEdits.length} ${plural(outsideEdits.length, 'edit')}) hidden — ` +
      `switch off “Project files only” to include ${outsideFiles === 1 ? 'it' : 'them'}.` +
      `</span></p>`
    : '';

  return (
    `<header class="story-header">` +
    renderMotif() +
    `<div class="header-inner">` +
    `<div class="eyebrow">${icon('story')}<span>Session story</span>${outcomePill}</div>` +
    `<h1>${escapeHtml(title)}</h1>` +
    `<div class="meta">` +
    `<span class="cwd">${icon('folder')}<span>${escapeHtml(session.cwd || '')}</span></span>` +
    (session.git_branch ? `<span class="branch">${icon('branch')}<span>${escapeHtml(session.git_branch)}</span></span>` : '') +
    `<span class="duration">${icon('clock')}<span>${formatDuration(session.duration_ms)}${started ? ` · ${started}` : ''}</span></span>` +
    commitRange +
    `</div>` +
    (session.summary ? `<p class="summary">${escapeHtml(session.summary)}</p>` : '') +
    `<div class="totals">` +
    statTile('turns', totals.turns, plural(totals.turns, 'turn')) +
    statTile('files', dual(inFiles, totals.files), plural(totals.files, 'file')) +
    statTile('plus', dual(`+${inStats.added}`, `+${totals.added}`), 'added', 'added') +
    statTile('minus', dual(`${MINUS}${inStats.removed}`, `${MINUS}${totals.removed}`), 'removed', 'removed') +
    usageTiles(story) +
    `</div>` +
    renderSessionStrip(story.turns) +
    outsideNote +
    (blindSpots ? `<ul class="blind-spots">${blindSpots}</ul>` : '') +
    `</div>` +
    `</header>`
  );
}

function fileIsChurned(story, rel) {
  const entry = story.files.find((f) => f.rel === rel);
  return entry ? entry.churn : false;
}

function renderFileChips(story, edits) {
  const seen = new Set();
  return edits
    .filter((edit) => (seen.has(edit.rel) ? false : seen.add(edit.rel)))
    .map((edit) => {
      const churn = fileIsChurned(story, edit.rel) ? ' churn' : '';
      const outside = edit.outside_cwd ? ' data-outside="1"' : '';
      return (
        `<button type="button" class="chip${churn}" data-file="${escapeHtml(edit.rel)}"${outside}` +
        ` title="Jump to this file's changes">${escapeHtml(edit.rel)}</button>`
      );
    })
    .join('');
}

function turnTime(turn) {
  const shown = formatDate(turn.at);
  return shown ? `<time class="turn-time" datetime="${escapeHtml(turn.at)}">${shown}</time>` : '';
}

function panelMeta(turn) {
  const describe = (edits) => {
    const { added, removed } = statsOf(edits);
    const fileCount = new Set(edits.map((e) => e.rel)).size;
    return (
      `<span>${edits.length} ${plural(edits.length, 'edit')}</span> ` +
      `<span>${fileCount} ${plural(fileCount, 'file')}</span> ` +
      `<span class="edit-stats"><span class="add">+${added}</span>` +
      `<span class="del">${MINUS}${removed}</span></span>`
    );
  };
  return `<span class="panel-meta">${dual(describe(inProject(turn.edits)), describe(turn.edits))}</span>`;
}

function editStats({ added, removed }) {
  return `<span class="edit-stats"><span class="add">+${added}</span><span class="del">${MINUS}${removed}</span></span>`;
}

/**
 * Buttons that narrow a turn panel to one file's edits, or back to all of
 * them. The page script does the hiding; a single-file turn gets no bar.
 */
function renderFileFilter(edits) {
  const files = new Map();
  for (const edit of edits) {
    if (!files.has(edit.rel)) files.set(edit.rel, { outside: edit.outside_cwd, edits: [] });
    files.get(edit.rel).edits.push(edit);
  }
  if (files.size < 2) return '';
  const buttons = [...files].map(([rel, { outside, edits: fileEdits }]) =>
    `<button type="button" class="file-filter-btn" data-file-filter="${escapeHtml(rel)}" aria-pressed="false"` +
    `${outside ? ' data-outside="1"' : ''} title="Show only this file's changes">` +
    `<span class="file-filter-name">${escapeHtml(rel)}</span>${editStats(statsOf(fileEdits))}</button>`
  );
  return (
    `<div class="file-filter" role="group" aria-label="Show changes for">` +
    `<button type="button" class="file-filter-btn" data-file-filter="" aria-pressed="true">` +
    `${icon('review')}<span class="file-filter-name">All changes</span>` +
    `${dual(editStats(statsOf(inProject(edits))), editStats(statsOf(edits)))}</button>` +
    buttons.join('') +
    `</div>`
  );
}

/**
 * Review lens: a timeline of turns on the left (numbered node on a rail,
 * full prompt, intent, activity bar, file chips), each linked by data-turn
 * to a panel of that turn's edits. Selection between turns is handled by
 * the page's inline script; every panel is rendered so the page works with
 * JS disabled too (all turns simply show stacked).
 */
export function renderReviewLens(story) {
  const max = maxTurnTotals(story.turns);
  const bases = basesFor(story);
  const timelineItems = story.turns
    .map((turn) => {
      const summaryHtml = turn.summary
        ? `<p class="turn-summary">${escapeHtml(turn.summary)}</p>`
        : '';
      return (
        `<li class="timeline-item" data-turn="${turn.index}" tabindex="0" role="button" aria-pressed="false">` +
        `<div class="turn-index">${turn.index}</div>` +
        `<div class="turn-body">` +
        turnTime(turn) +
        `<blockquote class="turn-prompt">${escapeHtml(turn.prompt)}</blockquote>` +
        summaryHtml +
        renderActivityBar(turn, max) +
        `<div class="turn-chips">${renderFileChips(story, turn.edits)}</div>` +
        `</div>` +
        `</li>`
      );
    })
    .join('');

  const panels = story.turns
    .map((turn) => {
      const editsHtml = turn.edits.length > 0
        ? turn.edits.map((edit) => renderEdit(edit, {
            base: bases.get(edit.id),
            fullView: edit.outside_cwd ? 'skip' : true,
          })).join('')
        : `<p class="no-edits">${icon('review')}No file edits in this turn.</p>`;
      // A turn that only touched files outside the project looks empty
      // while the filter is on; say why rather than showing nothing.
      const filteredNote = turn.edits.length > 0 && inProject(turn.edits).length === 0
        ? `<p class="no-edits only-when-filtered">${icon('filter')}No project files edited in this turn.</p>`
        : '';
      return (
        `<section class="turn-panel" data-turn-panel="${turn.index}">` +
        `<div class="panel-head"><span class="panel-title">${icon('turns')}Turn ${turn.index}</span>${turnTime(turn)}${panelMeta(turn)}</div>` +
        renderFileFilter(turn.edits) +
        filteredNote +
        editsHtml +
        `</section>`
      );
    })
    .join('');

  return (
    `<div class="review-lens">` +
    `<ol class="timeline">${timelineItems}</ol>` +
    `<div class="turn-panels">${panels}</div>` +
    `</div>`
  );
}

/**
 * Diff lens: a file tree, and for each file every occurrence across turns
 * with the hunk tagged by which turn produced it (hover shows the prompt).
 */
export function renderDiffLens(story) {
  const bases = basesFor(story);
  const treeItems = story.files
    .map((file) => {
      const churn = file.churn ? ' churn' : '';
      const stats = file.stats || { added: 0, removed: 0 };
      return (
        `<li class="file-tree-item${churn}" data-file="${escapeHtml(file.rel)}"` +
        `${file.outside_cwd ? ' data-outside="1"' : ''} tabindex="0" role="button" aria-pressed="false">` +
        `${icon('files')}` +
        `<span class="file-name">${escapeHtml(file.rel)}</span>` +
        `<span class="edit-stats"><span class="add">+${stats.added}</span><span class="del">${MINUS}${stats.removed}</span></span>` +
        `</li>`
      );
    })
    .join('');

  const panels = story.files
    .map((file) => {
      const occurrences = [];
      for (const turn of story.turns) {
        for (const edit of turn.edits) {
          if (edit.rel !== file.rel) continue;
          const tag =
            `<div class="turn-tag" title="${escapeHtml(excerpt(turn.prompt, 200))}">` +
            `${icon('turns')}Turn ${turn.index}` +
            `</div>`;
          occurrences.push(
            `<div class="occurrence">${tag}` +
            renderViews(edit.hunks, bases.get(edit.id), edit.base_source === 'disk', edit.outside_cwd ? 'skip' : true) +
            `</div>`
          );
        }
      }
      return (
        `<section class="file-panel" data-file-panel="${escapeHtml(file.rel)}"` +
        `${file.outside_cwd ? ' data-outside="1"' : ''}>` +
        `<div class="panel-head"><span class="panel-title">${icon('code')}${escapeHtml(file.rel)}</span>` +
        `<span class="panel-meta"><span>${file.turns.length} ${plural(file.turns.length, 'turn')}</span>${file.churn ? '<span class="churn-note">rewritten later</span>' : ''}</span></div>` +
        occurrences.join('') +
        `</section>`
      );
    })
    .join('');

  const allOutside = story.files.length > 0 && story.files.every((f) => f.outside_cwd);
  if (story.files.length === 0) {
    return `<div class="diff-lens empty"><p class="no-edits">${icon('diff')}No files were edited in this session.</p></div>`;
  }

  return (
    `<div class="diff-lens">` +
    (allOutside
      ? `<p class="no-edits only-when-filtered">${icon('filter')}Every edited file is outside the project.</p>`
      : '') +
    `<ul class="file-tree">${treeItems}</ul>` +
    `<div class="file-panels">${panels}</div>` +
    `</div>`
  );
}

/**
 * Story lens: readable narrative cards, one per turn along a rail, code
 * collapsed behind a native <details> toggle so this works without JS too.
 */
export function renderStoryLens(story) {
  const max = maxTurnTotals(story.turns);
  const bases = basesFor(story);
  const cards = story.turns
    .map((turn) => {
      const countPhrase = (edits) => {
        const n = new Set(edits.map((e) => e.rel)).size;
        return `${n} ${plural(n, 'file')} changed`;
      };
      // Only edits with a diff go behind "Show code": a failed, interrupted or
      // binary edit has no code to show, and a toggle that opens onto nothing
      // is noise. When every one of them is outside the project, the toggle
      // hides with the project filter, like the edits inside it would.
      const codeEdits = turn.edits.filter((edit) => edit.hunks && edit.hunks.length > 0);
      const editsHtml = codeEdits.map((edit) => renderEdit(edit, { fullView: false })).join('');
      const codeOutside = codeEdits.length > 0 && codeEdits.every((edit) => edit.outside_cwd)
        ? ' data-outside="1"'
        : '';
      return (
        `<article class="story-card">` +
        `<div class="story-index">${turn.index}</div>` +
        `<blockquote class="story-prompt">${escapeHtml(turn.prompt)}</blockquote>` +
        `<p class="story-summary">${escapeHtml(turn.summary || '')}</p>` +
        renderActivityBar(turn, max) +
        `<p class="story-filecount">${icon('files')}` +
        dual(countPhrase(inProject(turn.edits)), countPhrase(turn.edits)) + `</p>` +
        (editsHtml
          ? `<details class="story-code"${codeOutside}><summary>${icon('code')}Show code</summary>${editsHtml}</details>`
          : '') +
        `</article>`
      );
    })
    .join('');

  return `<div class="story-lens">${cards}</div>`;
}
