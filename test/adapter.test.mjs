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
    { type: 'user', uuid: 'n4', message: { role: 'user', content: '<command-message>session-story</command-message>\n<command-name>/session-story</command-name>' } },
    { type: 'user', uuid: 'real1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'Add a title prop to Panel' } },
  ];

  const story = buildStory(records, { sessionId: 's1' });

  assert.equal(story.turns.length, 1);
  assert.equal(story.turns[0].id, 'real1');
});

test('skips harness-injected synthetic records: task notifications, system reminders, meta and compact-summary entries', () => {
  const records = [
    { type: 'user', uuid: 'real1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'Add a title prop to Panel' } },
    { type: 'user', uuid: 'n1', message: { role: 'user', content: '<task-notification>\n<task-id>a3c62</task-id>\n<status>completed</status>\n<result>Findings from the repo.</result>\n</task-notification>' } },
    { type: 'user', uuid: 'n2', message: { role: 'user', content: '<system-reminder>\nYour todo list has changed.\n</system-reminder>' } },
    { type: 'user', uuid: 'n3', isMeta: true, message: { role: 'user', content: 'Caveat: local command output' } },
    { type: 'user', uuid: 'n4', isCompactSummary: true, message: { role: 'user', content: 'This session is being continued from a previous conversation.' } },
    { type: 'user', uuid: 'n5', message: { role: 'user', content: '<user-prompt-submit-hook>rtk hook ran</user-prompt-submit-hook>' } },
  ];

  const story = buildStory(records, { sessionId: 's1' });

  assert.equal(story.turns.length, 1);
  assert.equal(story.turns[0].id, 'real1');
  assert.equal(story.totals.turns, 1);
});

test('keeps a real prompt wrapped in system reminders and shows only the human text', () => {
  const records = [
    {
      type: 'user',
      uuid: 'u1',
      timestamp: '2026-09-10T10:00:00.000Z',
      message: {
        role: 'user',
        content: '<system-reminder>\nCodebase instructions below.\n</system-reminder>Add a title prop to Panel<system-reminder>git status snapshot</system-reminder>',
      },
    },
  ];

  const story = buildStory(records, { sessionId: 's1' });

  assert.equal(story.turns.length, 1);
  assert.equal(story.turns[0].prompt, 'Add a title prop to Panel');
});

test('attributes edits that follow a filtered task notification to the preceding real prompt', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'Add a title prop to Panel' } },
    { type: 'user', uuid: 'n1', message: { role: 'user', content: '<task-notification>\n<task-id>a3c62</task-id>\n<status>completed</status>\n</task-notification>' } },
    {
      type: 'assistant',
      uuid: 'a1',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'Edit', input: { file_path: '/proj/src/Panel.tsx', old_string: 'a', new_string: 'b' } }] },
    },
    {
      type: 'user',
      uuid: 'r1',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1' }] },
      toolUseResult: {
        filePath: '/proj/src/Panel.tsx',
        structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }],
      },
    },
  ];

  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });

  assert.equal(story.turns.length, 1);
  assert.equal(story.turns[0].id, 'u1');
  assert.equal(story.turns[0].edits.length, 1);
  assert.equal(story.turns[0].edits[0].rel, 'src/Panel.tsx');
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
    { type: 'user', uuid: 'r2', parentUuid: 'a2', timestamp: '2026-09-10T10:06:00.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: 'ok' }] },
      toolUseResult: { filePath: '/proj/src/Panel.tsx', structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-b', '+c'] }] } },
    // work continues after the last prompt, and the session ends with it
    { type: 'system', subtype: 'turn_duration', timestamp: '2026-09-10T10:07:30.000Z' },
  ];

  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });

  assert.equal(story.session.started_at, '2026-09-10T10:00:00.000Z');
  assert.equal(story.session.ended_at, '2026-09-10T10:07:30.000Z');
  assert.equal(story.session.duration_ms, 450000);
  assert.deepEqual(story.totals, { turns: 2, files: 1, added: 2, removed: 2, edits: 2 });
});

test('a single-turn session still has a duration: it ends at the last record, not the prompt', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'Look into the failing test' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: '2026-09-10T10:02:00.000Z', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'npm test' } },
    ] } },
    { type: 'user', uuid: 'r1', parentUuid: 'a1', timestamp: '2026-09-10T10:20:00.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] },
      toolUseResult: { stdout: 'ok', stderr: '' } },
  ];

  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });

  assert.equal(story.session.ended_at, '2026-09-10T10:20:00.000Z');
  assert.equal(story.session.duration_ms, 1200000);
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

