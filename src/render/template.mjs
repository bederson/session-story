import { escapeHtml } from './diff.mjs';
import { renderHeader, renderReviewLens, renderDiffLens, renderStoryLens } from './lenses.mjs';

function pageTitle(story) {
  if (story.session.title) return story.session.title;
  const firstPrompt = story.turns[0] ? story.turns[0].prompt : 'Session story';
  return firstPrompt.length > 80 ? `${firstPrompt.slice(0, 80)}…` : firstPrompt;
}

const STYLE = `
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --bg-raised: #f5f5f7;
  --border: #e0e0e5;
  --text: #1c1c1e;
  --text-dim: #6b6b70;
  --accent: #3b5bdb;
  --add-bg: #e6ffed;
  --add-text: #1a7f37;
  --del-bg: #ffeef0;
  --del-text: #b31d28;
  --code-font: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #14141a;
    --bg-raised: #1c1c24;
    --border: #2e2e38;
    --text: #e8e8ec;
    --text-dim: #9797a3;
    --add-bg: #0d2818;
    --add-text: #4ade80;
    --del-bg: #2a1216;
    --del-text: #f87171;
  }
}
:root[data-theme="dark"] {
  --bg: #14141a;
  --bg-raised: #1c1c24;
  --border: #2e2e38;
  --text: #e8e8ec;
  --text-dim: #9797a3;
  --add-bg: #0d2818;
  --add-text: #4ade80;
  --del-bg: #2a1216;
  --del-text: #f87171;
}
* { box-sizing: border-box; }
body { background: var(--bg); color: var(--text); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; }
.story-header { padding: 24px 32px; border-bottom: 1px solid var(--border); }
.story-header h1 { margin: 0 0 8px; font-size: 20px; }
.story-header .meta { color: var(--text-dim); font-size: 13px; display: flex; gap: 16px; margin-bottom: 12px; }
.story-header .summary { margin: 0 0 12px; max-width: 70ch; }
.story-header .totals { display: flex; gap: 16px; font-size: 13px; }
.story-header .stat.added { color: var(--add-text); }
.story-header .stat.removed { color: var(--del-text); }
.blind-spots { color: var(--text-dim); font-size: 12px; }
.lens-nav { display: flex; gap: 4px; padding: 8px 32px; border-bottom: 1px solid var(--border); background: var(--bg-raised); }
.lens-nav button { background: none; border: none; color: var(--text-dim); font: inherit; padding: 6px 14px; border-radius: 6px; cursor: pointer; }
.lens-nav button.active { background: var(--bg); color: var(--text); font-weight: 600; }
.theme-toggle { margin-left: auto; background: none; border: none; color: var(--text-dim); cursor: pointer; font: inherit; }
.lens-section { display: none; padding: 24px 32px; }
.lens-section.active { display: block; }
.review-lens { display: grid; grid-template-columns: 320px 1fr; gap: 24px; align-items: start; }
.timeline { list-style: none; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.timeline-item { padding: 10px 12px; border-bottom: 1px solid var(--border); cursor: pointer; display: flex; gap: 8px; }
.timeline-item:last-child { border-bottom: none; }
.timeline-item:hover { background: var(--bg-raised); }
.timeline-item.selected { background: var(--bg-raised); border-left: 3px solid var(--accent); }
.turn-index { color: var(--text-dim); font-family: var(--code-font); font-size: 12px; flex-shrink: 0; }
.turn-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.chip { font-family: var(--code-font); font-size: 11px; background: var(--bg-raised); border: 1px solid var(--border); border-radius: 4px; padding: 1px 6px; }
.chip.churn { border-color: var(--accent); }
.turn-panel { display: none; }
.turn-panel.active { display: block; }
.edit-header { display: flex; align-items: center; gap: 8px; font-family: var(--code-font); font-size: 13px; padding: 8px 0; border-bottom: 1px solid var(--border); margin-bottom: 4px; }
.badge { font-size: 10px; text-transform: uppercase; border-radius: 4px; padding: 1px 6px; background: var(--bg-raised); color: var(--text-dim); }
.edit-unknown { color: var(--text-dim); font-style: italic; }
table.hunk { border-collapse: collapse; width: 100%; font-family: var(--code-font); font-size: 12.5px; margin-bottom: 16px; }
table.hunk td.ln { color: var(--text-dim); text-align: right; padding: 0 8px; user-select: none; width: 40px; }
table.hunk td.code { white-space: pre; padding: 0 8px; }
tr.hunk-line.add { background: var(--add-bg); }
tr.hunk-line.add td.code { color: var(--add-text); }
tr.hunk-line.del { background: var(--del-bg); }
tr.hunk-line.del td.code { color: var(--del-text); }
.diff-lens { display: grid; grid-template-columns: 280px 1fr; gap: 24px; align-items: start; }
.file-tree { list-style: none; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.file-tree-item { padding: 8px 12px; border-bottom: 1px solid var(--border); cursor: pointer; font-family: var(--code-font); font-size: 12.5px; }
.file-tree-item:last-child { border-bottom: none; }
.file-tree-item:hover { background: var(--bg-raised); }
.file-tree-item.selected { background: var(--bg-raised); border-left: 3px solid var(--accent); }
.file-tree-item.churn::after { content: " •"; color: var(--accent); }
.file-panel { display: none; }
.file-panel.active { display: block; }
.turn-tag { font-size: 11px; color: var(--text-dim); font-family: var(--code-font); margin: 12px 0 4px; cursor: default; }
.story-lens { max-width: 70ch; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }
.story-card { border: 1px solid var(--border); border-radius: 8px; padding: 16px 20px; }
.story-index { color: var(--text-dim); font-family: var(--code-font); font-size: 12px; }
.story-prompt { margin: 4px 0; font-style: italic; color: var(--text-dim); border-left: 2px solid var(--border); padding-left: 10px; }
.story-summary { margin: 8px 0; }
.story-filecount { color: var(--text-dim); font-size: 12px; }
.story-code summary { cursor: pointer; color: var(--accent); font-size: 12px; margin-top: 8px; }
@media print {
  .lens-nav { display: none; }
  .lens-section { display: block !important; }
}
`;

