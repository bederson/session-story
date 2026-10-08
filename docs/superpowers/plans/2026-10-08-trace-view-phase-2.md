# Trace View (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fifth **Trace** tab to the session story page. It shows Phase 1's trace and metrics: a scorecard, a time-ordered event timeline you can expand and filter, a metrics panel, and edit events that jump to their diff in Review.

**Architecture:** A new `src/render/trace-lens.mjs` renders the lens as pre-rendered HTML, like every other lens. It exports `renderTraceLens(story)`, its CSS and its client script. `template.mjs` adds the tab and section only when `story.trace` exists, so older stories get no new tab. Filtering is CSS driven by a `data-filter` attribute on the section, the same pattern as the existing scope toggle. No JSON is embedded and no diff is rendered twice.

**Tech Stack:** Node ≥18.18 ESM, zero dependencies, inline CSS/JS, `node --test` with regex assertions on HTML strings.

**Spec:** `docs/superpowers/specs/metafyl-improvements-impl-plan-0810.md` §10–§14, §18, §19 (Renderer). It builds on Phase 1: `docs/superpowers/plans/2026-10-08-agent-observability-phase-1.md` and `docs/superpowers/specs/2026-10-08-transcript-record-audit.md`.

## Context

The user ran `/story` after Phase 1 and saw no difference. That was by design: Phase 1 only added data to `story.json`. This phase makes it visible. Agreed decisions that still apply:
- Edit events link to the existing Review diff; hunks are not re-rendered.
- Unknown values are shown as "not recorded" or omitted, never as 0.
- Findings and interpretations (spec §14) are Phase 3 and 4, not this plan.

Facts about the current renderer this plan relies on:
- `renderPage` in `src/render/template.mjs` builds the tabs with `lensTab(name, label)`. The tab name must be an icon key in `src/render/icons.mjs`, or `icon()` throws.
- Lens switching (`showLens`), turn selection (`turns.select`), and the chip "scroll and flash" behavior live in one IIFE in the template's `SCRIPT`. The trace script must run inside that IIFE to reuse them.
- Existing tests match `<div class="edit" data-file="…">` exactly. The edit id therefore goes on the inner `.edit-header`, not the outer div.
- `statTile(name, value, label, extraClass)` in `src/render/lenses.mjs` draws the header tiles. It is not exported yet.

## Global Constraints

- The page stays a single self-contained file: no network, CDN, or external JS/CSS, and it works from `file://`.
- Zero runtime dependencies. All text from the story goes through `escapeHtml` from `src/render/diff.mjs`.
- A story without `trace` renders no Trace tab and no trace section.
- A `null` metric is shown as "not recorded" in the metrics panel and its tile is omitted from the scorecard. It is never shown as 0.
- Works without JS: all events are visible, and the filter bar and jump buttons are hidden.
- Layout works at phone width: grids collapse to one column under 900px.

## Review Focus

1. **Old story.json without `trace`:** no Trace tab, no `lens-trace` section, and the page still renders. → Task 3.
2. **Hostile text in a command, prompt or error** (`<script>`, quotes): escaped everywhere in the Trace lens. → Task 2.
3. **A session still running:** cost and usage are absent or partial. The cost tile is omitted, and the metrics panel says "not recorded" with the reason. → Task 1.
4. **An edit outside the project** (hidden by "Project files only"): "View diff" switches the scope toggle on before scrolling, instead of jumping to nothing. → Task 4.
5. **A large session** with hundreds of events: per-event markup stays small, with no output except tails of failed commands. → Task 2 asserts the absence of hunk tables.

---

## File Structure

- Create `src/render/trace-lens.mjs`. It holds the formatters, scorecard, timeline, metrics panel, `TRACE_CSS` and `TRACE_SCRIPT`. It is named `trace-lens` to avoid confusion with `src/ir/trace.mjs`.
- Modify `src/render/template.mjs`: the conditional tab and section, the CSS include, the script include, and a shared `revealEdit` helper.
- Modify `src/render/lenses.mjs`: export `statTile`.
- Modify `src/render/diff.mjs`: add `data-edit-id` to `.edit-header`.
- Modify `src/render/icons.mjs`: add the `trace`, `retry` and `cost` icons.
- Tests: create `test/trace-lens.test.mjs`; extend `test/template.test.mjs`, `test/diff-render.test.mjs` and `test/cli.test.mjs`.
- Docs: `README.md` (view table, five views) and `SKILL.md` step 4.