test('captures the pre-edit text, replacement strings, and whether each file sits outside the project', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'Fix it' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'toolu_1', name: 'Edit', input: { file_path: '/proj/src/a.ts' } },
      { type: 'tool_use', id: 'toolu_2', name: 'Edit', input: { file_path: '/tmp/scratch/story.json' } },
    ] } },
    { type: 'user', uuid: 'r1', parentUuid: 'a1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1' }] },
      toolUseResult: { oldString: 'a', newString: 'b', originalFile: 'a\n', replaceAll: false,
        structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }] } },
    { type: 'user', uuid: 'r2', parentUuid: 'a1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_2' }] },
      toolUseResult: { oldString: 'x', newString: 'y', originalFile: null, replaceAll: true, structuredPatch: [] } },
  ];

  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });
  const [inside, outside] = story.turns[0].edits;

  assert.equal(inside.before, 'a\n');
  assert.equal(inside.old_string, 'a');
  assert.equal(inside.new_string, 'b');
  assert.equal(inside.replace_all, false);
  assert.equal(inside.outside_cwd, false);
  assert.equal(outside.outside_cwd, true);
  assert.equal(outside.before, null);
  assert.equal(outside.replace_all, true);
});

test('a Write that creates a file records an empty pre-edit text and keeps its full content', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'Make it' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'toolu_1', name: 'Write', input: { file_path: '/proj/new.ts' } },
    ] } },
    { type: 'user', uuid: 'r1', parentUuid: 'a1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1' }] },
      toolUseResult: { type: 'create', filePath: '/proj/new.ts', content: 'x\ny\n' } },
  ];

  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });

  assert.equal(story.turns[0].edits[0].before, '');
  assert.equal(story.turns[0].edits[0].after, 'x\ny\n');
});

function userRecord({ uuid, ts, toolUseId, content, isError = false }) {
  return {
    type: 'user',
    uuid,
    timestamp: ts,
    toolUseResult: content,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: isError, content: typeof content === 'string' ? content : JSON.stringify(content) }],
    },
  };
}

function assistantBash({ uuid, ts, id, command, description }) {
  return {
    type: 'assistant',
    uuid,
    timestamp: ts,
    gitBranch: 'main',
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command, description } }] },
  };
}

test('captures a successful Bash command as an ok bash entry with category, exit code and output tail', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'run the tests' } },
    assistantBash({ uuid: 'a1', ts: '2026-09-10T10:00:01.000Z', id: 'tu1', command: 'npm test', description: 'run tests' }),
    userRecord({ uuid: 'r1', ts: '2026-09-10T10:00:02.000Z', toolUseId: 'tu1', content: { stdout: '# pass 5\n', stderr: '', interrupted: false } }),
  ];

  const story = buildStory(records, { sessionId: 's1' });

  const [bash] = story.turns[0].bash;
  assert.equal(bash.command, 'npm test');
  assert.equal(bash.description, 'run tests');
  assert.equal(bash.category, 'test');
  assert.equal(bash.ok, true);
  assert.equal(bash.rejected, false);
  assert.match(bash.output_tail, /pass 5/);
});

test('captures a failing Bash command with exit code and marks it not ok', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'run the tests' } },
    assistantBash({ uuid: 'a1', ts: '2026-09-10T10:00:01.000Z', id: 'tu1', command: 'npm test', description: 'run tests' }),
    userRecord({ uuid: 'r1', ts: '2026-09-10T10:00:02.000Z', toolUseId: 'tu1', content: 'Error: Exit code 1\n5 failing', isError: true }),
  ];

  const story = buildStory(records, { sessionId: 's1' });

  const [bash] = story.turns[0].bash;
  assert.equal(bash.ok, false);
  assert.equal(bash.exit_code, 1);
  assert.match(bash.output_tail, /5 failing/);
  assert.equal(story.turns[0].errors.length, 1);
  assert.equal(story.turns[0].errors[0].tool, 'Bash');
  assert.equal(story.turns[0].errors[0].target, 'npm test');
  assert.equal(story.turns[0].errors[0].kind, 'error');
});

test('captures a rejected Bash command distinctly from an error', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'delete everything' } },
    assistantBash({ uuid: 'a1', ts: '2026-09-10T10:00:01.000Z', id: 'tu1', command: 'rm -rf /', description: 'cleanup' }),
    userRecord({ uuid: 'r1', ts: '2026-09-10T10:00:02.000Z', toolUseId: 'tu1', content: 'User rejected tool use', isError: true }),
  ];

  const story = buildStory(records, { sessionId: 's1' });

  const [bash] = story.turns[0].bash;
  assert.equal(bash.rejected, true);
  assert.equal(bash.ok, false);
  assert.equal(story.turns[0].errors[0].kind, 'rejected');
});

