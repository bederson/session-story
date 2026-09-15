import { escapeHtml } from './diff.mjs';
import { icon } from './icons.mjs';
import { renderHeader, renderReviewLens, renderDiffLens, renderStoryLens, storyTitle } from './lenses.mjs';
import { renderReportLens } from './report.mjs';
import { resetFullViewBudget } from './full-view.mjs';
import { TOKENS_CSS, BASE_CSS, OUTCOME_CSS, THEME_TOGGLE_CSS, THEME_BOOTSTRAP, THEME_TOGGLE_JS, themeToggleButton } from './theme.mjs';

// Runs in <head> before first paint, after the shared theme restore: the
// two view options are classes on <html>, so restoring them before paint
// keeps the page from flashing the wrong view.
const BOOTSTRAP = THEME_BOOTSTRAP + `
(function () {
  var root = document.documentElement;
  try {
    // Default view: project files only, changed hunks only.
    if (localStorage.getItem('session-story-scope') === 'all') root.classList.add('show-outside');
    if (localStorage.getItem('session-story-view') === 'full') root.classList.add('full-context');
  } catch (e) {}
})();
`;

const STYLE = `
${TOKENS_CSS}
${BASE_CSS}

/* ---- header ------------------------------------------------------------ */
.story-header { position: relative; overflow: hidden; background: var(--surface); border-bottom: 1px solid var(--border); }
.header-motif { position: absolute; top: -20px; right: 0; height: calc(100% + 40px); width: min(640px, 70%); color: var(--accent); opacity: calc(.18 * var(--motif)); pointer-events: none;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 45%); mask-image: linear-gradient(90deg, transparent, #000 45%); }
.header-inner { position: relative; max-width: 1240px; margin: 0 auto; padding: 36px var(--gutter) 28px; }
.eyebrow { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--accent-ink); margin-bottom: 10px; }
.story-header h1 { margin: 0 0 12px; font-size: clamp(22px, 2.6vw, 30px); line-height: 1.2; letter-spacing: -.015em; font-weight: 650; max-width: 32ch; }
.story-header .meta { display: flex; flex-wrap: wrap; gap: 6px 18px; color: var(--text-2); font-size: 13px; margin-bottom: 14px; }
.story-header .meta > span { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.story-header .meta .cwd span { font-family: var(--mono); font-size: 12px; overflow-wrap: anywhere; }
.story-header .meta .commits code { font-family: var(--mono); font-size: 11.5px; background: var(--surface-2); border-radius: 4px; padding: 1px 5px; }
.eyebrow .outcome-pill { margin-left: 4px; padding: 2px 10px; font-size: 10px; }
.story-header .summary { margin: 0 0 22px; max-width: 72ch; font-size: 15px; color: var(--text); }
.totals { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; max-width: 760px; }
.stat-tile { display: flex; align-items: center; gap: 12px; padding: 12px 14px; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-1); min-width: 0; }
.stat-icon { display: inline-grid; place-items: center; width: 32px; height: 32px; border-radius: 8px; background: var(--accent-soft); color: var(--accent-ink); flex-shrink: 0; }
.stat-tile.added .stat-icon { background: var(--add-bg); color: var(--add); }
.stat-tile.removed .stat-icon { background: var(--del-bg); color: var(--del); }
.stat-text { display: flex; flex-direction: column; line-height: 1.15; min-width: 0; }
.stat-value { font-size: 22px; font-weight: 650; letter-spacing: -.02em; }
.stat-label { font-size: 12px; color: var(--text-2); }
.session-strip-wrap { max-width: 760px; margin-top: 18px; }
.session-strip { display: flex; gap: 2px; height: 8px; }
.strip-seg { display: flex; gap: 2px; min-width: 6px; height: 100%; border-radius: 3px; overflow: hidden; background: var(--surface-3); }
.strip-seg.empty { flex-grow: 0 !important; width: 8px; border: 1px dashed var(--border-strong); background: transparent; }
.strip-caption { display: flex; justify-content: space-between; margin-top: 5px; font-family: var(--mono); font-size: 10.5px; color: var(--text-3); }
.blind-spots { list-style: none; margin: 18px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; color: var(--text-2); }
.blind-spots li { display: flex; gap: 8px; align-items: flex-start; }
.blind-spots .icon { color: var(--text-3); margin-top: 1px; }

/* ---- activity bars (shared) -------------------------------------------- */
.turn-bars { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
.bar-track { flex: 1; display: flex; gap: 2px; height: 6px; background: var(--surface-3); border-radius: 3px; overflow: hidden; }
.bar-add { display: block; height: 100%; background: var(--add); border-radius: 0 3px 3px 0; }
.bar-del { display: block; height: 100%; background: var(--del); border-radius: 0 3px 3px 0; }
.bar-label, .edit-stats { font-family: var(--mono); font-size: 11px; font-variant-numeric: tabular-nums; color: var(--text-3); white-space: nowrap; }
.edit-stats { display: inline-flex; gap: 8px; margin-left: auto; }
.edit-stats .add { color: var(--add); }
.edit-stats .del { color: var(--del); }

/* ---- lens nav ----------------------------------------------------------- */
.lens-nav { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 12px; padding: 10px var(--gutter); background: color-mix(in srgb, var(--surface) 86%, transparent); backdrop-filter: saturate(1.4) blur(10px); -webkit-backdrop-filter: saturate(1.4) blur(10px); border-bottom: 1px solid var(--border); }
.lens-nav .tabs { display: inline-flex; gap: 2px; padding: 3px; background: var(--surface-3); border-radius: 9px; }
.lens-tab { display: inline-flex; align-items: center; gap: 7px; background: none; border: none; color: var(--text-2); font: inherit; font-weight: 500; padding: 6px 14px; border-radius: 7px; cursor: pointer; transition: background .15s ease, color .15s ease, box-shadow .15s ease; }
.lens-tab:hover { color: var(--text); }
.lens-tab[aria-selected="true"] { background: var(--surface); color: var(--accent-ink); box-shadow: var(--shadow-1); }
.lens-nav { flex-wrap: wrap; }
.lens-hint { display: inline-flex; align-items: center; gap: 6px; color: var(--text-3); font-size: 12px; }
.lib-nav { display: inline-flex; align-items: center; gap: 8px; }
.lib-nav[hidden] { display: none; }
.lib-back { display: inline-flex; align-items: center; gap: 6px; padding: 6px 11px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text-2); font-size: 12.5px; text-decoration: none; }
.lib-back:hover { color: var(--text); border-color: var(--border-strong); }
.lib-switch { max-width: min(320px, 40vw); padding: 6px 9px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text-2); font: inherit; font-size: 12.5px; cursor: pointer; }
.lib-switch:hover { color: var(--text); border-color: var(--border-strong); }
.lens-hint kbd { font-family: var(--mono); font-size: 10.5px; padding: 1px 5px; border: 1px solid var(--border-strong); border-bottom-width: 2px; border-radius: 4px; background: var(--surface); }
${THEME_TOGGLE_CSS}

/* ---- scope filter & full-file view ------------------------------------- */
.v-all { display: none; }
html.show-outside .v-in { display: none; }
html.show-outside .v-all { display: inline; }
html:not(.show-outside) [data-outside="1"] { display: none !important; }
html.show-outside .only-when-filtered { display: none; }
.session-strip[data-scope="all"], .bar-track[data-scope="all"] { display: none; }
html.show-outside .session-strip[data-scope="all"], html.show-outside .bar-track[data-scope="all"] { display: flex; }
html.show-outside .session-strip[data-scope="in"], html.show-outside .bar-track[data-scope="in"] { display: none; }
.view-full { display: none; }
html.full-context #lens-review .view-full, html.full-context #lens-diff .view-full { display: block; }
html.full-context #lens-review .view-hunks, html.full-context #lens-diff .view-hunks { display: none; }
/* #lens-story always shows just the changes, so the toggle never empties a card. */
.approx-note { display: flex; align-items: flex-start; gap: 8px; margin: 0; padding: 8px 16px; background: var(--surface-2); border-bottom: 1px solid var(--border); color: var(--text-3); font-size: 12px; }
.approx-note .icon { color: var(--text-3); margin-top: 1px; }
.outside-note { display: flex; align-items: flex-start; gap: 8px; margin: 14px 0 0; max-width: 72ch; font-size: 12.5px; color: var(--text-2); }
.outside-note .icon { color: var(--accent-ink); margin-top: 1px; }
.opt-toggle { display: inline-flex; align-items: center; gap: 6px; padding: 6px 11px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; color: var(--text-2); font: inherit; font-size: 12.5px; cursor: pointer; transition: background .15s ease, color .15s ease, border-color .15s ease; }
.opt-toggle:hover { color: var(--text); border-color: var(--border-strong); }
.opt-toggle[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent-ring); color: var(--accent-ink); }
.opt-toggle .icon { width: 14px; height: 14px; }
.nav-opts { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; }

/* ---- lens sections & panels -------------------------------------------- */
.lens-section { max-width: 1240px; margin: 0 auto; padding: 28px var(--gutter) 56px; }
html.js .lens-section:not(.active) { display: none; }
html:not(.js) .lens-section + .lens-section { border-top: 1px solid var(--border); }
.panel-head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 14px; padding: 12px 16px; border-bottom: 1px solid var(--border); background: var(--surface-2); border-radius: var(--radius) var(--radius) 0 0; }
.panel-title { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; min-width: 0; overflow-wrap: anywhere; }
.panel-title .icon { color: var(--accent-ink); }
.panel-meta { display: inline-flex; align-items: center; gap: 12px; margin-left: auto; font-size: 12px; color: var(--text-3); }
.panel-meta .edit-stats { margin-left: 0; }
.churn-note { color: var(--accent-ink); }
.no-edits { display: flex; align-items: center; gap: 8px; margin: 0; padding: 28px 16px; color: var(--text-3); font-style: italic; }

/* ---- review lens -------------------------------------------------------- */
.review-lens { display: grid; grid-template-columns: minmax(280px, 360px) minmax(0, 1fr); gap: 24px; align-items: start; }
.timeline { position: relative; list-style: none; margin: 0; padding: 4px 0 4px 0; display: flex; flex-direction: column; gap: 10px; }
.timeline::before { content: ""; position: absolute; left: 15px; top: 16px; bottom: 16px; width: 2px; background: var(--border-strong); opacity: .7; }
.timeline-item { position: relative; display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: 12px; padding: 12px 14px 12px 0; border-radius: var(--radius); cursor: pointer; transition: background .15s ease; }
.timeline-item:hover { background: var(--surface); }
.timeline-item.selected { background: var(--surface); box-shadow: var(--shadow-1), inset 0 0 0 1px var(--border); }
.turn-index { position: relative; z-index: 1; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: var(--surface); border: 2px solid var(--border-strong); color: var(--text-2); font-family: var(--mono); font-size: 12px; font-weight: 600; transition: background .15s ease, border-color .15s ease, color .15s ease; }
.timeline-item.selected .turn-index { background: var(--accent); border-color: var(--accent); color: #fff; box-shadow: 0 0 0 4px var(--accent-soft); }
.turn-body { min-width: 0; }
.turn-prompt, .story-prompt { margin: 0; padding: 8px 12px; background: var(--surface-2); border-left: 3px solid var(--accent); border-radius: 0 var(--radius-sm) var(--radius-sm) 0; color: var(--text); font-size: 13.5px; overflow-wrap: anywhere; white-space: pre-wrap; }
.timeline-item.selected .turn-prompt { background: var(--surface-3); }
.turn-summary { margin: 8px 0 0; color: var(--text-2); font-size: 13px; }
.turn-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.chip { font-family: var(--mono); font-size: 11px; line-height: 1.45; appearance: none; text-align: left; background: var(--surface-3); border: 1px solid var(--border); border-radius: 5px; padding: 2px 7px; color: var(--text-2); max-width: 100%; overflow-wrap: anywhere; cursor: pointer; transition: color .15s ease, border-color .15s ease; }
.chip:hover { color: var(--text); border-color: var(--border-strong); }
.chip.churn { border-color: var(--accent-ring); color: var(--accent-ink); }
.chip.churn::before { content: ""; display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); margin-right: 6px; vertical-align: 1px; }
.turn-panels { min-width: 0; }
.turn-panel { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-2); overflow: hidden; }
.turn-panel + .turn-panel { margin-top: 20px; }
html.js .turn-panel:not(.active) { display: none; }

/* ---- edits & hunks ------------------------------------------------------ */
.edit { scroll-margin-top: 72px; } /* clear the sticky lens nav when a chip scrolls here */
.edit.flash { animation: flash 1.2s ease-out both; }
@keyframes flash { 0%, 40% { background: var(--accent-soft); box-shadow: inset 0 0 0 2px var(--accent-ring); } 100% { background: transparent; box-shadow: inset 0 0 0 2px transparent; } }
.edit-header { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-family: var(--mono); font-size: 12.5px; padding: 9px 16px; background: var(--surface-2); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
.panel-head + .edit-header, details > summary + .edit-header { border-top: none; }
.edit-header > .icon { color: var(--text-3); }
.edit-file { font-weight: 600; overflow-wrap: anywhere; }
.badge { display: inline-flex; align-items: center; gap: 4px; font-family: var(--font); font-size: 10.5px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; border-radius: 4px; padding: 2px 7px; background: var(--surface-3); color: var(--text-2); }
.badge .icon { width: 12px; height: 12px; }
.badge.create { background: var(--add-bg); color: var(--add); }
.badge.subagent { background: var(--accent-soft); color: var(--accent-ink); }
.badge.delete { background: var(--del-bg); color: var(--del); }
.badge.shell { background: var(--surface-3); color: var(--text-2); font-family: var(--mono); text-transform: none; letter-spacing: 0; }
.edit-unknown { display: flex; align-items: center; gap: 8px; margin: 0; padding: 14px 16px; color: var(--text-3); font-style: italic; }
table.hunk { border-collapse: collapse; width: 100%; font-family: var(--mono); font-size: 12.5px; line-height: 1.6; }
table.hunk + table.hunk { border-top: 1px dashed var(--border-strong); }
table.hunk td { padding: 0; vertical-align: top; }
table.hunk td.ln { width: 44px; padding: 0 8px; text-align: right; color: var(--text-3); user-select: none; font-variant-numeric: tabular-nums; background: var(--surface-2); border-right: 1px solid var(--border); }
table.hunk td.ln.new { border-right: none; }
table.hunk td.code { padding: 0 14px 0 10px; white-space: pre; position: relative; }
table.hunk td.code::before { content: " "; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; }
tr.hunk-line.add td.code { background: var(--add-line); }
tr.hunk-line.add td.code::before { background: var(--add); }
tr.hunk-line.add td.ln.new { background: var(--add-bg); color: var(--add); }
tr.hunk-line.del td.code { background: var(--del-line); }
tr.hunk-line.del td.code::before { background: var(--del); }
tr.hunk-line.del td.ln.old { background: var(--del-bg); color: var(--del); }
.edit { min-width: 0; }
.view { overflow-x: auto; }
.turn-panel, .file-panel, .story-code { overflow-x: auto; }

/* ---- diff lens ---------------------------------------------------------- */
.diff-lens { display: grid; grid-template-columns: minmax(260px, 320px) minmax(0, 1fr); gap: 24px; align-items: start; }
.diff-lens.empty { display: block; }
.diff-lens.empty .no-edits { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
.file-tree { list-style: none; margin: 0; padding: 4px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-1); display: flex; flex-direction: column; gap: 2px; }
.file-tree-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 7px; cursor: pointer; font-family: var(--mono); font-size: 12.5px; color: var(--text-2); transition: background .15s ease, color .15s ease; }
.file-tree-item .icon { color: var(--text-3); }
.file-tree-item .file-name { min-width: 0; overflow-wrap: anywhere; }
.file-tree-item:hover { background: var(--surface-2); color: var(--text); }
.file-tree-item.selected { background: var(--accent-soft); color: var(--accent-ink); }
.file-tree-item.selected .icon { color: var(--accent-ink); }
.file-tree-item.churn .file-name::after { content: " •"; color: var(--accent); }
.file-panels { min-width: 0; }
.file-panel { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-2); }
.file-panel + .file-panel { margin-top: 20px; }
html.js .file-panel:not(.active) { display: none; }
.turn-tag { display: inline-flex; align-items: center; gap: 6px; margin: 14px 16px 6px; padding: 3px 9px; font-size: 11.5px; font-weight: 600; color: var(--accent-ink); background: var(--accent-soft); border-radius: 999px; cursor: default; }
.turn-tag .icon { width: 13px; height: 13px; }

/* ---- story lens --------------------------------------------------------- */
.story-lens { position: relative; max-width: 76ch; margin: 0 auto; display: flex; flex-direction: column; gap: 22px; padding-left: 44px; }
.story-lens::before { content: ""; position: absolute; left: 15px; top: 24px; bottom: 24px; width: 2px; background: var(--border-strong); opacity: .7; }
.story-card { position: relative; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-1); padding: 18px 22px 16px; }
.story-index { position: absolute; left: -44px; top: 18px; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: var(--accent); color: #fff; font-family: var(--mono); font-size: 12px; font-weight: 600; box-shadow: 0 0 0 4px var(--bg); }
.story-prompt { font-size: 15px; margin-bottom: 12px; }
.story-summary { margin: 0; font-size: 14.5px; color: var(--text); }
.story-summary:empty { display: none; }
.story-filecount { display: flex; align-items: center; gap: 6px; margin: 10px 0 0; color: var(--text-3); font-size: 12.5px; }
.story-code { margin: 12px -22px -16px; border-top: 1px solid var(--border); }
.story-code summary { display: flex; align-items: center; gap: 6px; padding: 10px 22px; cursor: pointer; color: var(--accent-ink); font-size: 12.5px; font-weight: 600; list-style: none; }
.story-code summary::-webkit-details-marker { display: none; }
.story-code summary::after { content: "▸"; margin-left: auto; transition: transform .15s ease; }
.story-code[open] summary::after { transform: rotate(90deg); }
.story-code summary:hover { background: var(--surface-2); }

/* ---- report lens ---------------------------------------------------------- */
.report-lens { max-width: 900px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }
.report-block { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-1); padding: 18px 22px; }
.report-block h2 { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; font-size: 14px; font-weight: 600; color: var(--text); }
.report-block h2 .icon { color: var(--accent-ink); }
.report-empty { margin: 0; color: var(--text-3); font-style: italic; font-size: 13px; }
.report-count { margin: 0 0 10px; color: var(--text-3); font-size: 12.5px; }
.report-summary, .report-plan-text { margin: 8px 0 0; font-size: 14px; color: var(--text); }
.report-summary:first-child, .report-plan-text:first-child { margin-top: 0; }
.report-decisions { margin: 0; padding-left: 20px; font-size: 13.5px; color: var(--text); }
.report-decisions li + li { margin-top: 4px; }
.report-turn-plan { margin-top: 10px; border-top: 1px solid var(--border); padding-top: 8px; }
.report-turn-plan summary { display: flex; align-items: center; gap: 6px; cursor: pointer; color: var(--accent-ink); font-size: 12.5px; font-weight: 600; list-style: none; }
.report-turn-plan summary::-webkit-details-marker { display: none; }
.report-turn-plan pre, .report-test-output pre { margin: 8px 0 0; padding: 10px 12px; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-sm); font-family: var(--mono); font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text-2); }

${OUTCOME_CSS}
.outcome-note { margin: 8px 0 0; font-size: 13px; color: var(--text-2); }

.cmd-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 7px 0; border-top: 1px solid var(--border); font-size: 12.5px; }
.cmd-row:first-of-type { border-top: none; }
.cmd-status { display: inline-flex; width: 16px; height: 16px; }
.cmd-status.ok .icon { color: var(--add); }
.cmd-status.fail .icon { color: var(--del); }
.cmd-status.unknown .icon { color: var(--text-3); }
.cmd-turn { color: var(--text-3); font-family: var(--mono); font-size: 11px; }
.cmd-category { text-transform: capitalize; }
.cmd-text { flex: 1; min-width: 0; overflow-wrap: anywhere; font-family: var(--mono); color: var(--text); }
.cmd-exit { color: var(--text-3); font-size: 11.5px; }
.report-test-output { flex-basis: 100%; margin-top: 4px; }
.report-test-output summary { cursor: pointer; color: var(--accent-ink); font-size: 12px; font-weight: 600; list-style: none; }
.report-test-output summary::-webkit-details-marker { display: none; }

.error-row { padding: 10px 0; border-top: 1px solid var(--border); }
.error-row:first-of-type { border-top: none; }
.error-row .badge-error { background: var(--del-bg); color: var(--del); }
.error-row .badge-rejected { background: var(--surface-3); color: var(--text-2); }
.error-tool { margin-left: 4px; font-weight: 600; color: var(--text); font-size: 12.5px; }
.error-message { margin: 6px 0 0; font-family: var(--mono); font-size: 12px; color: var(--text-2); white-space: pre-wrap; overflow-wrap: anywhere; }
.error-resolution { display: flex; align-items: flex-start; gap: 6px; margin: 6px 0 0; font-size: 12.5px; color: var(--add); }
.error-resolution .icon { color: var(--add); margin-top: 1px; }

.dep-manifest { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 6px 0; font-size: 12.5px; }
.dep-manifest + .dep-manifest { border-top: 1px solid var(--border); }
.dep-rel { font-family: var(--mono); font-weight: 600; color: var(--text); }
.dep-added { color: var(--add); font-family: var(--mono); font-size: 12px; }
.dep-removed { color: var(--del); font-family: var(--mono); font-size: 12px; }
.dep-installs, .dep-config { margin: 8px 0 0; padding-left: 20px; font-size: 12.5px; color: var(--text-2); }
.dep-installs code, .dep-config code { font-family: var(--mono); }

.git-branch, .git-range, .git-status { display: flex; align-items: center; gap: 6px; margin: 0 0 6px; font-size: 13px; color: var(--text-2); }
.git-range code, .git-commits code { font-family: var(--mono); font-size: 12px; background: var(--surface-2); border-radius: 4px; padding: 1px 5px; }
.git-commits { margin: 8px 0 0; padding-left: 20px; font-size: 12.5px; color: var(--text); }
.git-commits li + li { margin-top: 4px; }

/* ---- motion ------------------------------------------------------------- */
@keyframes rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.header-inner > * { animation: rise .5s cubic-bezier(.2,.7,.2,1) both; }
.header-inner > :nth-child(2) { animation-delay: .04s; }
.header-inner > :nth-child(3) { animation-delay: .08s; }
.header-inner > :nth-child(4) { animation-delay: .12s; }
.header-inner > :nth-child(5) { animation-delay: .16s; }
.header-inner > :nth-child(6) { animation-delay: .20s; }
.header-inner > :nth-child(7) { animation-delay: .24s; }
.header-inner > :nth-child(8) { animation-delay: .28s; }
.timeline-item, .story-card, .file-tree-item { animation: rise .45s cubic-bezier(.2,.7,.2,1) both; animation-delay: calc(.12s + var(--i, 0) * .035s); }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}

/* ---- responsive --------------------------------------------------------- */
@media (max-width: 900px) {
  .review-lens, .diff-lens { grid-template-columns: 1fr; }
  .totals { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .lens-hint { display: none; }
  .nav-opts { margin-left: 0; width: 100%; }
  .opt-toggle { flex: 1; justify-content: center; }
  .header-motif { width: 90%; opacity: calc(.1 * var(--motif)); }
}
@media (max-width: 520px) {
  .story-lens { padding-left: 36px; }
  .story-index { left: -36px; width: 28px; height: 28px; font-size: 11px; }
  .story-lens::before { left: 13px; }
  .stat-tile { padding: 10px 12px; }
  .stat-value { font-size: 19px; }
}

/* ---- print -------------------------------------------------------------- */
@media print {
  :root { --bg: #fff; --surface: #fff; --surface-2: #f6f6f6; --surface-3: #eee; --shadow-1: none; --shadow-2: none; }
  body { font-size: 12px; }
  .lens-nav, .header-motif, .lens-hint { display: none !important; }
  .lens-section, .turn-panel, .file-panel { display: block !important; }
  .lens-section { padding: 16px 0; border-top: 1px solid #ccc; }
  .story-code { display: block; }
  .story-code summary { display: none; }
  .story-code:not([open]) > *:not(summary) { display: block; }
  .timeline-item, .story-card, .turn-panel, .file-panel { break-inside: avoid; }
  * { animation: none !important; }
}
`;

