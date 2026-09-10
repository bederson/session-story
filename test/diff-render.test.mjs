import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, renderHunk } from '../src/render/diff.mjs';

test('escapeHtml escapes <, >, &, and quotes', () => {
  assert.equal(escapeHtml('<script>a && b</script> "q" \'s\''), '&lt;script&gt;a &amp;&amp; b&lt;/script&gt; &quot;q&quot; &#39;s&#39;');
});

test('renderHunk produces one row per line with correct old/new line numbers and classes', () => {
  const hunk = {
    oldStart: 5, oldLines: 2, newStart: 5, newLines: 2,
    lines: [' context line', '-removed line', '+added line'],
  };

  const html = renderHunk(hunk);

  assert.match(html, /class="hunk-line ctx"/);
  assert.match(html, /class="hunk-line del"/);
  assert.match(html, /class="hunk-line add"/);
  // context line: old 5, new 5
  assert.match(html, /<td class="ln old">5<\/td>\s*<td class="ln new">5<\/td>/);
  // removed line: old 6, new blank
  assert.match(html, /<td class="ln old">6<\/td>\s*<td class="ln new"><\/td>/);
  // added line: old blank, new 6
  assert.match(html, /<td class="ln old"><\/td>\s*<td class="ln new">6<\/td>/);
});

test('renderHunk escapes HTML-significant characters in code content', () => {
  const hunk = { oldStart: 1, oldLines: 0, newStart: 1, newLines: 1, lines: ['+<div class="x">'] };

  const html = renderHunk(hunk);

  assert.match(html, /&lt;div class=&quot;x&quot;&gt;/);
  assert.doesNotMatch(html, /<div class="x">/);
});

test('renderEdit wraps a file header and all of its hunks, marking creates and subagent edits', async () => {
  const { renderEdit } = await import('../src/render/diff.mjs');
  const edit = {
    rel: 'src/a.ts', kind: 'update', by_subagent: null, result: 'ok',
    hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }],
    stats: { added: 1, removed: 1 },
  };

  const html = renderEdit(edit);

  assert.match(html, /src\/a\.ts/);
  assert.match(html, /class="hunk"/);
});

test('renderEdit shows a "no result" note for an edit with an unknown result', async () => {
  const { renderEdit } = await import('../src/render/diff.mjs');
  const edit = { rel: 'src/a.ts', kind: null, by_subagent: null, result: 'unknown', hunks: [], stats: { added: 0, removed: 0 } };

  const html = renderEdit(edit);

  assert.match(html, /result unknown/i);
});