test('marks an errored Edit as result "error" with a message, instead of a false "ok"', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'fix the typo' } },
    {
      type: 'assistant',
      uuid: 'a1',
      timestamp: '2026-09-10T10:00:01.000Z',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'Edit', input: { file_path: '/proj/missing.txt', old_string: 'a', new_string: 'b' } }] },
    },
    userRecord({ uuid: 'r1', ts: '2026-09-10T10:00:02.000Z', toolUseId: 'tu1', content: 'Error: File does not exist.', isError: true }),
  ];

  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });

  const [edit] = story.turns[0].edits;
  assert.equal(edit.result, 'error');
  assert.match(edit.error, /File does not exist/);
  assert.deepEqual(edit.hunks, []);
  assert.equal(story.turns[0].errors.length, 1);
  assert.equal(story.turns[0].errors[0].tool, 'Edit');
  assert.equal(story.turns[0].errors[0].target, 'missing.txt');
});

test('captures an approved plan from ExitPlanMode on the turn', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'plan the feature' } },
    {
      type: 'assistant',
      uuid: 'a1',
      timestamp: '2026-09-10T10:00:01.000Z',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'ExitPlanMode', input: { plan: '# Plan\nDo the thing', planFilePath: '/plans/x.md' } }] },
    },
    userRecord({ uuid: 'r1', ts: '2026-09-10T10:00:02.000Z', toolUseId: 'tu1', content: { plan: '# Plan\nDo the thing', isAgent: false, filePath: '/plans/x.md' } }),
  ];

  const story = buildStory(records, { sessionId: 's1' });

  assert.deepEqual(story.turns[0].plan, { text: '# Plan\nDo the thing', approved: true, file: '/plans/x.md' });
});

test('captures a rejected plan from ExitPlanMode as not approved', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'plan the feature' } },
    {
      type: 'assistant',
      uuid: 'a1',
      timestamp: '2026-09-10T10:00:01.000Z',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'ExitPlanMode', input: { plan: '# Plan', planFilePath: '/plans/x.md' } }] },
    },
    userRecord({ uuid: 'r1', ts: '2026-09-10T10:00:02.000Z', toolUseId: 'tu1', content: 'User rejected tool use', isError: true }),
  ];

  const story = buildStory(records, { sessionId: 's1' });

  assert.equal(story.turns[0].plan.approved, false);
});

test('reads session.git_branch from the transcript records', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', gitBranch: 'feature/x', message: { role: 'user', content: 'do a thing' } },
  ];

  const story = buildStory(records, { sessionId: 's1' });

  assert.equal(story.session.git_branch, 'feature/x');
});

test('initializes an empty report skeleton on every story', () => {
  const story = buildStory([], { sessionId: 's1' });

  assert.deepEqual(story.report, {
    plan: '',
    decisions: [],
    outcome: null,
    outcome_note: null,
    dependencies: { manifests: [], installs: [], config_files: [] },
    git: null,
  });
});

test('subagent Bash errors and edit errors bubble up to the spawning turn', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'delegate the search' } },
    {
      type: 'assistant',
      uuid: 'a1',
      timestamp: '2026-09-10T10:00:01.000Z',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 'agent1', name: 'Agent', input: { prompt: 'find it' } }] },
    },
    userRecord({ uuid: 'r1', ts: '2026-09-10T10:00:05.000Z', toolUseId: 'agent1', content: { agentId: 'sub-1', status: 'completed' } }),
  ];
  const subagents = {
    'sub-1': [
      assistantBash({ uuid: 'sa1', ts: '2026-09-10T10:00:02.000Z', id: 'stu1', command: 'grep -r foo .', description: 'search' }),
      userRecord({ uuid: 'sr1', ts: '2026-09-10T10:00:03.000Z', toolUseId: 'stu1', content: 'Error: Exit code 1\nno matches', isError: true }),
    ],
  };

  const story = buildStory(records, { sessionId: 's1', subagents });

  assert.equal(story.turns[0].errors.length, 1);
  assert.equal(story.turns[0].errors[0].tool, 'Bash');
  assert.equal(story.turns[0].bash[0].by_subagent, 'sub-1');
  assert.equal(story.turns[0].bash[0].ok, false);
});

test('carries the harness-generated session title as session.ai_title, keeping the last one written', () => {
  const records = [
    { type: 'ai-title', aiTitle: 'First guess at the session', sessionId: 's1' },
    { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'Add a title prop to Panel' } },
    { type: 'ai-title', aiTitle: 'Panel title prop', sessionId: 's1' },
  ];

  const story = buildStory(records, { sessionId: 's1' });

  assert.equal(story.session.ai_title, 'Panel title prop');
  // Claude still writes session.title itself; the harness title is only a fallback.
  assert.equal(story.session.title, null);
});

test('leaves session.ai_title null when the transcript has no ai-title record', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-10T10:00:00.000Z', message: { role: 'user', content: 'Add a title prop to Panel' } },
  ];

  const story = buildStory(records, { sessionId: 's1' });

  assert.equal(story.session.ai_title, null);
});