const SCRIPT = THEME_TOGGLE_JS + `
(function () {
  var root = document.documentElement;
  // The two view options: each maps to a class on <html>, so all the
  // filtering and view switching is CSS. "Project files only" is the
  // default, which is the *absence* of the show-outside class.
  var OPTIONS = {
    scope: { key: 'session-story-scope', cls: 'show-outside', whenSet: 'all', whenUnset: 'project', pressedWhenSet: false },
    view: { key: 'session-story-view', cls: 'full-context', whenSet: 'full', whenUnset: 'hunks', pressedWhenSet: true },
  };
  Array.prototype.forEach.call(document.querySelectorAll('.opt-toggle'), function (btn) {
    var opt = OPTIONS[btn.dataset.opt];
    if (!opt) return;
    function sync() {
      var set = root.classList.contains(opt.cls);
      btn.setAttribute('aria-pressed', String(opt.pressedWhenSet ? set : !set));
    }
    btn.addEventListener('click', function () {
      var set = root.classList.toggle(opt.cls);
      try { localStorage.setItem(opt.key, set ? opt.whenSet : opt.whenUnset); } catch (e) {}
      sync();
    });
    sync();
  });

  // Lens tabs, remembered in the URL hash.
  var lensButtons = Array.prototype.slice.call(document.querySelectorAll('.lens-tab'));
  var lensSections = Array.prototype.slice.call(document.querySelectorAll('.lens-section'));
  function showLens(name) {
    lensButtons.forEach(function (b) {
      var on = b.dataset.lens === name;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    lensSections.forEach(function (s) { s.classList.toggle('active', s.id === 'lens-' + name); });
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  }
  lensButtons.forEach(function (b, i) {
    b.addEventListener('click', function () { showLens(b.dataset.lens); });
    b.addEventListener('keydown', function (e) {
      var delta = e.key === 'ArrowRight' ? 1 : (e.key === 'ArrowLeft' ? -1 : 0);
      if (!delta) return;
      var next = lensButtons[(i + delta + lensButtons.length) % lensButtons.length];
      next.focus(); showLens(next.dataset.lens); e.preventDefault();
    });
  });
  var initialLens = (location.hash || '#review').slice(1);
  if (!document.getElementById('lens-' + initialLens)) initialLens = 'review';
  showLens(initialLens);

  // Generic master/detail wiring for clickable list items -> panels.
  function wireList(itemSelector, panelSelector, itemKey, panelKey) {
    var items = Array.prototype.slice.call(document.querySelectorAll(itemSelector));
    var panels = Array.prototype.slice.call(document.querySelectorAll(panelSelector));
    function select(key) {
      items.forEach(function (item) {
        var on = item.dataset[itemKey] === key;
        item.classList.toggle('selected', on);
        item.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      panels.forEach(function (panel) { panel.classList.toggle('active', panel.dataset[panelKey] === key); });
    }
    items.forEach(function (item, i) {
      item.style.setProperty('--i', i);
      item.addEventListener('click', function () { select(item.dataset[itemKey]); });
      item.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { select(item.dataset[itemKey]); e.preventDefault(); }
      });
    });
    if (items.length > 0) select(items[0].dataset[itemKey]);
    return { items: items, select: select };
  }
  var turns = wireList('.timeline-item', '.turn-panel', 'turn', 'turnPanel');

  // A file chip under a review step jumps to that file's diff in the turn's panel.
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  Array.prototype.forEach.call(document.querySelectorAll('.turn-chips .chip'), function (chip) {
    chip.addEventListener('click', function () {
      // Select the turn first: inactive panels are display:none, so the target
      // has no layout until its panel is shown. The item's own bubbled handler
      // runs after this one, hence doing it here rather than relying on it.
      var item = chip.closest ? chip.closest('.timeline-item') : null;
      if (item) turns.select(item.dataset.turn);
      var panel = document.querySelector('.turn-panel.active');
      if (!panel) return;
      // Match on dataset rather than a [data-file="..."] selector: paths can
      // carry characters that would need CSS escaping, and there is no polyfill.
      var target = null;
      Array.prototype.forEach.call(panel.querySelectorAll('.edit'), function (edit) {
        if (!target && edit.dataset.file === chip.dataset.file) target = edit;
      });
      if (!target) return;
      target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      target.classList.remove('flash');
      void target.offsetWidth; // restart the animation when the same chip is clicked twice
      target.classList.add('flash');
    });
  });
  wireList('.file-tree-item', '.file-panel', 'file', 'filePanel');
  Array.prototype.forEach.call(document.querySelectorAll('.story-card'), function (card, i) { card.style.setProperty('--i', i); });

  // j / k move between turns in the review lens.
  document.addEventListener('keydown', function (e) {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (!document.getElementById('lens-review').classList.contains('active')) return;
    var idx = turns.items.findIndex(function (i) { return i.classList.contains('selected'); });
    if (e.key === 'j' && idx < turns.items.length - 1) turns.items[idx + 1].click();
    if (e.key === 'k' && idx > 0) turns.items[idx - 1].click();
  });
})();
`;