---

### Task 1: Formatters, scorecard and metrics panel

**Files:**
- Create: `src/render/trace-lens.mjs`
- Modify: `src/render/lenses.mjs` (export `statTile`), `src/render/icons.mjs`
- Test: `test/trace-lens.test.mjs`

**Interfaces:**
- Produces: `hasTrace(story) → boolean`, `formatElapsed(ms) → string`, `formatLatency(ms) → string|null`, `formatTokens(n) → string|null`, `formatCost(usd) → string|null`, `renderScorecard(metrics) → string`, `renderMetrics(story) → string`.

- [ ] **Step 1: Write the failing tests**

```js
// test/trace-lens.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasTrace, formatElapsed, formatLatency, formatTokens, formatCost, renderScorecard, renderMetrics,
} from '../src/render/trace-lens.mjs';

function metrics(overrides = {}) {
  return {
    execution: { duration_ms: 18500, turns: 1, tool_calls: 4, failed_tool_calls: 1, rejected_tool_calls: 0, commands: 2, failed_commands: 1, retries: 1 },
    code: { files_changed: 1, lines_added: 1, lines_removed: 1, edits: 1, files_edited_repeatedly: [{ rel: 'src/a.js', edits: 3 }] },
    validation: { commands: 2, passed: 1, failed: 1, final_state: 'passed', last_command: 'npm test' },
    reads: { files_read: 1, tool_calls: 1 },
    usage: { input_tokens: 30, output_tokens: 178700, cache_read_tokens: 1100, cache_creation_tokens: 100, total_cost_usd: 0.05, models: ['claude-opus-5-5'], source: 'cost-state', complete: true },
    ...overrides,
  };
}

test('hasTrace is true only for a story with a trace events array', () => {
  assert.equal(hasTrace({ trace: { events: [] } }), true);
  assert.equal(hasTrace({}), false);
  assert.equal(hasTrace({ trace: {} }), false);
});

test('formatters render elapsed time, latency, tokens and cost, and return null for unknown', () => {
  assert.equal(formatElapsed(7000), '+0:07');
  assert.equal(formatElapsed(3723000), '+1:02:03');
  assert.equal(formatElapsed(null), '');
  assert.equal(formatLatency(420), '420 ms');
  assert.equal(formatLatency(7000), '7.0 s');
  assert.equal(formatLatency(112000), '1m 52s');
  assert.equal(formatLatency(4498209), '1h 14m');
  assert.equal(formatLatency(null), null);
  assert.equal(formatTokens(860), '860');
  assert.equal(formatTokens(178717), '178.7k');
  assert.equal(formatTokens(15908759), '15.9M');
  assert.equal(formatTokens(null), null);
  assert.equal(formatCost(4.2226), '$4.22');
  assert.equal(formatCost(0.004), '<$0.01');
  assert.equal(formatCost(null), null);
});

test('scorecard shows duration, calls, failures, files, validation, retries, tokens and cost', () => {
  const html = renderScorecard(metrics());
  for (const text of ['18.5 s', '4', 'tool calls', 'failed', 'file changed', '1/2', 'validation', 'retry', '178.7k', 'output tokens', '$0.05']) {
    assert.ok(html.includes(text), `missing ${text}`);
  }
});

test('scorecard omits tiles for unknown values instead of showing 0', () => {
  const html = renderScorecard(metrics({
    execution: { duration_ms: null, turns: 1, tool_calls: null, failed_tool_calls: null, rejected_tool_calls: null, commands: 0, failed_commands: 0, retries: 0 },
    validation: { commands: 0, passed: 0, failed: 0, final_state: 'none', last_command: null },
    usage: { input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_creation_tokens: null, total_cost_usd: null, models: [], source: 'none', complete: false },
  }));
  assert.doesNotMatch(html, /duration|tool calls|failed|validation|tokens|cost/);
  assert.match(html, /turn/);
  assert.equal(renderScorecard(undefined), '');
});

test('scorecard omits the cost tile when tokens are known but cost is not', () => {
  const html = renderScorecard(metrics({ usage: { ...metrics().usage, total_cost_usd: null, source: 'transcript' } }));
  assert.match(html, /output tokens/);
  assert.doesNotMatch(html, /\$/);
});

test('metrics panel groups execution, code, validation, reads and usage, and marks nulls as not recorded', () => {
  const story = {
    metrics: metrics({ reads: { files_read: null, tool_calls: null }, usage: { ...metrics().usage, total_cost_usd: null, source: 'transcript' } }),
    environment: { agent: { name: 'Claude Code', version: '2.1.292' }, models: ['claude-opus-5-5'] },
  };
  const html = renderMetrics(story);
  for (const h of ['Execution', 'Code', 'Validation', 'Reads', 'Usage']) assert.match(html, new RegExp(`<h3>${h}</h3>`));
  assert.match(html, /src\/a\.js<\/code> ×3/);
  assert.match(html, /not recorded/);
  assert.match(html, /Claude Code writes cost when a session ends/);
  assert.match(html, /summed from the transcript/);
  assert.match(html, /Claude Code 2\.1\.292/);
});

test('metrics panel leaves out Usage when nothing carried usage, and is empty without metrics', () => {
  const html = renderMetrics({ metrics: metrics({ usage: { input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_creation_tokens: null, total_cost_usd: null, models: [], source: 'none', complete: false } }) });
  assert.doesNotMatch(html, /<h3>Usage<\/h3>/);
  assert.equal(renderMetrics({}), '');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/trace-lens.test.mjs`
