import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStory } from '../src/transcript/claude-code.mjs';

test('extracts one turn per real user prompt, in order, with empty edits when no tool calls follow', () => {
  const records = [
    { type: 'user', uuid: 'u1', parentUuid: null, timestamp: '2026-09-10T10:00:00.000Z', sessionId: 's1', cwd: '/proj', gitBranch: 'main', version: '2.1.266', message: { role: 'user', content: 'Add a title prop to Panel' } },
  ];

  const story = buildStory(records, { sessionId: 's1' });

  assert.equal(story.turns.length, 1);
  assert.equal(story.turns[0].index, 1);
  assert.equal(story.turns[0].prompt, 'Add a title prop to Panel');
  assert.deepEqual(story.turns[0].edits, []);
});

test('skips slash-command noise records so they are not counted as turns', () => {
  const records = [
    { type: 'user', uuid: 'n1', message: { role: 'user', content: '<local-command-caveat>Caveat: ...</local-command-caveat>' } },
    { type: 'user', uuid: 'n2', message: { role: 'user', content: '<command-name>/model</command-name>' } },
    { type: 'user', uuid: 'n3', message: { role: 'user', content: '<local-command-stdout>Set model to Fable</local-command-stdout>' } },
    { type: 'user', uuid: 'real1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'Add a title prop to Panel' } },
  ];

  const story = buildStory(records, { sessionId: 's1' });

  assert.equal(story.turns.length, 1);
  assert.equal(story.turns[0].id, 'real1');
});

test('attaches an Edit tool call and its result to the turn that issued it, with hunks and stats', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'Add a title prop to Panel' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'toolu_1', name: 'Edit', input: { file_path: '/proj/src/Panel.tsx', old_string: 'a', new_string: 'b', replace_all: false } },
    ] } },
    { type: 'user', uuid: 'r1', parentUuid: 'a1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] },
      toolUseResult: {
        filePath: '/proj/src/Panel.tsx',
        oldString: 'a', newString: 'b', originalFile: 'a\n',
        replaceAll: false, userModified: false,
        structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }],
      } },
  ];

  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });

  assert.equal(story.turns.length, 1);
  const edits = story.turns[0].edits;
  assert.equal(edits.length, 1);
  assert.equal(edits[0].tool, 'Edit');
  assert.equal(edits[0].file, '/proj/src/Panel.tsx');
  assert.equal(edits[0].rel, 'src/Panel.tsx');
  assert.equal(edits[0].result, 'ok');
  assert.equal(edits[0].hunks.length, 1);
  assert.deepEqual(edits[0].hunks[0].lines, ['-a', '+b']);
  assert.deepEqual(edits[0].stats, { added: 1, removed: 1 });
});

test('synthesizes an all-added hunk for a Write that creates a new file', () => {
  const records = [
    { type: 'user', uuid: 'u1', message: { role: 'user', content: 'Create a README' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'toolu_2', name: 'Write', input: { file_path: '/proj/README.md', content: '# Proj\nHello\n' } },
    ] } },
    { type: 'user', uuid: 'r1', parentUuid: 'a1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: 'ok' }] },
      toolUseResult: { type: 'create', filePath: '/proj/README.md', content: '# Proj\nHello\n', originalFile: '', structuredPatch: [], userModified: false } },
  ];

  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });

  const edit = story.turns[0].edits[0];
  assert.equal(edit.tool, 'Write');
  assert.equal(edit.kind, 'create');
  assert.equal(edit.hunks.length, 1);
  assert.deepEqual(edit.hunks[0].lines, ['+# Proj', '+Hello']);
  assert.deepEqual(edit.stats, { added: 2, removed: 0 });
});

test("attributes a subagent's edits to the turn that spawned the Agent call", () => {
  const records = [
    { type: 'user', uuid: 'u1', message: { role: 'user', content: 'Find and fix the bug' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'toolu_agent', name: 'Agent', input: { description: 'Fix the bug' } },
    ] } },
    { type: 'user', uuid: 'r1', parentUuid: 'a1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_agent', content: 'done' }] },
      toolUseResult: { agentId: 'ag-1', status: 'completed' } },
  ];

  const subagentRecords = [
    { type: 'user', isSidechain: true, agentId: 'ag-1', parentUuid: null },
    { type: 'assistant', isSidechain: true, agentId: 'ag-1', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'toolu_sub1', name: 'Edit', input: { file_path: '/proj/src/bug.ts', old_string: 'a', new_string: 'b' } },
    ] } },
    { type: 'user', isSidechain: true, agentId: 'ag-1', toolUseResult: {
      filePath: '/proj/src/bug.ts', structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }],
    }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_sub1', content: 'ok' }] } },
  ];

  const story = buildStory(records, { sessionId: 's1', cwd: '/proj', subagents: { 'ag-1': subagentRecords } });

  assert.equal(story.turns.length, 1);
  const edits = story.turns[0].edits;
  assert.equal(edits.length, 1);
  assert.equal(edits[0].file, '/proj/src/bug.ts');
  assert.equal(edits[0].by_subagent, 'ag-1');
});

test('marks an edit as result "unknown" when no matching tool_result record follows (interrupted session)', () => {
  const records = [
    { type: 'user', uuid: 'u1', message: { role: 'user', content: 'Refactor the parser' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'toolu_x', name: 'Edit', input: { file_path: '/proj/src/parser.ts', old_string: 'a', new_string: 'b' } },
    ] } },
    // session ends here, no tool_result record
  ];

  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });

  const edit = story.turns[0].edits[0];
  assert.equal(edit.result, 'unknown');
  assert.deepEqual(edit.hunks, []);
});

test('computes session started_at/ended_at/duration and totals across turns', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'Add a title prop to Panel' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'toolu_1', name: 'Edit', input: { file_path: '/proj/src/Panel.tsx', old_string: 'a', new_string: 'b' } },
    ] } },
    { type: 'user', uuid: 'r1', parentUuid: 'a1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] },
      toolUseResult: { filePath: '/proj/src/Panel.tsx', structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }] } },
    { type: 'user', uuid: 'u2', timestamp: '2026-09-10T10:05:30.000Z', message: { role: 'user', content: 'Now add a subtitle too' } },
    { type: 'assistant', uuid: 'a2', parentUuid: 'u2', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'toolu_2', name: 'Edit', input: { file_path: '/proj/src/Panel.tsx', old_string: 'b', new_string: 'c' } },
    ] } },
    { type: 'user', uuid: 'r2', parentUuid: 'a2', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: 'ok' }] },
      toolUseResult: { filePath: '/proj/src/Panel.tsx', structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-b', '+c'] }] } },
  ];

  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });

  assert.equal(story.session.started_at, '2026-09-10T10:00:00.000Z');
  assert.equal(story.session.ended_at, '2026-09-10T10:05:30.000Z');
  assert.equal(story.session.duration_ms, 330000);
  assert.deepEqual(story.totals, { turns: 2, files: 1, added: 2, removed: 2, edits: 2 });
});

test("includes a files[] cross-index built from the turns' edits", () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'Add a title prop to Panel' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'toolu_1', name: 'Edit', input: { file_path: '/proj/src/Panel.tsx', old_string: 'a', new_string: 'b' } },
    ] } },
    { type: 'user', uuid: 'r1', parentUuid: 'a1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] },
      toolUseResult: { filePath: '/proj/src/Panel.tsx', structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }] } },
  ];

  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });

  assert.equal(story.files.length, 1);
  assert.equal(story.files[0].rel, 'src/Panel.tsx');
  assert.equal(story.files[0].language, 'typescript');
  assert.equal(story.files[0].churn, false);
});
