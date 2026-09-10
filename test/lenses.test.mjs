import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHeader } from '../src/render/lenses.mjs';

function sampleStory(overrides = {}) {
  return {
    schema_version: 1,
    session: {
      id: 's1', cwd: '/Users/nalaj/proj', git_branch: 'main',
      started_at: '2026-09-10T10:00:00.000Z', ended_at: '2026-09-10T10:05:30.000Z', duration_ms: 330000,
      summary: 'Added a title and subtitle to Panel.',
      title: 'Panel title/subtitle',
      blind_spots: ['shell-made changes are not tracked'],
    },
    turns: [{ index: 1, id: 'u1', at: '2026-09-10T10:00:00.000Z', prompt: 'Add a title prop', summary: 'Added title prop.', edits: [] }],
    files: [{ rel: 'src/Panel.tsx', language: 'typescript', turns: [1], churn: false, stats: { added: 3, removed: 1 } }],
    totals: { turns: 1, files: 1, added: 3, removed: 1, edits: 1 },
    ...overrides,
  };
}

test('renderHeader shows title, cwd, branch, totals, session summary, and blind spots', () => {
  const html = renderHeader(sampleStory());

  assert.match(html, /Panel title\/subtitle/);
  assert.match(html, /\/Users\/nalaj\/proj/);
  assert.match(html, /main/);
  assert.match(html, /Added a title and subtitle to Panel\./);
  assert.match(html, /shell-made changes are not tracked/);
  // totals: 1 turn, 1 file, +3/-1
  assert.match(html, /\b1\b.*turn/i);
  assert.match(html, /\+3/);
  assert.match(html, /-1|−1/);
});

test('renderHeader falls back to a truncated first prompt as the title when none was set', () => {
  const story = sampleStory();
  story.session.title = null;
  story.turns[0].prompt = 'This is the very first prompt of the session and it is the fallback title';

  const html = renderHeader(story);

  assert.match(html, /This is the very first prompt/);
});

test('renderReviewLens lists one timeline entry per turn with prompt, summary, file chips, and churn marker', async () => {
  const { renderReviewLens } = await import('../src/render/lenses.mjs');
  const story = sampleStory({
    turns: [
      { index: 1, id: 'u1', at: null, prompt: 'Add a title prop', summary: 'Added title prop.', edits: [
        { id: 'e1', tool: 'Edit', file: '/p/src/Panel.tsx', rel: 'src/Panel.tsx', kind: 'update', by_subagent: null, result: 'ok',
          hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }], stats: { added: 1, removed: 1 } },
      ] },
    ],
    files: [{ rel: 'src/Panel.tsx', language: 'typescript', turns: [1, 2], churn: true, stats: { added: 2, removed: 1 } }],
  });

  const html = renderReviewLens(story);

  assert.match(html, /data-turn="1"/);
  assert.match(html, /Add a title prop/);
  assert.match(html, /Added title prop\./);
  assert.match(html, /src\/Panel\.tsx/);
  assert.match(html, /class="[^"]*churn[^"]*"/);
  assert.match(html, /class="hunk"/); // edit panel content rendered via renderEdit
});

test('renderReviewLens falls back to the prompt itself when a turn has no summary yet', async () => {
  const { renderReviewLens } = await import('../src/render/lenses.mjs');
  const story = sampleStory({
    turns: [{ index: 1, id: 'u1', at: null, prompt: 'Investigate the flaky test', summary: '', edits: [] }],
  });

  const html = renderReviewLens(story);

  assert.match(html, /Investigate the flaky test/);
});

test('renderDiffLens lists a file tree entry and a panel per file, with each hunk tagged by its turn', async () => {
  const { renderDiffLens } = await import('../src/render/lenses.mjs');
  const story = sampleStory({
    turns: [
      { index: 1, id: 'u1', prompt: 'Add a title prop', summary: 'Added title.', edits: [
        { id: 'e1', tool: 'Edit', file: '/p/src/Panel.tsx', rel: 'src/Panel.tsx', kind: 'update', by_subagent: null, result: 'ok',
          hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }], stats: { added: 1, removed: 1 } },
      ] },
      { index: 2, id: 'u2', prompt: 'Also add a subtitle', summary: 'Added subtitle.', edits: [
        { id: 'e2', tool: 'Edit', file: '/p/src/Panel.tsx', rel: 'src/Panel.tsx', kind: 'update', by_subagent: null, result: 'ok',
          hunks: [{ oldStart: 2, oldLines: 1, newStart: 2, newLines: 1, lines: ['-b', '+c'] }], stats: { added: 1, removed: 1 } },
      ] },
    ],
    files: [{ rel: 'src/Panel.tsx', language: 'typescript', turns: [1, 2], churn: true, stats: { added: 2, removed: 2 } }],
  });

  const html = renderDiffLens(story);

  assert.match(html, /data-file="src\/Panel\.tsx"/);
  assert.match(html, /data-file-panel="src\/Panel\.tsx"/);
  const turnTagMatches = html.match(/class="turn-tag"/g) || [];
  assert.equal(turnTagMatches.length, 2);
  assert.match(html, /title="Add a title prop"/);
  assert.match(html, /title="Also add a subtitle"/);
});

test('renderStoryLens renders one card per turn with prompt, summary, file count, and collapsed code', async () => {
  const { renderStoryLens } = await import('../src/render/lenses.mjs');
  const story = sampleStory({
    turns: [{ index: 1, id: 'u1', prompt: 'Add a title prop', summary: 'Added a title prop to Panel.', edits: [
      { id: 'e1', tool: 'Edit', file: '/p/src/Panel.tsx', rel: 'src/Panel.tsx', kind: 'update', by_subagent: null, result: 'ok',
        hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }], stats: { added: 1, removed: 1 } },
    ] }],
  });

  const html = renderStoryLens(story);

  assert.match(html, /Add a title prop/);
  assert.match(html, /Added a title prop to Panel\./);
  assert.match(html, /1 file/);
  assert.match(html, /<details/);
  assert.match(html, /class="hunk"/);
});