const SCRIPT = `
(function () {
  var root = document.documentElement;
  var themeBtn = document.querySelector('.theme-toggle');
  themeBtn.addEventListener('click', function () {
    var current = root.getAttribute('data-theme');
    var next = current === 'dark' ? 'light' : (current === 'light' ? null : 'dark');
    if (next) root.setAttribute('data-theme', next); else root.removeAttribute('data-theme');
  });

  var lensButtons = document.querySelectorAll('.lens-nav button[data-lens]');
  var lensSections = document.querySelectorAll('.lens-section');
  function showLens(name) {
    lensButtons.forEach(function (b) { b.classList.toggle('active', b.dataset.lens === name); });
    lensSections.forEach(function (s) { s.classList.toggle('active', s.id === 'lens-' + name); });
    location.hash = name;
  }
  lensButtons.forEach(function (b) {
    b.addEventListener('click', function () { showLens(b.dataset.lens); });
  });
  var initialLens = (location.hash || '#review').slice(1);
  if (!document.getElementById('lens-' + initialLens)) initialLens = 'review';
  showLens(initialLens);

  // Review lens: click a timeline item to show its turn panel.
  var timelineItems = document.querySelectorAll('.timeline-item');
  var turnPanels = document.querySelectorAll('.turn-panel');
  function selectTurn(index) {
    timelineItems.forEach(function (item) { item.classList.toggle('selected', item.dataset.turn === String(index)); });
    turnPanels.forEach(function (panel) { panel.classList.toggle('active', panel.dataset.turnPanel === String(index)); });
  }
  timelineItems.forEach(function (item) {
    item.addEventListener('click', function () { selectTurn(item.dataset.turn); });
  });
  if (timelineItems.length > 0) selectTurn(timelineItems[0].dataset.turn);

  document.addEventListener('keydown', function (e) {
    if (!document.getElementById('lens-review').classList.contains('active')) return;
    var items = Array.prototype.slice.call(timelineItems);
    var selectedIdx = items.findIndex(function (i) { return i.classList.contains('selected'); });
    if (e.key === 'j' && selectedIdx < items.length - 1) items[selectedIdx + 1].click();
    if (e.key === 'k' && selectedIdx > 0) items[selectedIdx - 1].click();
  });

  // Diff lens: click a file tree item to show its file panel.
  var fileItems = document.querySelectorAll('.file-tree-item');
  var filePanels = document.querySelectorAll('.file-panel');
  function selectFile(rel) {
    fileItems.forEach(function (item) { item.classList.toggle('selected', item.dataset.file === rel); });
    filePanels.forEach(function (panel) { panel.classList.toggle('active', panel.dataset.filePanel === rel); });
  }
  fileItems.forEach(function (item) {
    item.addEventListener('click', function () { selectFile(item.dataset.file); });
  });
  if (fileItems.length > 0) selectFile(fileItems[0].dataset.file);
})();
`;

/**
 * Assemble the full, self-contained session-story HTML page: header,
 * lens navigation, all three lenses, inline CSS and JS.
 * @param {object} story - the Story IR
 * @returns {string}
 */
export function renderPage(story) {
  const title = pageTitle(story);

  return (
    `<!doctype html>\n` +
    `<html lang="en">\n` +
    `<head>\n` +
    `<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>${escapeHtml(title)}</title>\n` +
    `<style>${STYLE}</style>\n` +
    `</head>\n` +
    `<body>\n` +
    renderHeader(story) +
    `<nav class="lens-nav">` +
    `<button data-lens="review">Review</button>` +
    `<button data-lens="diff">Diff</button>` +
    `<button data-lens="story">Story</button>` +
    `<button class="theme-toggle" title="Toggle theme">Theme</button>` +
    `</nav>\n` +
    `<section class="lens-section" id="lens-review">${renderReviewLens(story)}</section>\n` +
    `<section class="lens-section" id="lens-diff">${renderDiffLens(story)}</section>\n` +
    `<section class="lens-section" id="lens-story">${renderStoryLens(story)}</section>\n` +
    `<script>${SCRIPT}</script>\n` +
    `</body>\n` +
    `</html>\n`
  );
}
