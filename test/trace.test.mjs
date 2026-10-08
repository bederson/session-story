import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  msBetween, newEvent, finishEvent, resultStatus, eventSummary, turnDuration, sortEvents,
} from '../src/ir/trace.mjs';

test('msBetween returns the positive difference in ms, or null when either timestamp is missing or unparseable', () => {
  assert.equal(msBetween('2026-10-08T10:00:01.000Z', '2026-10-08T10:00:09.500Z'), 8500);
  assert.equal(msBetween('2026-10-08T10:00:09.000Z', '2026-10-08T10:00:01.000Z'), 0);
  assert.equal(msBetween(null, '2026-10-08T10:00:01.000Z'), null);
  assert.equal(msBetween('garbage', '2026-10-08T10:00:01.000Z'), null);
});

test('newEvent starts a tool event as unknown with no end, and a prompt event as ok', () => {
  const ev = newEvent({ id: 'toolu_1', kind: 'tool', turn: 1, tool: 'Read', summary: 'src/a.js', startedAt: '2026-10-08T10:00:01.000Z' });
  assert.deepEqual(ev, {
    id: 'toolu_1', kind: 'tool', turn: 1, parent_id: null, tool: 'Read', category: null,
    status: 'unknown', summary: 'src/a.js', started_at: '2026-10-08T10:00:01.000Z',
    ended_at: null, duration_ms: null, source: 'transcript',
  });
  assert.equal(newEvent({ id: 'u1', kind: 'prompt', turn: 1, summary: 'hi' }).status, 'ok');
  assert.equal(newEvent({ id: 'x', kind: 'tool', turn: 1, agentId: 'ag1' }).agent_id, 'ag1');
});

test('finishEvent sets ended_at, latency and status', () => {
  const ev = newEvent({ id: 't', kind: 'tool', turn: 1, tool: 'Bash', startedAt: '2026-10-08T10:00:01.000Z' });
  finishEvent(ev, '2026-10-08T10:00:09.500Z', 'error');
  assert.equal(ev.ended_at, '2026-10-08T10:00:09.500Z');
  assert.equal(ev.duration_ms, 8500);
  assert.equal(ev.status, 'error');
});

test('resultStatus ranks rejected over interrupted over error over ok', () => {
  assert.equal(resultStatus(true, 'User rejected tool use'), 'rejected');
  assert.equal(resultStatus(true, { stdout: '', stderr: '', interrupted: true }), 'interrupted');
  assert.equal(resultStatus(true, 'Error: Exit code 1'), 'error');
  assert.equal(resultStatus(false, { stdout: 'ok' }), 'ok');
});

test('eventSummary names the command, the relative file, the pattern, or the description', () => {
  assert.equal(eventSummary('Bash', { command: 'npm test\necho done' }, '/proj'), 'npm test');
  assert.equal(eventSummary('Read', { file_path: '/proj/src/a.js' }, '/proj'), 'src/a.js');
  assert.equal(eventSummary('Edit', { file_path: '/proj/src/a.js' }, '/proj'), 'src/a.js');
  assert.equal(eventSummary('Grep', { pattern: 'foo', path: '/proj/src' }, '/proj'), 'foo in src');
  assert.equal(eventSummary('Glob', { pattern: '**/*.mjs' }, '/proj'), '**/*.mjs');
  assert.equal(eventSummary('Agent', { description: 'Explore IR' }, '/proj'), 'Explore IR');
  assert.equal(eventSummary('WebFetch', { url: 'https://x.test' }, '/proj'), 'https://x.test');
  assert.equal(eventSummary('Skill', { skill: 'tdd' }, '/proj'), '');
  assert.equal(eventSummary('Bash', { command: 'x'.repeat(300) }, '/proj').length, 200);
});

test('turnDuration prefers the harness total, then wall clock to the last event, then unknown', () => {
  assert.deepEqual(turnDuration({ harnessMs: 3000, promptAt: 'a', lastEndedAt: 'b' }), { duration_ms: 3000, duration_source: 'transcript' });
  assert.deepEqual(
    turnDuration({ harnessMs: null, promptAt: '2026-10-08T10:00:00.000Z', lastEndedAt: '2026-10-08T10:00:18.000Z' }),
    { duration_ms: 18000, duration_source: 'derived' }
  );
  assert.deepEqual(turnDuration({ harnessMs: 0, promptAt: '2026-10-08T10:00:00.000Z', lastEndedAt: null }), { duration_ms: null, duration_source: 'unknown' });
});

test('sortEvents orders by started_at, keeps ties in insertion order, and keeps an undated event right after the dated one inserted before it', () => {
  const a = newEvent({ id: 'a', kind: 'tool', turn: 1, startedAt: '2026-10-08T10:00:05.000Z' });
  const b = newEvent({ id: 'b', kind: 'tool', turn: 1, startedAt: '2026-10-08T10:00:01.000Z' });
  const c = newEvent({ id: 'c', kind: 'tool', turn: 1, startedAt: null });
  const d = newEvent({ id: 'd', kind: 'tool', turn: 1, startedAt: '2026-10-08T10:00:01.000Z' });
  assert.deepEqual(sortEvents([a, b, c, d]).map((e) => e.id), ['b', 'c', 'd', 'a']);
});
