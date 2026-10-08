import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMetrics, normalizeCommand, countRetries, validationState } from '../src/ir/metrics.mjs';

function run(command, status, category = 'test') {
  return { command, status, category };
}

function story({ turns = [], events = [], costStates = [], totals, session } = {}) {
  return {
    schema_version: 1,
    session: session || { id: 's1', chain: ['s1'], started_at: '2026-10-08T10:00:00.000Z', ended_at: '2026-10-08T10:00:18.500Z' },
    turns,
    files: [],
    totals: totals || { turns: turns.length, files: 1, added: 1, removed: 1, edits: 1 },
    trace: { events, cost_states: costStates },
  };
}

test('normalizeCommand collapses whitespace and drops a trailing semicolon', () => {
  assert.equal(normalizeCommand('  npm   test ;'), 'npm test');
  assert.equal(normalizeCommand('npm test -- --watch'), 'npm test -- --watch');
  assert.equal(normalizeCommand(null), '');
});

test('countRetries counts a rerun of a failed command once and not a rerun after success', () => {
  assert.equal(countRetries([run('npm test', 'error'), run('npm  test', 'ok'), run('npm test', 'ok')]), 1);
  assert.equal(countRetries([run('npm test', 'error'), run('npm test', 'error'), run('npm test', 'ok')]), 2);
  assert.equal(countRetries([run('npm test', 'error'), run('npm test -- --watch', 'ok')]), 0);
  assert.equal(countRetries([run('npm test', 'interrupted'), run('npm test', 'ok')]), 0);
});

test('validationState reports the last test/lint/build command as passed, failed, unknown, or none', () => {
  assert.deepEqual(validationState([run('npm test', 'error'), run('ls', 'ok', 'other'), run('npm test', 'ok')]),
    { commands: 2, passed: 1, failed: 1, final_state: 'passed', last_command: 'npm test' });
  assert.equal(validationState([run('npm test', 'interrupted')]).final_state, 'unknown');
  assert.equal(validationState([run('npm run lint', 'error', 'lint')]).final_state, 'failed');
  assert.deepEqual(validationState([run('ls', 'ok', 'other')]), { commands: 0, passed: 0, failed: 0, final_state: 'none', last_command: null });
});

test('computeMetrics derives execution, code, validation and reads from turns and trace', () => {
  const turns = [{
    index: 1, id: 'u1', at: '2026-10-08T10:00:00.000Z', prompt: 'go', summary: '',
    edits: [
      { id: 'tu3', rel: 'src/a.js', stats: { added: 1, removed: 1 } },
      { id: 'tu5', rel: 'src/a.js', stats: { added: 1, removed: 0 } },
      { id: 'tu6', rel: 'src/b.js', stats: { added: 0, removed: 0 }, combined_into: 1 },
    ],
    bash: [
      { id: 'tu2', command: 'npm test', category: 'test', ok: false },
      { id: 'tu4', command: 'npm test', category: 'test', ok: true },
    ],
    errors: [], plan: null, usage: null,
  }];
  const events = [
    { id: 'u1', kind: 'prompt', turn: 1, status: 'ok', tool: null, summary: 'go' },
    { id: 'tu1', kind: 'tool', turn: 1, status: 'ok', tool: 'Read', summary: 'src/a.js' },
    { id: 'tu2', kind: 'tool', turn: 1, status: 'error', tool: 'Bash', category: 'test', summary: 'npm test' },
    { id: 'tu3', kind: 'tool', turn: 1, status: 'ok', tool: 'Edit', summary: 'src/a.js' },
    { id: 'tu4', kind: 'tool', turn: 1, status: 'ok', tool: 'Bash', category: 'test', summary: 'npm test' },
    { id: 'tu5', kind: 'tool', turn: 1, status: 'rejected', tool: 'Edit', summary: 'src/a.js' },
    { id: 'tu7', kind: 'tool', turn: 1, status: 'ok', tool: 'Read', summary: 'src/a.js' },
    { id: 'tu8', kind: 'tool', turn: 1, status: 'ok', tool: 'Grep', summary: 'foo in src' },
  ];
  const m = computeMetrics(story({ turns, events, totals: { turns: 1, files: 2, added: 2, removed: 1, edits: 2 } }));
  assert.deepEqual(m.execution, { duration_ms: 18500, turns: 1, tool_calls: 7, failed_tool_calls: 1, rejected_tool_calls: 1, commands: 2, failed_commands: 1, retries: 1 });
  assert.deepEqual(m.code, { files_changed: 2, lines_added: 2, lines_removed: 1, edits: 2, files_edited_repeatedly: [{ rel: 'src/a.js', edits: 2 }] });
  assert.deepEqual(m.validation, { commands: 2, passed: 1, failed: 1, final_state: 'passed', last_command: 'npm test' });
  assert.deepEqual(m.reads, { files_read: 1, tool_calls: 3 });
});

