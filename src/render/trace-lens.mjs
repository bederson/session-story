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
