/**
 * Builds the synthetic Claude Code transcript behind the public example story
 * (examples/ and the Pages site). Everything in it is invented — a small todo
 * app gaining due dates — so the example never carries a real session.
 *
 * Exports `demoTranscript()` (JSONL text), `DEMO` (cwd and session id) and
 * `fillDemoStory(story)` (the summaries Claude would write in step 2).
 */

export const DEMO = { cwd: '/home/dev/todo-app', sessionId: 'demo-7f3a9c21' };

const T0 = Date.parse('2026-10-14T09:12:00.000Z');
const MODEL = 'claude-opus-5-5';
const VERSION = '2.1.290';

const FILES = {
  'src/todo.js': `export function createTodo(title) {
  return {
    id: crypto.randomUUID(),
    title: title.trim(),
    done: false,
  };
}

export function toggle(todo) {
  return { ...todo, done: !todo.done };
}
`,
  'src/render.js': `import { escape } from './html.js';

export function renderTodo(todo) {
  const cls = todo.done ? 'todo done' : 'todo';
  return \`<li class="\${cls}">\${escape(todo.title)}</li>\`;
}

export function renderList(todos) {
  return \`<ul>\${todos.map(renderTodo).join('')}</ul>\`;
}
`,
  'test/todo.test.js': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTodo, toggle } from '../src/todo.js';

test('createTodo trims the title', () => {
  assert.equal(createTodo('  milk ').title, 'milk');
});

test('toggle flips done', () => {
  assert.equal(toggle(createTodo('a')).done, true);
});
`,
  'README.md': `# todo-app

A tiny todo list with no dependencies.

## Usage

\`\`\`js
import { createTodo } from './src/todo.js';
\`\`\`
`,
};

/** One-hunk structuredPatch for replacing `oldStr` with `newStr` in `before`. */
function patch(before, oldStr, newStr) {
  const after = before.replace(oldStr, newStr);
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) { endA--; endB--; }
  const ctxStart = Math.max(0, start - 3);
  const ctxEndA = Math.min(a.length - 2, endA + 3);
  const ctxEndB = Math.min(b.length - 2, endB + 3);
  const lines = [
    ...a.slice(ctxStart, start).map((l) => ' ' + l),
    ...a.slice(start, endA + 1).map((l) => '-' + l),
    ...b.slice(start, endB + 1).map((l) => '+' + l),
    ...a.slice(endA + 1, ctxEndA + 1).map((l) => ' ' + l),
  ];
  return {
    after,
    hunks: [{
      oldStart: ctxStart + 1,
      oldLines: ctxEndA - ctxStart + 1,
      newStart: ctxStart + 1,
      newLines: ctxEndB - ctxStart + 1,
      lines,
    }],
  };
}

