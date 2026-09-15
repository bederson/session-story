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

test('renderFullFile stops emitting full views once the page budget is spent, and resumes after a reset', async () => {
  const { resetFullViewBudget, FULL_VIEW_BUDGET_CHARS } = await import('../src/render/full-view.mjs');
  resetFullViewBudget();

  const chunk = 'some line of code\n'.repeat(1000);
  let emitted = 0;
  for (let i = 0; i < Math.ceil(FULL_VIEW_BUDGET_CHARS / chunk.length) + 2; i++) {
    if (renderFullFile(chunk, [])) emitted++;
  }

  assert.ok(emitted > 0, 'some full views fit in the budget');
  assert.equal(renderFullFile(chunk, []), '', 'budget is spent');
  resetFullViewBudget();
  assert.notEqual(renderFullFile(chunk, []), '', 'reset restores the budget');
});

test('renderViews shows a placeholder instead of splicing the file when told to skip, and spends no page budget', async () => {
  const { renderViews } = await import('../src/render/diff.mjs');
  const { resetFullViewBudget, renderFullFile } = await import('../src/render/full-view.mjs');
  resetFullViewBudget();

  const html = renderViews(
    [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+A'] }],
    'a\nb\n', false, 'skip'
  );

  assert.match(html, /class="view view-full"/);
  assert.doesNotMatch(html, /<table class="hunk full">/);
  assert.match(html, /outside the project/i);
  // the skip never touched the shared budget, so a real full view still fits
  assert.notEqual(renderFullFile('a\nb\n', []), '');
});
