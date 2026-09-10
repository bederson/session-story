import { escapeHtml, renderEdit, renderHunk } from './diff.mjs';

function fallbackTitle(story) {
  if (story.session.title) return story.session.title;
  const firstPrompt = story.turns[0] ? story.turns[0].prompt : 'Session story';
  return firstPrompt.length > 80 ? `${firstPrompt.slice(0, 80)}…` : firstPrompt;
}

function formatDuration(ms) {
  if (!ms) return '0m';
  const totalMinutes = Math.round(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function renderHeader(story) {
  const { session, totals } = story;
  const title = fallbackTitle(story);
  const blindSpots = (session.blind_spots || [])
    .map((b) => `<li>${escapeHtml(b)}</li>`)
    .join('');

  return (
    `<header class="story-header">` +
    `<h1>${escapeHtml(title)}</h1>` +
    `<div class="meta">` +
    `<span class="cwd">${escapeHtml(session.cwd || '')}</span>` +
    `<span class="branch">${escapeHtml(session.git_branch || '')}</span>` +
    `<span class="duration">${formatDuration(session.duration_ms)}</span>` +
    `</div>` +
    `<p class="summary">${escapeHtml(session.summary || '')}</p>` +
    `<div class="totals">` +
    `<span class="stat turns">${totals.turns} turn${totals.turns === 1 ? '' : 's'}</span>` +
    `<span class="stat files">${totals.files} file${totals.files === 1 ? '' : 's'}</span>` +
    `<span class="stat added">+${totals.added}</span>` +
    `<span class="stat removed">-${totals.removed}</span>` +
    `</div>` +
    (blindSpots ? `<ul class="blind-spots">${blindSpots}</ul>` : '') +
    `</header>`
  );
}

function excerpt(text, max = 120) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function fileIsChurned(story, rel) {
  const entry = story.files.find((f) => f.rel === rel);
  return entry ? entry.churn : false;
}

function renderFileChips(story, edits) {
  return edits
    .map((edit) => {
      const churn = fileIsChurned(story, edit.rel) ? ' churn' : '';
      return `<span class="chip${churn}">${escapeHtml(edit.rel)}</span>`;
    })
    .join('');
}

/**
 * Review lens: a timeline of turns on the left (prompt, intent, file
 * chips), each linked by data-turn to a panel of that turn's edits.
 * Selection between turns is handled by the page's inline script; this
 * renders every panel so the page works with JS disabled too (all turns
 * simply show stacked).
 */
export function renderReviewLens(story) {
  const timelineItems = story.turns
    .map((turn) => {
      const label = turn.summary || excerpt(turn.prompt);
      return (
        `<li class="timeline-item" data-turn="${turn.index}">` +
        `<div class="turn-index">#${turn.index}</div>` +
        `<div class="turn-prompt" title="${escapeHtml(turn.prompt)}">${escapeHtml(label)}</div>` +
        `<div class="turn-chips">${renderFileChips(story, turn.edits)}</div>` +
        `</li>`
      );
    })
    .join('');

  const panels = story.turns
    .map((turn) => {
      const editsHtml = turn.edits.length > 0
        ? turn.edits.map(renderEdit).join('')
        : '<p class="no-edits">No file edits in this turn.</p>';
      return `<section class="turn-panel" data-turn-panel="${turn.index}">${editsHtml}</section>`;
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
  const treeItems = story.files
    .map((file) => {
      const churn = file.churn ? ' churn' : '';
      return (
        `<li class="file-tree-item${churn}" data-file="${escapeHtml(file.rel)}">` +
        `${escapeHtml(file.rel)}` +
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
            `Turn ${turn.index}` +
            `</div>`;
          const hunksHtml = edit.hunks.length > 0
            ? edit.hunks.map(renderHunk).join('')
            : '';
          occurrences.push(`<div class="occurrence">${tag}${hunksHtml}</div>`);
        }
      }
      return (
        `<section class="file-panel" data-file-panel="${escapeHtml(file.rel)}">` +
        occurrences.join('') +
        `</section>`
      );
    })
    .join('');

  return (
    `<div class="diff-lens">` +
    `<ul class="file-tree">${treeItems}</ul>` +
    `<div class="file-panels">${panels}</div>` +
    `</div>`
  );
}

/**
 * Story lens: readable narrative cards, one per turn, code collapsed
 * behind a native <details> toggle so the page works without JS here too.
 */
export function renderStoryLens(story) {
  const cards = story.turns
    .map((turn) => {
      const fileCount = new Set(turn.edits.map((e) => e.rel)).size;
      const editsHtml = turn.edits.length > 0
        ? turn.edits.map(renderEdit).join('')
        : '';
      return (
        `<article class="story-card">` +
        `<div class="story-index">#${turn.index}</div>` +
        `<blockquote class="story-prompt">${escapeHtml(turn.prompt)}</blockquote>` +
        `<p class="story-summary">${escapeHtml(turn.summary || '')}</p>` +
        `<p class="story-filecount">${fileCount} file${fileCount === 1 ? '' : 's'} changed</p>` +
        (editsHtml
          ? `<details class="story-code"><summary>Show code</summary>${editsHtml}</details>`
          : '') +
        `</article>`
      );
    })
    .join('');

  return `<div class="story-lens">${cards}</div>`;
}