export function demoTranscript() {
  const files = { ...FILES };
  const out = [];
  let clock = T0;
  let n = 0;
  const base = () => ({ sessionId: DEMO.sessionId, cwd: DEMO.cwd, gitBranch: 'feat/due-dates', version: VERSION });
  const at = (ms) => new Date((clock += ms)).toISOString();
  const id = (p) => `${p}${++n}`;
  let parent = null;
  const push = (rec) => { out.push(rec); parent = rec.uuid ?? parent; };

  const prompt = (text) => push({ type: 'user', uuid: id('u'), parentUuid: parent, timestamp: at(4000), ...base(), message: { role: 'user', content: text } });

  const assistant = (content, outTokens, ms = 3000) => push({
    type: 'assistant', uuid: id('a'), parentUuid: parent, timestamp: at(ms), ...base(),
    message: {
      id: id('msg_'), role: 'assistant', model: MODEL,
      usage: { input_tokens: 12, output_tokens: outTokens, cache_creation_input_tokens: 900, cache_read_input_tokens: 18000 },
      content,
    },
  });

  const toolResult = (toolUseId, content, toolUseResult, { isError = false, ms = 1200 } = {}) => push({
    type: 'user', uuid: id('r'), parentUuid: parent, timestamp: at(ms), ...base(),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: isError, content }] },
    toolUseResult,
  });

  const say = (text, outTokens) => assistant([{ type: 'text', text }], outTokens, 2500);

  const read = (rel) => {
    const tu = id('toolu_');
    assistant([{ type: 'tool_use', id: tu, name: 'Read', input: { file_path: `${DEMO.cwd}/${rel}` } }], 60);
    toolResult(tu, files[rel], { type: 'text', file: { filePath: `${DEMO.cwd}/${rel}`, content: files[rel], numLines: files[rel].split('\n').length - 1 } });
  };

  const edit = (rel, oldStr, newStr, outTokens) => {
    const tu = id('toolu_');
    const before = files[rel];
    const { after, hunks } = patch(before, oldStr, newStr);
    assistant([{ type: 'tool_use', id: tu, name: 'Edit', input: { file_path: `${DEMO.cwd}/${rel}`, old_string: oldStr, new_string: newStr, replace_all: false } }], outTokens);
    toolResult(tu, `The file ${DEMO.cwd}/${rel} has been updated.`, {
      filePath: `${DEMO.cwd}/${rel}`, oldString: oldStr, newString: newStr, originalFile: before,
      replaceAll: false, structuredPatch: hunks, userModified: false,
    });
    files[rel] = after;
  };

  const write = (rel, content, outTokens) => {
    const tu = id('toolu_');
    assistant([{ type: 'tool_use', id: tu, name: 'Write', input: { file_path: `${DEMO.cwd}/${rel}`, content } }], outTokens);
    toolResult(tu, `File created successfully at: ${DEMO.cwd}/${rel}`, {
      type: 'create', filePath: `${DEMO.cwd}/${rel}`, content, originalFile: '', structuredPatch: [], userModified: false,
    });
    files[rel] = content;
  };

  const bash = (command, description, result, { ok = true, ms = 6000 } = {}) => {
    const tu = id('toolu_');
    assistant([{ type: 'tool_use', id: tu, name: 'Bash', input: { command, description } }], 80);
    if (ok) toolResult(tu, result, { stdout: result, stderr: '', interrupted: false, isImage: false }, { ms });
    else toolResult(tu, `Exit code 1\n${result}`, `Error: Exit code 1\n${result}`, { isError: true, ms });
  };

  const turnEnd = (durationMs) => push({ type: 'system', subtype: 'turn_duration', uuid: id('s'), parentUuid: parent, timestamp: at(500), ...base(), durationMs, isMeta: false });

  // Turn 1 — due dates, a failing test, the fix.
  prompt('Add an optional due date to todos, and show overdue ones in red.');
  read('src/todo.js');
  read('src/render.js');
  edit('src/todo.js',
    `export function createTodo(title) {
  return {
    id: crypto.randomUUID(),
    title: title.trim(),
    done: false,
  };
}`,
    `export function createTodo(title, { due = null } = {}) {
  return {
    id: crypto.randomUUID(),
    title: title.trim(),
    done: false,
    due: due ? new Date(due).toISOString().slice(0, 10) : null,
  };
}

export function isOverdue(todo, today = new Date()) {
  return !todo.done && todo.due !== null && todo.due < today.toISOString().slice(0, 10);
}`, 420);
  edit('src/render.js',
    `import { escape } from './html.js';

export function renderTodo(todo) {
  const cls = todo.done ? 'todo done' : 'todo';
  return \`<li class="\${cls}">\${escape(todo.title)}</li>\`;
}`,
    `import { escape } from './html.js';
import { isOverdue } from './todo.js';

export function renderTodo(todo, today) {
  const cls = ['todo', todo.done && 'done', isOverdue(todo, today) && 'overdue'].filter(Boolean).join(' ');
  const due = todo.due ? \` <time datetime="\${todo.due}">\${todo.due}</time>\` : '';
  return \`<li class="\${cls}">\${escape(todo.title)}\${due}</li>\`;
}`, 380);
  bash('npm test', 'Run the test suite',
    `✖ createTodo trims the title
  AssertionError: Expected values to be strictly deep-equal:
  + actual - expected
  ... Lines skipped
ℹ tests 2
ℹ pass 1
ℹ fail 1`, { ok: false });
  read('test/todo.test.js');
  edit('test/todo.test.js',
    `test('createTodo trims the title', () => {
  assert.equal(createTodo('  milk ').title, 'milk');
});`,
    `test('createTodo trims the title', () => {
  assert.equal(createTodo('  milk ').title, 'milk');
});

test('createTodo keeps an optional due date as YYYY-MM-DD', () => {
  assert.equal(createTodo('a', { due: '2026-10-20T08:00:00Z' }).due, '2026-10-20');
  assert.equal(createTodo('a').due, null);
});

test('isOverdue ignores done todos and todos without a date', () => {
  const today = new Date('2026-10-14');
  assert.equal(isOverdue(createTodo('a', { due: '2026-10-01' }), today), true);
  assert.equal(isOverdue(toggle(createTodo('a', { due: '2026-10-01' })), today), false);
  assert.equal(isOverdue(createTodo('a'), today), false);
});`, 510);
  edit('test/todo.test.js',
    `import { createTodo, toggle } from '../src/todo.js';`,
    `import { createTodo, toggle, isOverdue } from '../src/todo.js';`, 90);
  bash('npm test', 'Run the test suite again', `ℹ tests 4
ℹ pass 4
ℹ fail 0`);
  say(`Todos now take an optional \`due\` date (stored as \`YYYY-MM-DD\`), and \`isOverdue()\` decides when one is late — never when it is done or has no date. Overdue items get an \`overdue\` class in \`renderTodo\`; the first test run failed because the old assertion compared the whole todo object, so I narrowed the tests and added two for the new behaviour. All 4 tests pass.

You'll still need a CSS rule for \`.overdue\` — there is no stylesheet in the repo yet.`, 260);
  turnEnd(64000);

  // Turn 2 — sorting.
  prompt('Sort the list so overdue items come first, then by due date.');
  write('src/sort.js', `import { isOverdue } from './todo.js';

/** Overdue first, then by due date (undated last), then by title. */
export function sortTodos(todos, today = new Date()) {
  return [...todos].sort((a, b) =>
    Number(isOverdue(b, today)) - Number(isOverdue(a, today)) ||
    (a.due ?? '9999-12-31').localeCompare(b.due ?? '9999-12-31') ||
    a.title.localeCompare(b.title)
  );
}
`, 340);
  edit('src/render.js',
    `export function renderList(todos) {
  return \`<ul>\${todos.map(renderTodo).join('')}</ul>\`;
}`,
    `export function renderList(todos, today = new Date()) {
  return \`<ul>\${sortTodos(todos, today).map((t) => renderTodo(t, today)).join('')}</ul>\`;
}`, 160);
  edit('src/render.js',
    `import { isOverdue } from './todo.js';`,
    `import { isOverdue } from './todo.js';
import { sortTodos } from './sort.js';`, 70);
  bash('npm test', 'Run the test suite', `ℹ tests 4
ℹ pass 4
ℹ fail 0`);
  say('`renderList` now sorts through a new `sortTodos()` in `src/sort.js`: overdue first, then by due date with undated items last, then alphabetically. It copies the array instead of sorting in place, so callers keep their order. Tests still pass; sorting itself has no test yet.', 150);
  turnEnd(31000);

  // Turn 3 — docs.
  prompt('Document due dates in the README.');
  edit('README.md',
    `\`\`\`js
import { createTodo } from './src/todo.js';
\`\`\``,
    `\`\`\`js
import { createTodo } from './src/todo.js';

const milk = createTodo('Buy milk', { due: '2026-10-20' });
\`\`\`

## Due dates

A todo may carry a \`due\` date (\`YYYY-MM-DD\`). Lists render overdue,
unfinished todos first with an \`overdue\` class, then the rest by due date;
todos without a date come last.`, 230);
  say('Added a "Due dates" section to the README with a `createTodo` example and the sort order.', 40);
  turnEnd(14000);

  out.push({
    type: 'cost-state', sessionId: DEMO.sessionId, totalCostUSD: 0.83, totalAPIDuration: 71000,
    totalToolDuration: 38000, totalDuration: 109000,
    modelUsage: { [MODEL]: { inputTokens: 290, outputTokens: 3240, thinkingTokens: 0, cacheReadInputTokens: 432000, cacheCreationInputTokens: 21600, costUSD: 0.83 } },
    hasUnknownModelCost: false,
  });

  return out.map((r) => JSON.stringify(r)).join('\n') + '\n';
}

