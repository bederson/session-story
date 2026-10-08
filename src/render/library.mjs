/**
 * The session library: many stories in one folder, browsable.
 *
 * A story page is still one self-contained file — the library only adds
 * siblings next to it. `index.json` is the durable manifest; `sessions.js`
 * and `index.html` are regenerated from it on every render. `sessions.js`
 * is a classic script rather than JSON on purpose: `fetch()` of a sibling
 * file is blocked under `file://`, but `<script src>` is not, which is what
 * lets a story page offer a session switcher with no server. A story
 * copied out of the folder simply loses that script and falls back to
 * being what it always was: one page, complete on its own.
 */
import { escapeHtml } from './diff.mjs';
import { icon } from './icons.mjs';
import { storyTitle, formatDuration, formatRange, plural, OUTCOME_LABELS } from './lenses.mjs';
import {
  TOKENS_CSS,
  BASE_CSS,
  OUTCOME_CSS,
  THEME_TOGGLE_CSS,
  THEME_BOOTSTRAP,
  THEME_TOGGLE_JS,
  themeToggleButton,
} from './theme.mjs';

/** Default folder name, relative to the project the session ran in. */
export const LIBRARY_DIR = '.session-stories';
export const MANIFEST_FILE = 'index.json';
export const SESSIONS_FILE = 'sessions.js';
export const INDEX_FILE = 'index.html';

const SLUG_MAX = 60;
const MINUS = '−'; // U+2212, reads as a proper minus next to "+"

function slugify(text) {
  const slug = String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length <= SLUG_MAX) return slug;
  // Cut back to a word boundary so the filename doesn't end mid-word.
  const cut = slug.slice(0, SLUG_MAX);
  const lastDash = cut.lastIndexOf('-');
  return (lastDash > SLUG_MAX / 2 ? cut.slice(0, lastDash) : cut).replace(/-+$/, '');
}

function datePart(iso) {
  const d = iso ? new Date(iso) : new Date();
  return (Number.isNaN(d.getTime()) ? new Date() : d).toISOString().slice(0, 10);
}

/**
 * The file a story is written to: dated so the folder sorts by eye, keyed
 * by session id so re-rendering the same session overwrites it rather than
 * piling up copies, and slugged so you can tell them apart in a file list.
 */
export function storyFileName(story) {
  const id = String(story.session.id || 'unknown').slice(0, 8);
  const slug = slugify(storyTitle(story)) || 'session';
  return `${datePart(story.session.started_at)}-${id}-${slug}.html`;
}

/** One manifest record: everything the index and the switcher render from. */
export function libraryEntry(story, { file }) {
  const { session, totals } = story;
  return {
    file,
    id: session.id,
    chain: session.chain || [session.id],
    title: storyTitle(story),
    summary: session.summary || '',
    cwd: session.cwd || '',
    started_at: session.started_at || null,
    ended_at: session.ended_at || null,
    duration_ms: session.duration_ms || 0,
    totals: totals || { turns: 0, files: 0, added: 0, removed: 0, edits: 0 },
    outcome: (story.report && story.report.outcome) || null,
    generated_at: new Date().toISOString(),
  };
}

/** Add or replace `entry` by session id, newest session first. */
export function upsertEntry(entries, entry) {
  return [...entries.filter((e) => e.id !== entry.id), entry]
    .sort((a, b) => String(b.started_at || '').localeCompare(String(a.started_at || '')));
}

/**
 * The sidecar the story pages load. Only the fields the switcher needs, so
 * the file stays small even after a few hundred sessions.
 */
