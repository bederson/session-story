import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasTrace, formatElapsed, formatLatency, formatTokens, formatCost, renderScorecard, renderMetrics,
  eventGroups, renderTraceLens, renderWhereItWent,
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

test('code counts render both scopes so the "Project files only" toggle picks one, like the header', () => {
  const code = {
    files_changed: 30, lines_added: 900, lines_removed: 40, edits: 60,
    in_project: { files_changed: 28, lines_added: 850, lines_removed: 38, edits: 55 },
    files_edited_repeatedly: [{ rel: '~/.claude/x.md', edits: 2, outside_cwd: true }, { rel: 'src/a.js', edits: 3 }],
  };
  const card = renderScorecard(metrics({ code }));
  assert.match(card, /<span class="v-in">28<\/span><span class="v-all">30<\/span>/);
  const panel = renderMetrics({ metrics: metrics({ code }) });
  for (const [inV, allV] of [[28, 30], [850, 900], [38, 40], [55, 60]]) {
    assert.ok(panel.includes(`<span class="v-in">${inV}</span><span class="v-all">${allV}</span>`), `missing ${inV}/${allV}`);
  }
  assert.match(panel, /<li data-outside="1"><code>~\/\.claude\/x\.md<\/code>/);
  assert.match(panel, /<li><code>src\/a\.js<\/code>/);
});

test('code counts from metrics without in_project show the single total', () => {
  const card = renderScorecard(metrics());
  assert.doesNotMatch(card, /v-in/);
  assert.match(card, /1<\/span> <span class="stat-label">file changed/);
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

function whereStory() {
  const pt = (index, output, duration_ms, duration_source, subagents = null) => ({
    index, duration_ms, duration_source,
    input_tokens: output === null ? null : 1, output_tokens: output, cache_read_tokens: output === null ? null : 0, cache_creation_tokens: output === null ? null : 0,
    api_calls: 1, complete: true, subagents, share: { output: null, input: null, duration: null },
  });
  return {
    session: { id: 's1' },
    turns: [
      { index: 1, prompt: 'Plan it', summary: 'Planned the <work>.', edits: [] },
      { index: 2, prompt: 'Build it', summary: 'Built it.', edits: [] },
      { index: 3, prompt: 'Check it\nsecond line', summary: '', edits: [] },
    ],
    metrics: metrics({ turns: [
      pt(1, 5000, 60000, 'transcript'),
      pt(2, 40000, 300000, 'derived', { count: 1, with_usage: 1, input_tokens: 1, output_tokens: 45100, cache_read_tokens: 0, cache_creation_tokens: 0 }),
      pt(3, null, 120000, 'transcript'),
    ] }),
  };
}

test('Where it went ranks turns by output tokens (main plus subagents) and by duration, each with a jump', () => {
  const html = renderWhereItWent(whereStory());
  assert.match(html, /^<div class="trace-where">/);
  const [byTokens, byTime] = html.split('<h3>By duration</h3>');
  assert.match(byTokens, /<h3>By output tokens<\/h3>/);
  const order = (part) => [...part.matchAll(/class="where-row" data-turn="(\d+)"/g)].map((m) => m[1]);
  assert.deepEqual(order(byTokens), ['2', '1']);
  assert.deepEqual(order(byTime), ['2', '3', '1']);
  assert.match(byTokens, /title="40\.0k main \+ 45\.1k in 1 agent">85\.1k</);
  assert.match(byTime, /title="estimated from timestamps">5m 0s</);
  assert.match(byTime, /title="reported by Claude Code">2m 0s</);
  assert.match(html, /Planned the &lt;work&gt;\./);
  assert.match(byTime, /Check it</);
  assert.doesNotMatch(byTime, /second line/);
  assert.equal((html.match(/class="trace-jump" data-turn="2"/g) || []).length, 2);
  assert.match(byTokens, /<span class="where-bar"><span style="width:100%"><\/span><\/span>/);
});

test('Where it went is left out for one turn, without metrics.turns, and in the full trace lens when absent', () => {
  const one = whereStory();
  one.metrics.turns = one.metrics.turns.slice(0, 1);
  assert.equal(renderWhereItWent(one), '');
  assert.equal(renderWhereItWent({ metrics: metrics() }), '');
  assert.doesNotMatch(renderTraceLens(traceStory()), /trace-where/);
  const story = { ...whereStory(), trace: { events: [] } };
  const lens = renderTraceLens(story);
  assert.ok(lens.indexOf('trace-where') < lens.indexOf('trace-filters'));
});

test('a trace event carries its detail rows inert until the row is opened', () => {
  const html = renderTraceLens(traceStory());
  assert.match(html, /<\/summary><template data-inert><dl class="trace-detail">/);
  assert.doesNotMatch(html, /<\/summary><dl class="trace-detail">/);
});