function lensTab(name, label) {
  return (
    `<button class="lens-tab" role="tab" data-lens="${name}" id="tab-${name}" aria-controls="lens-${name}" aria-selected="false">` +
    `${icon(name)}<span>${label}</span></button>`
  );
}

/**
 * The cross-session chrome: a link back to the index and a switcher. Both
 * start hidden and are only revealed once the sidecar manifest turns out
 * to be there, so a story page copied out of its folder is exactly the
 * self-contained page it was before the library existed.
 */
function libraryNav(story, library) {
  if (!library) return '';
  return (
    `<span class="lib-nav" hidden data-session-id="${escapeHtml(story.session.id || '')}">` +
    `<a class="lib-back" href="${escapeHtml(library.indexHref)}">${icon('back')}<span>All sessions</span></a>` +
    `<select class="lib-switch" aria-label="Switch session"></select>` +
    `</span>`
  );
}

const LIBRARY_SCRIPT = `
(function () {
  var nav = document.querySelector('.lib-nav');
  var sessions = window.SESSION_STORY_LIBRARY;
  if (!nav || !Array.isArray(sessions) || !sessions.length) return;

  var select = nav.querySelector('.lib-switch');
  var current = nav.dataset.sessionId;
  sessions.forEach(function (s) {
    var option = document.createElement('option');
    option.value = s.file;
    option.textContent = (s.started_at ? s.started_at.slice(0, 10) + '  ' : '') + (s.title || s.id);
    if (s.id === current) option.selected = true;
    select.appendChild(option);
  });
  select.addEventListener('change', function () {
    if (select.value) location.href = select.value;
  });
  nav.hidden = false;
})();
`;