/**
 * Run the skill's whole flow on the demo transcript with the CLI at `bin`:
 * extract → fill summaries → validate --strict → render. Renders into the
 * library at `library`, or to the single page `out`. Returns the story path.
 */
export async function renderDemo({ bin, library, out }) {
  const { execFileSync } = await import('node:child_process');
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');

  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'session-story-demo-'));
  const claudeDir = path.join(work, 'projects');
  const slugDir = path.join(claudeDir, DEMO.cwd.replace(/[^A-Za-z0-9]/g, '-'));
  await fs.mkdir(slugDir, { recursive: true });
  await fs.writeFile(path.join(slugDir, `${DEMO.sessionId}.jsonl`), demoTranscript());

  const storyPath = path.join(work, 'story.json');
  const node = (...args) => execFileSync(process.execPath, [bin, ...args], { encoding: 'utf8' });
  node('extract', '--claude-dir', claudeDir, '--cwd', DEMO.cwd, '--session', DEMO.sessionId,
    '--no-git', '--no-chain', '-o', storyPath);
  const story = JSON.parse(await fs.readFile(storyPath, 'utf8'));
  await fs.writeFile(storyPath, JSON.stringify(fillDemoStory(story), null, 2));
  node('validate', storyPath, '--strict');
  node('render', storyPath, ...(out ? ['-o', out] : ['--library', library]));
  return storyPath;
}