export function renderSessionsJs(entries) {
  const slim = entries.map((e) => ({
    file: e.file,
    id: e.id,
    title: e.title,
    started_at: e.started_at,
    outcome: e.outcome,
    totals: e.totals,
  }));
  // `</script` inside a string would end the element that loads this file.
  const json = JSON.stringify(slim, null, 2).replace(/<\//g, '<\\/');
  return `window.SESSION_STORY_LIBRARY = ${json};\n`;
}

const INDEX_STYLE = `
${TOKENS_CSS}
${BASE_CSS}
${OUTCOME_CSS}
${THEME_TOGGLE_CSS}
body { padding-bottom: 64px; }
.lib-header { background: var(--surface); border-bottom: 1px solid var(--border); }
.lib-header-inner { max-width: 1100px; margin: 0 auto; padding: 34px var(--gutter) 26px; display: flex; flex-wrap: wrap; gap: 18px; align-items: flex-end; justify-content: space-between; }
.lib-eyebrow { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--accent-ink); margin-bottom: 10px; }
.lib-header h1 { margin: 0 0 10px; font-size: clamp(20px, 2.4vw, 27px); letter-spacing: -.015em; font-weight: 650; }
.lib-meta { display: flex; flex-wrap: wrap; gap: 6px 18px; color: var(--text-2); font-size: 13px; }
.lib-meta > span { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.lib-meta .cwd span { font-family: var(--mono); font-size: 12px; overflow-wrap: anywhere; }
.lib-tools { display: flex; align-items: center; gap: 10px; }
.lib-search { display: inline-flex; align-items: center; gap: 8px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 0 10px; color: var(--text-3); }
.lib-search input { border: none; background: none; color: var(--text); font: inherit; padding: 8px 0; width: 210px; max-width: 42vw; }
.lib-search input:focus { outline: none; }
.lib-main { max-width: 1100px; margin: 0 auto; padding: 26px var(--gutter) 0; }
.lib-count { color: var(--text-3); font-size: 12.5px; margin: 0 0 14px; }
.session-list { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); }
.session-card { display: flex; flex-direction: column; gap: 10px; padding: 16px 18px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-1); color: inherit; text-decoration: none; transition: border-color .15s ease, box-shadow .15s ease, transform .15s ease; }
.session-card:hover { border-color: var(--border-strong); box-shadow: var(--shadow-2); transform: translateY(-1px); }
.card-top { display: flex; align-items: center; gap: 10px; justify-content: space-between; }
.card-date { display: inline-flex; align-items: center; gap: 6px; font-family: var(--mono); font-size: 11.5px; color: var(--text-3); }
.card-top .outcome-pill { padding: 2px 9px; font-size: 10px; }
.session-card h2 { margin: 0; font-size: 15.5px; font-weight: 620; line-height: 1.35; letter-spacing: -.01em; }
.card-summary { margin: 0; font-size: 13px; color: var(--text-2); line-height: 1.5; }
.card-chips { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: auto; padding-top: 4px; font-size: 12px; color: var(--text-2); }
.card-chips span { display: inline-flex; align-items: center; gap: 5px; }
.card-chips .add { color: var(--add); font-family: var(--mono); font-size: 11.5px; }
.card-chips .del { color: var(--del); font-family: var(--mono); font-size: 11.5px; }
.card-chain { display: inline-flex; align-items: center; gap: 5px; color: var(--text-3); }
.lib-empty { padding: 40px 0; color: var(--text-2); }
.lib-empty code { font-family: var(--mono); font-size: 12.5px; background: var(--surface-3); border-radius: 4px; padding: 2px 6px; }
.no-matches { padding: 30px 0; color: var(--text-3); }
@media print { .lib-tools, .theme-toggle { display: none; } }
`;

const INDEX_SCRIPT = THEME_TOGGLE_JS + `
(function () {
  // Filtering is a substring match over each card's own text, so the index
  // needs no data beyond what it already rendered.
  var input = document.querySelector('.lib-search input');
  var cards = Array.prototype.slice.call(document.querySelectorAll('.session-card'));
  var empty = document.querySelector('.no-matches');
  if (!input) return;
  input.addEventListener('input', function () {
    var q = input.value.trim().toLowerCase();
    var shown = 0;
    cards.forEach(function (card) {
      var hit = !q || card.dataset.search.indexOf(q) !== -1;
      card.hidden = !hit;
      if (hit) shown++;
    });
    if (empty) empty.hidden = shown > 0;
  });
})();
`;

function outcomePill(outcome) {
  if (!outcome) return '';
  return `<span class="outcome-pill outcome-${escapeHtml(outcome)}">${OUTCOME_LABELS[outcome] || escapeHtml(outcome)}</span>`;
}

function sessionCard(entry) {
  const totals = entry.totals || {};
  const chain = (entry.chain || []).length;
  const search = [entry.title, entry.summary, entry.started_at, entry.outcome]
    .filter(Boolean).join(' ').toLowerCase();

  return (
    `<a class="session-card" href="${escapeHtml(entry.file)}" data-search="${escapeHtml(search)}">` +
    `<span class="card-top">` +
    `<span class="card-date">${icon('clock')}<span>${escapeHtml(formatRange(entry.started_at, entry.ended_at))}</span></span>` +
    outcomePill(entry.outcome) +
    `</span>` +
    `<h2>${escapeHtml(entry.title || 'Session story')}</h2>` +
    (entry.summary ? `<p class="card-summary">${escapeHtml(entry.summary)}</p>` : '') +
    `<span class="card-chips">` +
    `<span>${icon('turns')}${totals.turns || 0} ${plural(totals.turns || 0, 'turn')}</span>` +
    `<span>${icon('files')}${totals.files || 0} ${plural(totals.files || 0, 'file')}</span>` +
    `<span class="add">+${totals.added || 0}</span>` +
    `<span class="del">${MINUS}${totals.removed || 0}</span>` +
    (entry.duration_ms ? `<span>${icon('clock')}${escapeHtml(formatDuration(entry.duration_ms))}</span>` : '') +
    (chain > 1 ? `<span class="card-chain">${icon('branch')}${chain} joined</span>` : '') +
    `</span>` +
    `</a>`
  );
}

/**
 * The gallery: one card per session, newest first, with a client-side
 * filter. Self-contained like the story pages, and links to them by
 * relative path so the whole folder can be moved or zipped as a unit.
 */
export function renderIndexPage(entries, { cwd = '' } = {}) {
  const project = cwd ? cwd.split('/').filter(Boolean).pop() || cwd : 'Session stories';
  const rollup = entries.reduce(
    (acc, e) => {
      const t = e.totals || {};
      acc.turns += t.turns || 0;
      acc.added += t.added || 0;
      acc.removed += t.removed || 0;
      return acc;
    },
    { turns: 0, added: 0, removed: 0 }
  );

  const body = entries.length
    ? `<p class="lib-count">${entries.length} ${plural(entries.length, 'session')} · ` +
      `${rollup.turns} ${plural(rollup.turns, 'turn')} · ` +
      `<span class="add">+${rollup.added}</span> <span class="del">${MINUS}${rollup.removed}</span></p>` +
      `<div class="session-list">${entries.map(sessionCard).join('')}</div>` +
      `<p class="no-matches" hidden>No sessions match that search.</p>`
    : `<p class="lib-empty">No sessions yet. Run <code>story render</code> and this page will list it.</p>`;

  return (
    `<!doctype html>\n` +
    `<html lang="en">\n` +
    `<head>\n` +
    `<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>Session stories — ${escapeHtml(project)}</title>\n` +
    `<script>${THEME_BOOTSTRAP}</script>\n` +
    `<style>${INDEX_STYLE}</style>\n` +
    `</head>\n` +
    `<body>\n` +
    `<header class="lib-header"><div class="lib-header-inner">` +
    `<div>` +
    `<div class="lib-eyebrow">${icon('story')}<span>Session stories</span></div>` +
    `<h1>${escapeHtml(project)}</h1>` +
    `<div class="lib-meta">` +
    (cwd ? `<span class="cwd">${icon('folder')}<span>${escapeHtml(cwd)}</span></span>` : '') +
    `</div></div>` +
    `<div class="lib-tools">` +
    `<label class="lib-search">${icon('search')}` +
    `<input type="search" placeholder="Filter sessions" aria-label="Filter sessions">` +
    `</label>` +
    themeToggleButton() +
    `</div>` +
    `</div></header>\n` +
    `<main class="lib-main">${body}</main>\n` +
    `<script>${INDEX_SCRIPT}</script>\n` +
    `</body>\n` +
    `</html>\n`
  );
}