Expected: FAIL with `Cannot find module '../src/render/trace-lens.mjs'`.

- [ ] **Step 3: Export `statTile` and add the icons**

In `src/render/lenses.mjs`, change `function statTile(` to `export function statTile(`.

In `src/render/icons.mjs`, add to `ICONS`:

```js
  trace: '<path d="M2.5 3.5h3M2.5 8h6M2.5 12.5h4.5"/><circle cx="8" cy="3.5" r="1.3"/><circle cx="11" cy="8" r="1.3"/><circle cx="9.5" cy="12.5" r="1.3"/>',
  retry: '<path d="M13 8a5 5 0 1 1-1.5-3.55"/><path d="M13 2.5v3h-3"/>',
  cost: '<circle cx="8" cy="8" r="6"/><path d="M10 5.8c-.4-.6-1.1-.9-2-.9-1.2 0-2 .6-2 1.5 0 2 4 1 4 3.1 0 .9-.9 1.6-2.1 1.6-.9 0-1.7-.4-2.1-1M8 3.6v1.3M8 11.1v1.3"/>',
```

- [ ] **Step 4: Implement the first part of `src/render/trace-lens.mjs`**

```js
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
```

- [ ] **Step 5: Run the tests, then the whole suite**

Run: `node --test test/trace-lens.test.mjs && npm test`
Expected: PASS. Adding icons breaks no existing test, because `test/icons.test.mjs` only checks that every name renders.

- [ ] **Step 6: Commit**

```bash
git add src/render/trace-lens.mjs src/render/lenses.mjs src/render/icons.mjs test/trace-lens.test.mjs
git commit -m "feat(trace-lens): formatters, scorecard and metrics panel"
```

---

### Task 2: Timeline events, filters and details

**Files:**
- Modify: `src/render/trace-lens.mjs`, `src/render/diff.mjs`
- Test: `test/trace-lens.test.mjs`, `test/diff-render.test.mjs`

**Interfaces:**
- Consumes: `msBetween` from `src/ir/trace.mjs`.
- Produces: `TRACE_FILTERS`, `eventGroups(event) → string`, `renderTraceLens(story) → string`. Markup contract used by Task 3's CSS and Task 4's script:
  - `li.trace-event` carries `data-groups` and `data-status`, plus `.trace-prompt` or `.trace-child` where they apply.
  - Filter buttons carry `[data-trace-filter]`; the failures toggle is `.trace-failures`.
  - Jump buttons are `.trace-jump[data-turn]` with an optional `data-jump-edit`.
  - `.edit-header[data-edit-id]` sits in `diff.mjs`.

- [ ] **Step 1: Write the failing tests** (append to `test/trace-lens.test.mjs`; add `eventGroups, renderTraceLens` to the import)

