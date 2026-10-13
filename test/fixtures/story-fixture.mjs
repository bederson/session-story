/**
 * Shared Story IR fixtures for renderer tests: a rich small session that
 * exercises every view, and a generator for long sessions. Not a test file.
 */

const hunk = (lines, oldStart = 1) => ({
  oldStart, oldLines: lines.filter((l) => l[0] !== '+').length,
  newStart: oldStart, newLines: lines.filter((l) => l[0] !== '-').length, lines,
});

export function richStory() {
  const aHunks = [hunk(['-const a = 1;', '+const a = 2;', ' export default a;'])];
  const bHunks = [hunk(['+hello'])];
  const longCommand = `node -e "${'x'.repeat(600)}"`;
  return {
    schema_version: 1,
    session: {
      id: 'sess-0001-aaaa', cwd: '/proj', git_branch: 'main', title: 'Rich fixture session',
      started_at: '2026-09-10T10:00:00.000Z', ended_at: '2026-09-10T10:20:00.000Z', duration_ms: 1200000,
      summary: 'Changed a, added notes, hit a failing test.', blind_spots: ['One change was made by a shell command.'],
    },
    turns: [
      {
        index: 1, id: 'u1', at: '2026-09-10T10:00:00.000Z',
        prompt: 'Change a to 2\nand keep the export\n\nthanks',
        summary: 'Changed a.',
        replies: [{ at: '2026-09-10T10:00:05.000Z', text: 'Working on it.' }, { at: '2026-09-10T10:00:30.000Z', text: 'Done: a is 2.' }],
        edits: [
          { id: 'e1', tool: 'Edit', file: '/proj/src/a.mjs', rel: 'src/a.mjs', kind: 'update', result: 'ok', hunks: aHunks, stats: { added: 1, removed: 1 }, before: 'const a = 1;\nexport default a;\n' },
          { id: 'e2', tool: 'Write', file: '/tmp/scratch.txt', rel: '/tmp/scratch.txt', kind: 'create', result: 'ok', outside_cwd: true, hunks: bHunks, stats: { added: 1, removed: 0 }, before: '' },
        ],
        bash: [{ id: 'b1', command: 'npm test', description: '', category: 'test', ok: false, exit_code: 1, rejected: false, interrupted: false, output_tail: '1 failing' }],
        errors: [{ id: 'b1', kind: 'error', tool: 'Bash', target: 'npm test', message: 'exit 1', resolution: 'Fixed in turn 2.' }],
        plan: null,
      },
      {
        index: 2, id: 'u2', at: '2026-09-10T10:10:00.000Z', prompt: 'Run the tests again', summary: 'Tests pass.',
        replies: [],
        edits: [
          { id: 'e3', tool: 'Edit', file: '/proj/src/b.mjs', rel: 'src/b.mjs', kind: 'update', result: 'error', error: 'old string not found', stats: { added: 0, removed: 0 } },
        ],
        bash: [
          { id: 'b2', command: 'npm test', description: '', category: 'test', ok: true, exit_code: 0, rejected: false, interrupted: false, output_tail: '' },
          { id: 'b3', command: longCommand, description: '', category: 'other', ok: true, exit_code: 0, rejected: false, interrupted: false, output_tail: '' },
        ],
        errors: [], plan: { text: 'Re-run then finish', approved: true },
      },
      { index: 3, id: 'u3', at: null, prompt: 'Just talk, no edits', summary: null, replies: [], edits: [], bash: [], errors: [], plan: null },
    ],
    files: [
      { rel: 'src/a.mjs', language: 'javascript', turns: [1], churn: false, stats: { added: 1, removed: 1 } },
      { rel: 'src/b.mjs', language: 'javascript', turns: [2], churn: false, stats: { added: 0, removed: 0 } },
      { rel: '/tmp/scratch.txt', language: 'text', turns: [1], churn: false, outside_cwd: true, stats: { added: 1, removed: 0 } },
    ],
    totals: { turns: 3, files: 3, added: 2, removed: 1, edits: 3 },
    report: {
      plan: 'Change a, then verify.', decisions: ['Kept the default export.'], outcome: 'partial', outcome_note: 'One edit failed.',
      dependencies: { manifests: [], installs: [], config_files: [] }, git: null,
    },
    metrics: {
      execution: { duration_ms: 1200000, turns: 3, tool_calls: 4, failed_tool_calls: 1, rejected_tool_calls: 0, commands: 3, failed_commands: 1, retries: 0 },
      code: { files_changed: 3, lines_added: 2, lines_removed: 1, edits: 3, in_project: { files_changed: 2, lines_added: 1, lines_removed: 1, edits: 2 }, files_edited_repeatedly: [] },
      validation: { commands: 2, passed: 1, failed: 1, final_state: 'passed', last_command: 'npm test' },
      reads: { files_read: 0, tool_calls: 0 },
      usage: { source: 'none' },
    },
    trace: {
      events: [
        { id: 'u1', kind: 'prompt', turn: 1, status: 'ok', summary: 'Change a', started_at: '2026-09-10T10:00:00.000Z', ended_at: null, duration_ms: null },
        { id: 'e1', kind: 'tool', tool: 'Edit', turn: 1, status: 'ok', summary: 'src/a.mjs', started_at: '2026-09-10T10:00:10.000Z', ended_at: '2026-09-10T10:00:11.000Z', duration_ms: 1000 },
        { id: 'b1', kind: 'tool', tool: 'Bash', category: 'test', turn: 1, status: 'error', summary: 'npm test', started_at: '2026-09-10T10:00:20.000Z', ended_at: '2026-09-10T10:00:25.000Z', duration_ms: 5000 },
      ],
      cost_states: [],
    },
  };
}

/** A long session: `turns` turns, each editing its own file and running a command. */
export function longStory(turns = 60) {
  const story = richStory();
  story.turns = [];
  story.files = [];
  for (let i = 1; i <= turns; i++) {
    const rel = `src/dir${i % 5}/file${i}.mjs`;
    story.turns.push({
      index: i, id: `u${i}`, at: null, prompt: `Prompt ${i}`, summary: `Did step ${i}.`, replies: [],
      edits: [{ id: `le${i}`, tool: 'Edit', file: `/proj/${rel}`, rel, kind: 'update', result: 'ok', hunks: [hunk([`-old${i}`, `+new${i}`])], stats: { added: 1, removed: 1 }, before: `old${i}\n` }],
      bash: [{ id: `lb${i}`, command: `echo ${i}`, description: '', category: 'other', ok: true, exit_code: 0, rejected: false, interrupted: false, output_tail: '' }],
      errors: [], plan: null,
    });
    story.files.push({ rel, language: 'javascript', turns: [i], churn: false, stats: { added: 1, removed: 1 } });
  }
  story.totals = { turns, files: turns, added: turns, removed: turns, edits: turns };
  story.trace = { events: [], cost_states: [] };
  return story;
}