/** The fields Claude writes in SKILL.md step 2, filled in for the demo. */
export function fillDemoStory(story) {
  story.session.title = 'Due dates for todos';
  story.session.summary = 'Todos take an optional due date, overdue ones render first and marked, and the README documents it. Sorting has no test yet.';
  const turns = [
    {
      summary: 'Added optional due dates and an overdue check, with tests.',
      answer: 'Todos now carry an optional YYYY-MM-DD due date and isOverdue() marks late, unfinished ones. A first test run failed and was fixed; 4 tests pass. A CSS rule for .overdue is still needed.',
    },
    {
      summary: 'Sorted the list: overdue first, then by due date.',
      answer: 'renderList now sorts through sortTodos(): overdue first, then by date with undated items last, then by title. Tests pass; sorting has no test yet.',
    },
    {
      summary: 'Documented due dates in the README.',
      answer: 'Added a "Due dates" README section with an example and the sort order.',
    },
  ];
  story.turns.forEach((t, i) => Object.assign(t, turns[i]));
  for (const t of story.turns) for (const e of t.errors ?? []) {
    e.resolution = 'The old assertion compared the whole todo object; the tests were narrowed and two were added for due dates.';
  }
  story.report.plan = 'Give todos an optional due date, highlight the ones that are overdue, and put them at the top of the list. Then document the feature.';
  story.report.decisions = [
    'Stored due dates as YYYY-MM-DD strings, so comparing them is a plain string comparison.',
    'Sorted a copy in sortTodos() instead of sorting the caller\'s array in place.',
  ];
  story.report.outcome = 'partial';
  story.report.outcome_note = 'Works and is tested, except sortTodos(), and .overdue has no CSS rule yet.';
  return story;
}