test('computeMetrics orders runs by the trace, not by turn, so a retry across turns counts', () => {
  const turns = [
    { index: 1, id: 'u1', prompt: 'a', edits: [], bash: [{ id: 'b1', command: 'npm test', category: 'test', ok: false }] },
    { index: 2, id: 'u2', prompt: 'b', edits: [], bash: [{ id: 'b2', command: 'npm test', category: 'test', ok: true }] },
  ];
  const events = [
    { id: 'u1', kind: 'prompt', turn: 1, status: 'ok' }, { id: 'b1', kind: 'tool', turn: 1, status: 'error', tool: 'Bash', category: 'test' },
    { id: 'u2', kind: 'prompt', turn: 2, status: 'ok' }, { id: 'b2', kind: 'tool', turn: 2, status: 'ok', tool: 'Bash', category: 'test' },
  ];
  assert.equal(computeMetrics(story({ turns, events })).execution.retries, 1);
});

test('usage prefers cost-state totals and reports the cost', () => {
  const costStates = [{
    total_cost_usd: 0.05, total_api_duration_ms: 9000, total_tool_duration_ms: 11000, has_unknown_model_cost: false,
    model_usage: { 'claude-opus-5-5': { inputTokens: 30, outputTokens: 65, cacheReadInputTokens: 1100, cacheCreationInputTokens: 100, costUSD: 0.05 } },
  }];
  const m = computeMetrics(story({ costStates }));
  assert.deepEqual(m.usage, { input_tokens: 30, output_tokens: 65, cache_read_tokens: 1100, cache_creation_tokens: 100, total_cost_usd: 0.05, models: ['claude-opus-5-5'], source: 'cost-state', complete: true });
});

test('usage sums turn and subagent usage with a null cost when there is no cost-state', () => {
  const turns = [
    { index: 1, id: 'u1', prompt: 'a', edits: [], bash: [], usage: { input_tokens: 1, output_tokens: 2, cache_read_tokens: 3, cache_creation_tokens: 4, api_calls: 1, models: ['claude-opus-5-5'], complete: true } },
    { index: 2, id: 'u2', prompt: 'b', edits: [], bash: [], usage: null },
  ];
  const events = [{ id: 'ag', kind: 'subagent', turn: 1, status: 'ok', tool: 'Agent', usage: { input_tokens: 10, output_tokens: 20, cache_read_tokens: 0, cache_creation_tokens: 0, api_calls: 2, models: ['claude-haiku-4-5-20251001'], complete: false } }];
  const m = computeMetrics(story({ turns, events }));
  assert.deepEqual(m.usage, { input_tokens: 11, output_tokens: 22, cache_read_tokens: 3, cache_creation_tokens: 4, total_cost_usd: null, models: ['claude-haiku-4-5-20251001', 'claude-opus-5-5'], source: 'transcript', complete: false });
});

test('usage is all null with source none when nothing carried usage', () => {
  const m = computeMetrics(story({ turns: [{ index: 1, id: 'u1', prompt: 'a', edits: [], bash: [], usage: null }] }));
  assert.deepEqual(m.usage, { input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_creation_tokens: null, total_cost_usd: null, models: [], source: 'none', complete: false });
});

test('an old story with no trace gets nulls for trace-derived counts, numbers for code, and no 0 for an unknown duration', () => {
  const old = { schema_version: 1, session: { id: 's1', started_at: null, ended_at: null }, turns: [{ index: 1, id: 'u1', prompt: 'a', edits: [], bash: [{ id: 'b1', command: 'npm test', category: 'test', ok: true }] }], files: [], totals: { turns: 1, files: 0, added: 0, removed: 0, edits: 0 } };
  const m = computeMetrics(old);
  assert.equal(m.execution.duration_ms, null);
  assert.equal(m.execution.tool_calls, null);
  assert.equal(m.execution.commands, 1);
  assert.equal(m.validation.final_state, 'passed');
  assert.deepEqual(m.reads, { files_read: null, tool_calls: null });
  assert.equal(m.code.files_changed, 0);
});