```js
function traceStory() {
  return {
    session: { id: 's1', started_at: '2026-10-08T10:00:00.000Z' },
    turns: [{
      index: 1, id: 'u1', prompt: 'Fix the failing test', summary: 'Fixed the failing test.',
      duration_ms: 18000, duration_source: 'transcript',
      edits: [{ id: 'tu3', rel: 'src/a.js', stats: { added: 1, removed: 1 } }],
      bash: [{ id: 'tu2', command: 'npm test', category: 'test', ok: false, exit_code: 1, output_tail: '1 failing <b>' }],
      errors: [{ id: 'tu2', tool: 'Bash', kind: 'error', message: 'Exit code 1', resolution: 'Fixed the assertion.' }],
    }],
    trace: { events: [
      { id: 'u1', kind: 'prompt', turn: 1, parent_id: null, tool: null, category: null, status: 'ok', summary: 'Fix the failing test', started_at: '2026-10-08T10:00:00.000Z', ended_at: null, duration_ms: 18000, source: 'transcript' },
      { id: 'tu2', kind: 'tool', turn: 1, parent_id: null, tool: 'Bash', category: 'test', status: 'error', summary: 'npm test <script>x</script>', started_at: '2026-10-08T10:00:03.000Z', ended_at: '2026-10-08T10:00:10.000Z', duration_ms: 7000, source: 'transcript' },
      { id: 'tu3', kind: 'tool', turn: 1, parent_id: null, tool: 'Edit', category: null, status: 'ok', summary: 'src/a.js', started_at: '2026-10-08T10:00:11.000Z', ended_at: '2026-10-08T10:00:12.000Z', duration_ms: 1000, source: 'transcript' },
      { id: 'ag', kind: 'subagent', turn: 1, parent_id: null, tool: 'Agent', category: null, status: 'ok', summary: 'Explore IR', started_at: '2026-10-08T10:00:12.500Z', ended_at: '2026-10-08T10:00:20.000Z', duration_ms: 7500, source: 'transcript', agent_id: 'ag1', agent_type: 'Explore', ended_source: 'notification', usage: { input_tokens: 5, output_tokens: 7, cache_read_tokens: 0, cache_creation_tokens: 0, api_calls: 1, models: [], complete: true } },
      { id: 'st1', kind: 'tool', turn: 1, parent_id: 'ag', tool: 'Read', category: null, status: 'ok', summary: 'src/b.js', started_at: '2026-10-08T10:00:13.000Z', ended_at: '2026-10-08T10:00:13.400Z', duration_ms: 400, source: 'transcript', agent_id: 'ag1' },
      { id: 'tu9', kind: 'tool', turn: 1, parent_id: null, tool: 'Read', category: null, status: 'unknown', summary: 'src/c.js', started_at: '2026-10-08T10:00:21.000Z', ended_at: null, duration_ms: null, source: 'transcript' },
    ], cost_states: [] },
    metrics: metrics(),
  };
}

test('eventGroups tags events for every filter they belong to', () => {
  const e = traceStory().trace.events;
  assert.equal(eventGroups(e[0]), 'prompt');
  assert.equal(eventGroups(e[1]), 'tool command test error failure');
  assert.equal(eventGroups(e[2]), 'tool edit');
  assert.equal(eventGroups(e[3]), 'tool subagent');
  assert.equal(eventGroups(e[4]), 'tool subagent');
  assert.equal(eventGroups({ kind: 'tool', tool: 'Bash', status: 'interrupted' }), 'tool command failure');
});

test('the timeline has one row per event, in order, with elapsed time, status and latency', () => {
  const html = renderTraceLens(traceStory());
  assert.equal((html.match(/<li class="trace-event/g) || []).length, 6);
  assert.match(html, /<li class="trace-event trace-prompt" data-groups="prompt" data-turn="1">/);
  assert.match(html, /\+0:03[\s\S]*st-error[\s\S]*7\.0 s/);
  assert.match(html, /<li class="trace-event trace-tool trace-child" data-groups="tool subagent" data-status="ok">/);
  assert.match(html, /Agent · Explore/);
});

test('the prompt row shows the turn summary and where its duration came from', () => {
  const html = renderTraceLens(traceStory());
  assert.match(html, /Fixed the failing test\./);
  assert.match(html, /title="reported by Claude Code">18\.0 s/);
});

test('details show the failed command output, the error and its resolution, escaped', () => {
  const html = renderTraceLens(traceStory());
  assert.match(html, /<pre class="trace-output">1 failing &lt;b&gt;<\/pre>/);
  assert.match(html, /Fixed the assertion\./);
  assert.match(html, /npm test &lt;script&gt;x&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>x<\/script>/);
});

test('an edit event offers a jump to its diff in Review; a call with no result says so', () => {
  const html = renderTraceLens(traceStory());
  assert.match(html, /class="trace-jump" data-jump-edit="tu3" data-turn="1"/);
  assert.match(html, /no result recorded/);
});

test('a subagent event names how it ended, its tool calls and tokens', () => {
  const html = renderTraceLens(traceStory());
  assert.match(html, /completion notice/);
  assert.match(html, /<dt>Tool calls<\/dt><dd>1<\/dd>/);
  assert.match(html, /7 out/);
});

test('filter buttons carry counts and the lens renders no hunk tables', () => {
  const html = renderTraceLens(traceStory());
  assert.match(html, /data-trace-filter="all" aria-pressed="true">All <span class="trace-count">6<\/span>/);
  assert.match(html, /data-trace-filter="edit" aria-pressed="false">Edits <span class="trace-count">1<\/span>/);
  assert.match(html, /class="trace-failures" aria-pressed="false">[\s\S]*?<span class="trace-count">1<\/span>/);
  assert.doesNotMatch(html, /<table class="hunk"/);
});

test('a trace with no events says so', () => {
  assert.match(renderTraceLens({ session: {}, turns: [], trace: { events: [] } }), /No events recorded\./);
});
```