/**
 * Assemble the full, self-contained session-story HTML page: header,
 * lens navigation, all three lenses, inline CSS and JS.
 * @param {object} story - the Story IR
 * @param {object} [opts]
 * @param {{indexHref: string, manifestHref: string}} [opts.library] - when the
 *   page is written into a session library, the relative paths of the index
 *   and the sidecar manifest; omit it for a standalone page.
 * @returns {string}
 */
export function renderPage(story, opts = {}) {
  const title = storyTitle(story);
  const library = opts.library || null;
  resetFullViewBudget();

  return (
    `<!doctype html>\n` +
    `<html lang="en">\n` +
    `<head>\n` +
    `<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>${escapeHtml(title)}</title>\n` +
    `<script>${BOOTSTRAP}</script>\n` +
    (library ? `<script src="${escapeHtml(library.manifestHref)}"></script>\n` : '') +
    `<style>${STYLE}</style>\n` +
    `</head>\n` +
    `<body>\n` +
    renderHeader(story) +
    `<nav class="lens-nav">` +
    libraryNav(story, opts.library) +
    `<div class="tabs" role="tablist" aria-label="Views">` +
    lensTab('review', 'Review') + lensTab('diff', 'Diff') + lensTab('story', 'Story') + lensTab('report', 'Report') +
    `</div>` +
    `<span class="lens-hint">${icon('keyboard')}<kbd>j</kbd><kbd>k</kbd> turns</span>` +
    `<span class="nav-opts">` +
    `<button class="opt-toggle" type="button" data-opt="scope" aria-pressed="true" ` +
    `title="Hide edits to files outside this project">${icon('filter')}<span>Project files only</span></button>` +
    `<button class="opt-toggle" type="button" data-opt="view" aria-pressed="false" ` +
    `title="Show the whole file around each change">${icon('expand')}<span>Full file</span></button>` +
    `</span>` +
    themeToggleButton() +
    `</nav>\n` +
    `<section class="lens-section" id="lens-review" role="tabpanel" aria-labelledby="tab-review">${renderReviewLens(story)}</section>\n` +
    `<section class="lens-section" id="lens-diff" role="tabpanel" aria-labelledby="tab-diff">${renderDiffLens(story)}</section>\n` +
    `<section class="lens-section" id="lens-story" role="tabpanel" aria-labelledby="tab-story">${renderStoryLens(story)}</section>\n` +
    `<section class="lens-section" id="lens-report" role="tabpanel" aria-labelledby="tab-report">${renderReportLens(story)}</section>\n` +
    `<script>${SCRIPT}</script>\n` +
    (library ? `<script>${LIBRARY_SCRIPT}</script>\n` : '') +
    `</body>\n` +
    `</html>\n`
  );
}
