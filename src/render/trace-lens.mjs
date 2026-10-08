/**
 * Trace lens: the session as an execution trace, for people building or
 * debugging coding agents. A scorecard and metrics panel read
 * `story.metrics`; the timeline reads `story.trace.events` (see
 * src/ir/trace.mjs and src/ir/metrics.mjs). Everything is pre-rendered.
 * Filtering is CSS keyed on a data-filter attribute, and edit events link
 * to the diff already rendered in the Review lens instead of repeating it.
 * Unknown values are omitted or marked "not recorded", never shown as 0.
 */

import { escapeHtml } from './diff.mjs';
import { icon } from './icons.mjs';
import { statTile, plural } from './lenses.mjs';
import { msBetween } from '../ir/trace.mjs';

const USAGE_SOURCE_LABEL = {
  'cost-state': "Claude Code's session cost record",
  transcript: 'summed from the transcript, once per API call',
};

export function hasTrace(story) {
  return !!(story && story.trace && Array.isArray(story.trace.events));
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const pad = (n) => String(n).padStart(2, '0');

/** Time since the session started, as +m:ss or +h:mm:ss; '' when unknown. */
export function formatElapsed(ms) {
  if (!isNum(ms)) return '';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `+${h}:${pad(m)}:${pad(s)}` : `+${m}:${pad(s)}`;
}

export function formatLatency(ms) {
  if (!isNum(ms)) return null;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${total % 60}s`;
}

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

function na(reason) {
  return `<span class="trace-na">not recorded</span>` + (reason ? ` <span class="trace-note">${reason}</span>` : '');
}

function num(v) {
  return isNum(v) ? String(v) : na();
}

function row(label, valueHtml) {
  return `<dt>${label}</dt><dd>${valueHtml}</dd>`;
}

/** Input tokens including cache reads and writes, or null if any part is unknown. */
function inputWithCache(u) {
  const parts = [u.input_tokens, u.cache_read_tokens, u.cache_creation_tokens];
  return parts.every(isNum) ? parts.reduce((a, b) => a + b, 0) : null;
}

export function renderScorecard(metrics) {
  if (!metrics) return '';
  const x = metrics.execution || {};
  const c = metrics.code || {};
  const v = metrics.validation || {};
  const u = metrics.usage || {};
  const tiles = [];
  const duration = formatLatency(x.duration_ms);
  if (duration) tiles.push(statTile('clock', duration, 'duration'));
  if (isNum(x.turns)) tiles.push(statTile('turns', x.turns, plural(x.turns, 'turn')));
  if (isNum(x.tool_calls)) tiles.push(statTile('terminal', x.tool_calls, plural(x.tool_calls, 'tool call')));
  if (isNum(x.failed_tool_calls)) tiles.push(statTile('cross', x.failed_tool_calls, 'failed', x.failed_tool_calls > 0 ? 'removed' : ''));
  if (isNum(c.files_changed)) tiles.push(statTile('files', c.files_changed, `${plural(c.files_changed, 'file')} changed`));
  if (isNum(v.commands) && v.commands > 0) {
    const cls = v.final_state === 'passed' ? 'added' : v.final_state === 'failed' ? 'removed' : '';
    tiles.push(statTile('check', `${v.passed}/${v.commands}`, `validation, last ${escapeHtml(v.final_state)}`, cls));
  }
  if (isNum(x.retries)) tiles.push(statTile('retry', x.retries, x.retries === 1 ? 'retry' : 'retries'));
  const output = formatTokens(u.output_tokens);
  if (output) tiles.push(statTile('sparkle', output, 'output tokens'));
  const input = formatTokens(inputWithCache(u));
  if (input) tiles.push(statTile('sparkle', input, 'input tokens incl. cache'));
  const cost = formatCost(u.total_cost_usd);
  if (cost) tiles.push(statTile('cost', cost, 'cost'));
  return `<div class="trace-scorecard">${tiles.join('')}</div>`;
}

function group(title, rows) {
  return `<section class="trace-metric-group"><h3>${title}</h3><dl>${rows.join('')}</dl></section>`;
}

export function renderMetrics(story) {
  const m = story && story.metrics;
  if (!m) return '';
  const x = m.execution || {};
  const c = m.code || {};
  const v = m.validation || {};
  const r = m.reads || {};
  const u = m.usage || {};
  const repeated = c.files_edited_repeatedly || [];
  const groups = [
    group('Execution', [
      row('Duration', formatLatency(x.duration_ms) || na()),
      row('Turns', num(x.turns)),
      row('Tool calls', num(x.tool_calls)),
      row('Failed', num(x.failed_tool_calls)),
      row('Rejected', num(x.rejected_tool_calls)),
      row('Commands', num(x.commands)),
      row('Failed commands', num(x.failed_commands)),
      row('Retries', num(x.retries)),
    ]),
    group('Code', [
      row('Files changed', num(c.files_changed)),
      row('Lines added', num(c.lines_added)),
      row('Lines removed', num(c.lines_removed)),
      row('Edits', num(c.edits)),
      row('Edited more than once', repeated.length
        ? `<ul class="trace-list">${repeated.map((f) => `<li><code>${escapeHtml(f.rel)}</code> ×${f.edits}</li>`).join('')}</ul>`
        : 'none'),
    ]),
    group('Validation', [
      row('Test, lint, build runs', num(v.commands)),
      row('Passed', num(v.passed)),
      row('Failed', num(v.failed)),
      row('Last result', escapeHtml(v.final_state || 'unknown')),
      row('Last command', v.last_command ? `<code>${escapeHtml(v.last_command)}</code>` : na()),
    ]),
    group('Reads', [
      row('Files read', num(r.files_read)),
      row('Read, Glob, Grep calls', num(r.tool_calls)),
    ]),
  ];
  if (u.source && u.source !== 'none') {
    groups.push(group('Usage', [
      row('Input tokens', formatTokens(u.input_tokens) || na()),
      row('Output tokens', formatTokens(u.output_tokens) || na()),
      row('Cache read', formatTokens(u.cache_read_tokens) || na()),
      row('Cache write', formatTokens(u.cache_creation_tokens) || na()),
      row('Cost', formatCost(u.total_cost_usd) || na('Claude Code writes cost when a session ends')),
      row('Models', (u.models || []).map((model) => `<code>${escapeHtml(model)}</code>`).join(', ') || na()),
      row('Source', USAGE_SOURCE_LABEL[u.source] || escapeHtml(u.source)),
      ...(u.complete ? [] : [row('Complete', 'no, some API calls carried no usage')]),
    ]));
  }
  const env = story.environment && story.environment.agent;
  const envLine = env
    ? `<p class="trace-env">${escapeHtml(env.name || 'Agent')} ${escapeHtml(env.version || 'version not recorded')}</p>`
    : '';
  return `<aside class="trace-metrics">${groups.join('')}${envLine}</aside>`;
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);
const VALIDATION = new Set(['test', 'lint', 'build']);
const FAILURE = new Set(['error', 'rejected', 'interrupted']);
export const TRACE_FILTERS = [
  ['all', 'All'], ['prompt', 'Prompts'], ['tool', 'Tools'], ['command', 'Commands'],
  ['edit', 'Edits'], ['test', 'Tests'], ['error', 'Errors'], ['subagent', 'Subagents'],
];
const STATUS_ICON = { ok: 'check', error: 'cross', rejected: 'cross', interrupted: 'warning', unknown: 'clock' };
const STATUS_LABEL = { ok: 'ok', error: 'failed', rejected: 'rejected by the user', interrupted: 'interrupted', unknown: 'no result recorded' };
const DURATION_SOURCE_LABEL = { transcript: 'reported by Claude Code', derived: 'estimated from timestamps', unknown: 'not recorded' };
const ENDED_LABEL = {
  result: 'its tool result',
  notification: 'completion notice',
  subagent_transcript: 'last record of its own transcript (provisional)',
};

/** The filters an event belongs to, space-separated for data-groups. */
export function eventGroups(event) {
  if (event.kind === 'prompt') return 'prompt';
  const groups = ['tool'];
  if (event.tool === 'Bash') groups.push('command');
  if (EDIT_TOOLS.has(event.tool)) groups.push('edit');
  if (VALIDATION.has(event.category)) groups.push('test');
  if (event.kind === 'subagent' || event.parent_id) groups.push('subagent');
  if (event.status === 'error' || event.status === 'rejected') groups.push('error');
  if (FAILURE.has(event.status)) groups.push('failure');
  return groups.join(' ');
}

function indexTurns(turns) {
  const index = { bash: new Map(), errors: new Map(), edits: new Map(), byIndex: new Map() };
  for (const turn of turns || []) {
    index.byIndex.set(turn.index, turn);
    for (const b of turn.bash || []) index.bash.set(b.id, b);
    for (const e of turn.errors || []) index.errors.set(e.id, e);
    for (const e of turn.edits || []) if (e.id) index.edits.set(e.id, e);
  }
  return index;
}

function jumpButton(turn, label, editId) {
  const edit = editId ? ` data-jump-edit="${escapeHtml(editId)}"` : '';
  return `<button type="button" class="trace-jump"${edit} data-turn="${turn}">${label}</button>`;
}

function renderDetail(event, ctx) {
  const latency = formatLatency(event.duration_ms);
  const rows = [
    row('Turn', `${event.turn} ${jumpButton(event.turn, 'Open in Review')}`),
    row('Status', escapeHtml(STATUS_LABEL[event.status] || event.status)),
    row('Started', event.started_at ? `<time>${escapeHtml(event.started_at)}</time>` : na()),
    row('Ended', event.ended_at ? `<time>${escapeHtml(event.ended_at)}</time>` : na()),
    row('Latency', latency
      ? `${latency} <span class="trace-note">result time minus call time, includes permission and hook wait</span>`
      : na()),
    row('Source', escapeHtml(event.agent_id ? `subagent transcript (${event.agent_id})` : 'session transcript')),
  ];
  if (event.kind === 'subagent') {
    rows.push(row('Ended by', ENDED_LABEL[event.ended_source] || na()));
    rows.push(row('Tool calls', String(ctx.childCount.get(event.id) || 0)));
    const u = event.usage;
    rows.push(row('Tokens', u
      ? `${formatTokens(u.output_tokens)} out, ${formatTokens(inputWithCache(u))} in incl. cache`
      : na()));
  }
  const bash = ctx.turns.bash.get(event.id);
  if (bash) {
    rows.push(row('Exit code', isNum(bash.exit_code) ? String(bash.exit_code) : na()));
    if (bash.ok === false && bash.output_tail) {
      rows.push(row('Output', `<pre class="trace-output">${escapeHtml(bash.output_tail)}</pre>`));
    }
  }
  const error = ctx.turns.errors.get(event.id);
  if (error) {
    rows.push(row('Error', `<span class="error-message">${escapeHtml(error.message)}</span>`));
    if (error.resolution) rows.push(row('Resolution', escapeHtml(error.resolution)));
  }
  const edit = ctx.turns.edits.get(event.id);
  if (edit) {
    const stats = edit.stats
      ? ` <span class="edit-stats"><span class="add">+${edit.stats.added}</span><span class="del">−${edit.stats.removed}</span></span>`
      : '';
    rows.push(row('Diff', jumpButton(event.turn, 'View diff in Review', edit.id) + stats));
  }
  return `<dl class="trace-detail">${rows.join('')}</dl>`;
}

function renderEvent(event, ctx) {
  const time = ctx.base ? formatElapsed(msBetween(ctx.base, event.started_at)) : '';
  if (event.kind === 'prompt') {
    const turn = ctx.turns.byIndex.get(event.turn) || {};
    const source = DURATION_SOURCE_LABEL[turn.duration_source] || 'not recorded';
    return (
      `<li class="trace-event trace-prompt" data-groups="prompt" data-turn="${event.turn}">` +
      `<div class="trace-prompt-row">` +
      `<span class="trace-time">${time}</span>` +
      `<span class="trace-turn">Turn ${event.turn}</span>` +
      `<span class="trace-prompt-text">${escapeHtml(turn.summary || event.summary || '')}</span>` +
      `<span class="trace-dur" title="${source}">${formatLatency(turn.duration_ms) || '—'}</span>` +
      jumpButton(event.turn, 'Open in Review') +
      `</div></li>`
    );
  }
  const label = event.kind === 'subagent'
    ? (event.agent_type ? `Agent · ${event.agent_type}` : 'Agent')
    : (event.tool || 'tool');
  const category = event.category && event.category !== 'other'
    ? `<span class="badge trace-cat">${escapeHtml(event.category)}</span>`
    : '';
  const status = escapeHtml(event.status);
  const child = event.parent_id ? ' trace-child' : '';
  return (
    `<li class="trace-event trace-${escapeHtml(event.kind)}${child}" data-groups="${eventGroups(event)}" data-status="${status}">` +
    `<details><summary>` +
    `<span class="trace-time">${time}</span>` +
    `<span class="trace-status st-${status}" title="${escapeHtml(STATUS_LABEL[event.status] || event.status)}">${icon(STATUS_ICON[event.status] || 'warning')}</span>` +
    `<span class="badge trace-tool">${escapeHtml(label)}</span>` +
    category +
    `<code class="trace-summary">${escapeHtml(event.summary || '')}</code>` +
    `<span class="trace-dur">${formatLatency(event.duration_ms) || '—'}</span>` +
    `</summary>` +
    renderDetail(event, ctx) +
    `</details></li>`
  );
}

function countGroups(events) {
  const counts = { all: events.length, failure: 0 };
  for (const [key] of TRACE_FILTERS) if (key !== 'all') counts[key] = 0;
  for (const event of events) {
    for (const g of eventGroups(event).split(' ')) counts[g] = (counts[g] || 0) + 1;
  }
  return counts;
}

function renderFilters(events) {
  const counts = countGroups(events);
  const buttons = TRACE_FILTERS.map(([key, label]) => (
    `<button type="button" class="trace-filter" data-trace-filter="${key}" aria-pressed="${key === 'all'}">` +
    `${label} <span class="trace-count">${counts[key]}</span></button>`
  )).join('');
  return (
    `<div class="trace-filters" role="group" aria-label="Filter events">${buttons}` +
    `<button type="button" class="trace-failures" aria-pressed="false">${icon('warning')}<span>Failures only</span> ` +
    `<span class="trace-count">${counts.failure}</span></button></div>`
  );
}

/**
 * @param {object} story - Story IR with `trace` (and usually `metrics`)
 * @returns {string}
 */
export function renderTraceLens(story) {
  const events = hasTrace(story) ? story.trace.events : [];
  const firstDated = events.find((e) => e.started_at);
  const ctx = {
    turns: indexTurns(story.turns),
    base: (story.session && story.session.started_at) || (firstDated && firstDated.started_at) || null,
    childCount: new Map(),
  };
  for (const e of events) if (e.parent_id) ctx.childCount.set(e.parent_id, (ctx.childCount.get(e.parent_id) || 0) + 1);
  const timeline = events.length
    ? `<ol class="trace-timeline">${events.map((e) => renderEvent(e, ctx)).join('')}</ol>`
    : `<p class="report-empty">No events recorded.</p>`;
  return (
    `<div class="trace-lens">` +
    renderScorecard(story.metrics) +
    `<div class="trace-body"><div class="trace-main">${renderFilters(events)}${timeline}</div>${renderMetrics(story)}</div>` +
    `</div>`
  );
}
const FILTER_CSS = TRACE_FILTERS
  .filter(([key]) => key !== 'all')
  .map(([key]) => (key === 'prompt'
    ? 'html.js #lens-trace[data-filter="prompt"] .trace-event:not(.trace-prompt) { display: none; }'
    : `html.js #lens-trace[data-filter="${key}"] .trace-event:not(.trace-prompt):not([data-groups~="${key}"]) { display: none; }`))
  .join('\n');

export const TRACE_CSS = `
.trace-lens { max-width: 1200px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
.trace-scorecard { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; }
.trace-body { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; align-items: start; }
.trace-filters { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
html:not(.js) .trace-filters, html:not(.js) .trace-jump { display: none; }
.trace-filter, .trace-failures { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--text-2); font: inherit; font-size: 12px; cursor: pointer; }
.trace-failures .icon { width: 13px; height: 13px; }
.trace-filter[aria-pressed="true"], .trace-failures[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent-ring); color: var(--accent-ink); }
.trace-count { font-family: var(--mono); font-size: 11px; color: var(--text-3); }
.trace-timeline { list-style: none; margin: 0; padding: 0; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.trace-event { border-top: 1px solid var(--border); }
.trace-event:first-child { border-top: none; }
.trace-event summary, .trace-prompt-row { display: flex; align-items: center; gap: 8px; padding: 6px 10px; min-width: 0; }
.trace-event summary { cursor: pointer; list-style: none; }
.trace-event summary::-webkit-details-marker { display: none; }
.trace-event summary:hover { background: var(--surface-2); }
.trace-prompt-row { background: var(--surface-2); }
.trace-child summary { padding-left: 34px; }
.trace-time, .trace-dur { font-family: var(--mono); font-size: 11px; color: var(--text-3); font-variant-numeric: tabular-nums; white-space: nowrap; }
.trace-time { min-width: 56px; }
.trace-dur { margin-left: auto; }
.trace-turn { font-family: var(--mono); font-size: 11px; color: var(--accent-ink); white-space: nowrap; }
.trace-prompt-text { flex: 1; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.trace-summary { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--mono); font-size: 12px; }
.trace-status { display: inline-flex; width: 16px; height: 16px; flex: none; }
.st-ok .icon { color: var(--add); }
.st-error .icon, .st-rejected .icon { color: var(--del); }
.st-interrupted .icon, .st-unknown .icon { color: var(--text-3); }
.trace-detail { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 12px; margin: 0; padding: 8px 10px 12px 76px; font-size: 12px; }
.trace-detail dt, .trace-metric-group dt { color: var(--text-3); }
.trace-detail dd, .trace-metric-group dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.trace-output { margin: 0; max-height: 240px; overflow: auto; padding: 8px; background: var(--surface-2); border-radius: 6px; font-family: var(--mono); font-size: 11px; white-space: pre-wrap; }
.trace-na, .trace-note { color: var(--text-3); font-style: italic; }
.trace-jump { padding: 2px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--accent-ink); font: inherit; font-size: 11px; cursor: pointer; white-space: nowrap; }
.trace-jump:hover { border-color: var(--accent-ring); }
.trace-metrics { display: flex; flex-direction: column; gap: 12px; position: sticky; top: 64px; }
.trace-metric-group { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px 14px; }
.trace-metric-group h3 { margin: 0 0 8px; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-2); }
.trace-metric-group dl { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; margin: 0; font-size: 12px; }
.trace-metric-group dd { text-align: right; font-family: var(--mono); }
.trace-list { margin: 0; padding: 0; list-style: none; }
.trace-env { margin: 0; font-size: 11px; color: var(--text-3); }
@media (max-width: 900px) {
  .trace-body { grid-template-columns: minmax(0, 1fr); }
  .trace-metrics { position: static; }
  .trace-detail { padding-left: 10px; }
}
${FILTER_CSS}
html.js #lens-trace.failures-only .trace-event:not(.trace-prompt):not([data-groups~="failure"]) { display: none; }
@media print { .trace-filters, .trace-jump { display: none !important; } .trace-metrics { position: static; } }
`;
/**
 * Runs inside the page script's IIFE (src/render/template.mjs), which
 * provides root, showLens, turns, reduceMotion and revealEdit.
 */
export const TRACE_SCRIPT = `
  var traceLens = document.getElementById('lens-trace');
  if (traceLens) {
    var traceFilters = Array.prototype.slice.call(traceLens.querySelectorAll('[data-trace-filter]'));
    var setTraceFilter = function (name) {
      traceLens.setAttribute('data-filter', name);
      traceFilters.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.traceFilter === name)); });
    };
    traceFilters.forEach(function (b) {
      b.addEventListener('click', function () { setTraceFilter(b.dataset.traceFilter); });
    });
    var failuresButton = traceLens.querySelector('.trace-failures');
    if (failuresButton) {
      failuresButton.addEventListener('click', function () {
        var on = traceLens.classList.toggle('failures-only');
        failuresButton.setAttribute('aria-pressed', String(on));
      });
    }
    traceLens.addEventListener('click', function (e) {
      var jump = e.target && e.target.closest ? e.target.closest('.trace-jump') : null;
      if (!jump) return;
      e.preventDefault();
      showLens('review');
      turns.select(jump.dataset.turn);
      var editId = jump.dataset.jumpEdit;
      if (!editId) {
        var item = turns.items.filter(function (i) { return i.dataset.turn === jump.dataset.turn; })[0];
        if (item) item.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
        return;
      }
      var panel = document.querySelector('.turn-panel.active');
      var target = null;
      if (panel) {
        Array.prototype.forEach.call(panel.querySelectorAll('.edit-header'), function (header) {
          if (!target && header.dataset.editId === editId) target = header.closest('.edit');
        });
      }
      if (!target) return;
      // An edit outside the project is hidden while "Project files only" is on.
      if (target.getAttribute('data-outside') === '1' && !root.classList.contains('show-outside')) {
        var scope = document.querySelector('.opt-toggle[data-opt="scope"]');
        if (scope) scope.click();
      }
      revealEdit(target);
    });
    setTraceFilter('all');
  }
`;