In `test/diff-render.test.mjs`:

```js
test('renderEdit puts the edit id on its header so the Trace lens can jump to it', () => {
  assert.match(renderEdit({ id: 'tu3', tool: 'Edit', rel: 'src/a.ts', result: 'ok', hunks: [], stats: { added: 0, removed: 0 } }), /<div class="edit-header" data-edit-id="tu3">/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/trace-lens.test.mjs test/diff-render.test.mjs`
Expected: FAIL because `eventGroups` and `renderTraceLens` are not exported and the header has no `data-edit-id`.

- [ ] **Step 3: Add the edit id in `src/render/diff.mjs` `renderEdit`**

```js
    `<div class="edit-header" data-edit-id="${escapeHtml(edit.id || '')}">` +
```

(It replaces `` `<div class="edit-header">` + ``.)

- [ ] **Step 4: Implement the timeline in `src/render/trace-lens.mjs`**

Add the import `import { msBetween } from '../ir/trace.mjs';` and:

```js
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
```

- [ ] **Step 5: Run the tests, then the whole suite**

Run: `node --test test/trace-lens.test.mjs test/diff-render.test.mjs && npm test`
Expected: PASS. The existing `class="edit" data-file=` assertions are unaffected because the new attribute is on the header.

- [ ] **Step 6: Commit**

```bash
git add src/render/trace-lens.mjs src/render/diff.mjs test/trace-lens.test.mjs test/diff-render.test.mjs
git commit -m "feat(trace-lens): timeline with filters, event details and jump links"
```

---

### Task 3: Put the Trace tab on the page

**Files:**
- Modify: `src/render/trace-lens.mjs` (add `TRACE_CSS`), `src/render/template.mjs`
- Test: `test/template.test.mjs` (replace the Phase 1 "unchanged" pin), `test/cli.test.mjs`

**Interfaces:**
- `renderPage` adds `lensTab('trace', 'Trace')` after Report and `<section class="lens-section" id="lens-trace" …>` only when `hasTrace(story)`.

- [ ] **Step 1: Write the failing tests**

In `test/template.test.mjs`, replace the test `renderPage output is unchanged by the Phase 1 trace, metrics and environment blocks` with:

```js
test('a story with a trace gets a fifth Trace tab and section after Report', () => {
  const story = Object.assign(sampleStory(), {
    trace: { events: [{ id: 'u1', kind: 'prompt', turn: 1, status: 'ok', summary: 'x', started_at: null, ended_at: null, duration_ms: null, source: 'transcript' }], cost_states: [] },
    metrics: { execution: { turns: 1 }, code: {}, validation: { final_state: 'none' }, reads: {}, usage: { source: 'none' } },
  });
  const html = renderPage(story);
  assert.match(html, /id="tab-report"[\s\S]*id="tab-trace"/);
  assert.match(html, /<section class="lens-section" id="lens-trace" role="tabpanel" aria-labelledby="tab-trace">/);
});

test('a story without a trace (older story.json) gets no Trace tab', () => {
  const html = renderPage(sampleStory());
  assert.doesNotMatch(html, /tab-trace|id="lens-trace"/);
  assert.match(html, /id="lens-report"/);
});

test('the page references nothing over the network', () => {
  const html = renderPage(Object.assign(sampleStory(), { trace: { events: [] } }));
  assert.doesNotMatch(html, /(src|href)="(https?:)?\/\//);
  assert.doesNotMatch(html, /@import|url\(http/);
});
```

