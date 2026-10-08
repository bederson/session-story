import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spliceFullFile, renderFullFile, FULL_VIEW_MAX_LINES } from '../src/render/full-view.mjs';

test('spliceFullFile surrounds each hunk with the file lines it never touched', () => {
  const rows = spliceFullFile('l1\nl2\nl3\nl4\nl5\n', [
    { oldStart: 3, oldLines: 1, newStart: 3, newLines: 1, lines: ['-l3', '+L3'] },
  ]);

  assert.deepEqual(rows.map((r) => [r.kind, r.oldNo, r.newNo, r.text]), [
    ['ctx', 1, 1, 'l1'],
    ['ctx', 2, 2, 'l2'],
    ['del', 3, null, 'l3'],
    ['add', null, 3, 'L3'],
    ['ctx', 4, 4, 'l4'],
    ['ctx', 5, 5, 'l5'],
  ]);
});

test('spliceFullFile handles hunks on the very first and very last line', () => {
  const rows = spliceFullFile('a\nb\nc\n', [
    { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+A'] },
    { oldStart: 3, oldLines: 1, newStart: 3, newLines: 1, lines: ['-c', '+C'] },
  ]);

  assert.deepEqual(rows.map((r) => r.kind), ['del', 'add', 'ctx', 'del', 'add']);
  assert.deepEqual(rows.map((r) => r.text), ['a', 'A', 'b', 'c', 'C']);
});

test('spliceFullFile renders a created file as all additions', () => {
  const rows = spliceFullFile('', [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, lines: ['+x', '+y'] }]);

  assert.deepEqual(rows.map((r) => [r.kind, r.newNo, r.text]), [['add', 1, 'x'], ['add', 2, 'y']]);
});

test('spliceFullFile returns null without a base text and for a file past the size cap', () => {
  assert.equal(spliceFullFile(null, []), null);
  assert.equal(spliceFullFile('x\n'.repeat(FULL_VIEW_MAX_LINES + 1), []), null);
});

test('renderFullFile emits one hunk-styled row per file line, marked as the full view', () => {
  const html = renderFullFile('a\nb\n', [
    { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+A'] },
  ]);

  assert.match(html, /<table class="hunk full">/);
  assert.equal((html.match(/class="hunk-line/g) || []).length, 3);
  assert.match(html, /class="hunk-line del"/);
});

test('renderFullFile escapes the untouched file content it copies in', () => {
  const html = renderFullFile('<b>\n', []);

  assert.match(html, /&lt;b&gt;/);
  assert.doesNotMatch(html, /<b>/);
});

test('renderFullFile marks a view built from the file as it stands on disk as approximate', async () => {
  const { renderViews } = await import('../src/render/diff.mjs');

  const html = renderViews([{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+A'] }], 'a\nb\n', true);

  assert.match(html, /class="approx-note"/);
  assert.match(html, /current contents/i);
});

test('spliceFullFile refuses a base whose sheer size would bloat the page', async () => {
  const { FULL_VIEW_MAX_CHARS } = await import('../src/render/full-view.mjs');

  // few lines, but enormous: line caps alone would let this through
  assert.equal(spliceFullFile(`${'x'.repeat(FULL_VIEW_MAX_CHARS + 1)}\n`, []), null);
});

test('spliceFullFile refuses a result too large for the page, even when the base is empty', async () => {
  const { FULL_VIEW_MAX_CHARS } = await import('../src/render/full-view.mjs');

  // A created file starts from '' so only the result can show its size.
  const huge = Array.from({ length: FULL_VIEW_MAX_LINES + 1 }, () => '+x');
  assert.equal(spliceFullFile('', [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: huge.length, lines: huge }]), null);
  const heavy = [`+${'x'.repeat(FULL_VIEW_MAX_CHARS + 1)}`];
  assert.equal(spliceFullFile('', [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: heavy }]), null);
});

function planStory(turnEdits) {
  return {
    turns: turnEdits.map((edits, i) => ({ index: i + 1, edits })),
  };
}

function planEdit(id, extra = {}) {
  return { id, rel: `${id}.txt`, result: 'ok', hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+A'] }], ...extra };
}

test('planFullViews spends the page budget on the newest turns first and marks the rest as left out', async () => {
  const { planFullViews } = await import('../src/render/full-view.mjs');
  const base = 'a\n' + 'line of code\n'.repeat(400);
  const story = planStory([[planEdit('old')], [planEdit('mid')], [planEdit('new')]]);
  const bases = new Map([['old', base], ['mid', base], ['new', base]]);
  const one = renderFullFile(base, story.turns[0].edits[0].hunks).length;

  const plan = planFullViews(story, bases, one * 2);

  assert.match(plan.get('new'), /<table class="hunk full">/);
  assert.match(plan.get('mid'), /<table class="hunk full">/);
  assert.equal(plan.get('old'), null, 'out of budget');
});

test('planFullViews leaves out edits that never get a full view, and records "unavailable" as an empty string', async () => {
  const { planFullViews } = await import('../src/render/full-view.mjs');
  const story = planStory([[
    planEdit('outside', { outside_cwd: true }),
    planEdit('shared', { combined_into: 2 }),
    planEdit('failed', { result: 'error' }),
    planEdit('nobase'),
  ]]);

  const plan = planFullViews(story, new Map());

  assert.equal(plan.has('outside'), false);
  assert.equal(plan.has('shared'), false);
  assert.equal(plan.has('failed'), false);
  assert.equal(plan.get('nobase'), '');
});

test('renderViews places a planned full view, a reference to one, or a note for each other case', async () => {
  const { renderViews } = await import('../src/render/diff.mjs');
  const hunks = [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+A'] }];

  assert.match(renderViews(hunks, null, false, { html: '<table class="hunk full"></table>' }), /<div class="view view-full"><table class="hunk full">/);
  assert.match(renderViews(hunks, null, false, { html: '' }), /did not record its contents/);
  assert.match(renderViews(hunks, null, false, { ref: 'e"1' }), /<div class="view view-full" data-full-ref="e&quot;1"><\/div>/);
  assert.match(renderViews(hunks, null, false, 'budget'), /left out to keep the page small/i);
});

test('renderViews shows a placeholder instead of splicing the file when told to skip', async () => {
  const { renderViews } = await import('../src/render/diff.mjs');

  const html = renderViews(
    [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+A'] }],
    'a\nb\n', false, 'skip'
  );

  assert.match(html, /class="view view-full"/);
  assert.doesNotMatch(html, /<table class="hunk full">/);
  assert.match(html, /outside the project/i);
});
