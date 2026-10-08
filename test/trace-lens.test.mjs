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