In `test/cli.test.mjs`, in `extract writes trace, metrics and environment…`, replace the last line `assert.doesNotMatch(html, /id="lens-trace"/);` with:

```js
  assert.match(html, /id="lens-trace"/);
  assert.equal((html.match(/class="lens-tab"/g) || []).length, 5);
  assert.match(html, /data-jump-edit="tu3"/);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/template.test.mjs test/cli.test.mjs`
Expected: FAIL because there is no `tab-trace`.

- [ ] **Step 3: Add `TRACE_CSS` to `src/render/trace-lens.mjs`**

```js
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
```

- [ ] **Step 4: Wire it into `src/render/template.mjs`**

- Import: `import { renderTraceLens, hasTrace, TRACE_CSS } from './trace-lens.mjs';`
- In `STYLE`, add `${TRACE_CSS}` just before the `@media print` block.
- In `renderPage`, after `lensTab('report', 'Report')`, add `(hasTrace(story) ? lensTab('trace', 'Trace') : '')`.
- After the `lens-report` section line, add:

```js
    (hasTrace(story)
      ? `<section class="lens-section" id="lens-trace" role="tabpanel" aria-labelledby="tab-trace">${renderTraceLens(story)}</section>\n`
      : '') +
```

- Update the JSDoc "all three lenses" to "every lens (Review, Diff, Story, Report, and Trace when the story has a trace)".

- [ ] **Step 5: Run the tests, then the whole suite**

Run: `node --test test/template.test.mjs test/cli.test.mjs && npm test`
Expected: PASS. The first CLI test's hunk-table count (6) is unchanged because the Trace lens renders none.

- [ ] **Step 6: Commit**

```bash
git add src/render/trace-lens.mjs src/render/template.mjs test/template.test.mjs test/cli.test.mjs
git commit -m "feat(render): fifth Trace tab when the story has a trace"
```

---

### Task 4: Client behavior for filters, failures-only and jump to diff

**Files:**
- Modify: `src/render/trace-lens.mjs` (add `TRACE_SCRIPT`), `src/render/template.mjs` (`SCRIPT`)
- Test: `test/template.test.mjs`

**Interfaces:**
- `TRACE_SCRIPT` is a JS source fragment interpolated *inside* the template's `SCRIPT` IIFE, after the chip handler. It uses the IIFE's `root`, `showLens`, `turns`, `reduceMotion`, and the new `revealEdit(target)`.

- [ ] **Step 1: Write the failing test**

```js
test('the page script wires trace filters, failures-only and jumps to a Review edit', () => {
  const html = renderPage(Object.assign(sampleStory(), { trace: { events: [] } }));
  const script = html.slice(html.lastIndexOf('<script>'));
  assert.match(script, /getElementById\('lens-trace'\)/);
  assert.match(script, /setAttribute\('data-filter'/);
  assert.match(script, /classList\.toggle\('failures-only'\)/);
  assert.match(script, /dataset\.editId === editId/);
  assert.match(script, /function revealEdit\(target\)/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/template.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Extract `revealEdit` in the template's `SCRIPT`**

Replace the last four lines of the chip click handler (from `target.scrollIntoView(` to `target.classList.add('flash');`) with `revealEdit(target);`. Then define, just above the chip `forEach`, after `var reduceMotion = …`:

```js
  // Scroll an edit block into view and flash it (file chips and the Trace lens).
  function revealEdit(target) {
    target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    target.classList.remove('flash');
    void target.offsetWidth; // restart the animation when the same edit is revealed twice
    target.classList.add('flash');
  }
```

Edit blocks now carry their id on `.edit-header`, so the trace script matches `header.dataset.editId` and climbs to the `.edit`.

- [ ] **Step 4: Add `TRACE_SCRIPT` to `src/render/trace-lens.mjs`**

```js
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
```

- [ ] **Step 5: Interpolate it in `SCRIPT`**

Import `TRACE_SCRIPT` alongside the other trace-lens imports. In `SCRIPT`, add `${TRACE_SCRIPT}` on its own line after `wireList('.file-tree-item', '.file-panel', 'file', 'filePanel');`. `SCRIPT` is a template literal, so the interpolation works as-is, and `TRACE_SCRIPT` contains no `${`.

- [ ] **Step 6: Run the tests, then the whole suite**

Run: `node --test test/template.test.mjs && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/render/trace-lens.mjs src/render/template.mjs test/template.test.mjs
git commit -m "feat(trace-lens): client filters, failures-only, and jump to the Review diff"
```

---

### Task 5: Docs, and checking the real page in a browser

**Files:**
- Modify: `README.md`, `SKILL.md`, `docs/superpowers/specs/2026-10-08-transcript-record-audit.md`

- [ ] **Step 1: README**
  - Add a row to the "Choose the right view" table: `| **Trace** | Agent and tool developers | Execution timeline of prompts, tool calls and subagents with status and latency; filters; deterministic metrics, token usage and cost when recorded |`.
  - Change "apply across all three views" to "apply across the views".
  - Change "Four audiences, one file" to "Five views, one file" and add Trace to that sentence.
  - Add under the view table: "The Trace tab appears for stories extracted by this version; an older story.json renders without it."
  - Update the test count in "Development" to the number `npm test` prints.
- [ ] **Step 2: SKILL.md step 4.** Change "four switchable views" to "five switchable views" and append "Trace (execution timeline, metrics and usage, for agent developers)". Add to step 5: "If the story has token usage, report output tokens and, when recorded, cost."
- [ ] **Step 3: Render this session's story** from the scratch file the last `/story` run produced (it already has summaries, trace and metrics):

```bash
node bin/story.mjs render /private/tmp/claude-501/-Users-nalaj-Development-AI-metafyl/894d22cb-16e3-49e5-9df2-2f790f1efafa/scratchpad/story/story.json --open
```

Or run `/story` again for a fresh extract.
- [ ] **Step 4: Check in the browser over `file://`** with the network off. Use the Chrome extension if it is connected; otherwise check by hand and say so.
  - The tabs switch with all five present.
  - Every filter button narrows the list, and Failures only shows the failed and rejected calls.
  - Expanding an event shows its details.
  - "View diff in Review" lands on the right edit and flashes it, including for the plan file outside the project (the scope toggle switches on).
  - Dark and light themes both work, a phone-width window has no horizontal scroll, and the console has no errors.
- [ ] **Step 5: Record the check** in a "Phase 2 inspection" section of the audit note. Include the page size before and after, and anything that did not match.
- [ ] **Step 6: Commit**

```bash
npm test
git add README.md SKILL.md docs/superpowers/specs/2026-10-08-transcript-record-audit.md
git commit -m "docs: Trace view in README and SKILL, Phase 2 inspection notes"
```

---

## Verification

1. `npm test` passes, including the new `test/trace-lens.test.mjs` and the extended template, diff-render and CLI tests.
2. The rendered story for this session has five tabs. The Trace tab shows the scorecard: duration, 4 turns, tool calls, failures, files changed, validation 27/27, retries, and tokens with no cost tile, because the session is live.
3. A finished session with a cost record shows a cost tile matching the `cost-state` total.
4. An older story.json renders four tabs and no errors.
5. The browser check in Task 5 passes, from `file://` with no network.

## Self-review notes

- Spec coverage: §10 (Trace tab, scorecard with no empty tiles), §11 (time-ordered, expandable, with originating turn, command, result, affected file, diff link, errors, timing and provenance), §12 (client-side filters including failures only), §13 (metrics panel groups), §18 (standalone file) and §19 renderer tests. §14 findings are Phase 3 by agreement.
- Names are consistent across tasks: `data-groups`, `data-filter`, `.trace-jump[data-turn][data-jump-edit]`, `.edit-header[data-edit-id]`, `revealEdit`, `TRACE_FILTERS`, `TRACE_CSS`, `TRACE_SCRIPT`, `hasTrace`.
- Known trade-off: each event adds roughly half a kilobyte of markup. A session with 1,000 events adds about 0.5 MB, which is small next to the pre-rendered diffs.
