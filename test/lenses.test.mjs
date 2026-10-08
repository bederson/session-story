import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHeader, formatRange } from '../src/render/lenses.mjs';

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
  // The prompt itself must render as visible text, not only as a title tooltip.
  assert.match(html, /<blockquote class="turn-prompt">Add a title prop<\/blockquote>/);
  assert.match(html, /<p class="turn-summary">Added title prop\.<\/p>/);
  assert.match(html, /src\/Panel\.tsx/);
  assert.match(html, /class="[^"]*churn[^"]*"/);
  assert.match(html, /class="hunk"/); // edit panel content rendered via renderEdit
});

test('renderReviewLens renders each file chip as a button keyed to the file, so it can scroll to that edit', async () => {
  const { renderReviewLens } = await import('../src/render/lenses.mjs');
  const story = sampleStory({
    turns: [
      { index: 1, id: 'u1', at: null, prompt: 'Add a title prop', summary: '', edits: [
        { id: 'e1', tool: 'Edit', file: '/p/src/Panel.tsx', rel: 'src/Panel.tsx', kind: 'update', by_subagent: null, result: 'ok', hunks: [], stats: { added: 1, removed: 1 } },
        // a second edit to the same file must not produce a second chip
        { id: 'e2', tool: 'Edit', file: '/p/src/Panel.tsx', rel: 'src/Panel.tsx', kind: 'update', by_subagent: null, result: 'ok', hunks: [], stats: { added: 1, removed: 0 } },
        { id: 'e3', tool: 'Edit', file: '/tmp/s.json', rel: '../../tmp/s.json', outside_cwd: true, kind: 'update', by_subagent: null, result: 'ok', hunks: [], stats: { added: 1, removed: 0 } },
      ] },
    ],
    files: [{ rel: 'src/Panel.tsx', language: 'typescript', turns: [1], churn: true, stats: { added: 2, removed: 1 } }],
  });

  const html = renderReviewLens(story);

  const chips = html.match(/<button type="button" class="chip[^"]*" data-file="src\/Panel\.tsx"/g) || [];
  assert.equal(chips.length, 1);
  // the chip key must match the key renderEdit puts on the block it scrolls to
  assert.match(html, /<div class="edit" data-file="src\/Panel\.tsx"/);
  // churn and scope markers survive the change from span to button
  assert.match(html, /class="chip churn" data-file="src\/Panel\.tsx"/);
  assert.match(html, /class="chip" data-file="\.\.\/\.\.\/tmp\/s\.json" data-outside="1"/);
});

test('renderReviewLens gives a multi-file turn panel a file filter: "All changes" plus one button per file', async () => {
  const { renderReviewLens } = await import('../src/render/lenses.mjs');
  const story = sampleStory({
    turns: [
      { index: 1, id: 'u1', at: null, prompt: 'Two files', summary: '', edits: [
        { id: 'e1', tool: 'Edit', file: '/p/src/a.ts', rel: 'src/a.ts', kind: 'update', by_subagent: null, result: 'ok', hunks: [], stats: { added: 2, removed: 1 } },
        { id: 'e2', tool: 'Edit', file: '/p/src/a.ts', rel: 'src/a.ts', kind: 'update', by_subagent: null, result: 'ok', hunks: [], stats: { added: 3, removed: 0 } },
        { id: 'e3', tool: 'Edit', file: '/tmp/s.json', rel: '../../tmp/s.json', outside_cwd: true, kind: 'update', by_subagent: null, result: 'ok', hunks: [], stats: { added: 1, removed: 0 } },
      ] },
      { index: 2, id: 'u2', at: null, prompt: 'One file', summary: '', edits: [
        { id: 'e4', tool: 'Edit', file: '/p/src/a.ts', rel: 'src/a.ts', kind: 'update', by_subagent: null, result: 'ok', hunks: [], stats: { added: 1, removed: 0 } },
      ] },
    ],
    files: [],
  });

  const html = renderReviewLens(story);
  const panel1 = html.slice(html.indexOf('data-turn-panel="1"'), html.indexOf('data-turn-panel="2"'));
  const panel2 = html.slice(html.indexOf('data-turn-panel="2"'));

  assert.match(panel1, /<div class="file-filter" role="group" aria-label="Show changes for">/);
  assert.match(panel1, /<button type="button" class="file-filter-btn" data-file-filter="" aria-pressed="true">[^]*?All changes/);
  // "All changes" totals follow the scope toggle, like the panel meta
  assert.match(panel1, /All changes<\/span><span class="v-in">[^]*?\+5[^]*?<span class="v-all">[^]*?\+6/);
  // one button per distinct file, carrying that file's summed stats
  const fileButtons = panel1.match(/data-file-filter="src\/a\.ts"/g) || [];
  assert.equal(fileButtons.length, 1);
  assert.match(panel1, /data-file-filter="src\/a\.ts" aria-pressed="false"[^>]*>[^]*?\+5/);
  // an outside-project file's button hides with the scope toggle like its edits do
  assert.match(panel1, /data-file-filter="\.\.\/\.\.\/tmp\/s\.json" aria-pressed="false" data-outside="1"/);
  // a single-file turn has nothing to filter
  assert.doesNotMatch(panel2, /file-filter/);
});

test('renderReviewLens escapes quotes in a file chip key', async () => {
  const { renderReviewLens } = await import('../src/render/lenses.mjs');
  const story = sampleStory({
    turns: [{ index: 1, id: 'u1', at: null, prompt: 'p', summary: '', edits: [
      { id: 'e1', tool: 'Edit', file: '/p/a', rel: 'a"><img src=x>.ts', kind: 'update', by_subagent: null, result: 'ok', hunks: [], stats: { added: 0, removed: 0 } },
    ] }],
    files: [],
  });

  const html = renderReviewLens(story);

  assert.match(html, /data-file="a&quot;&gt;&lt;img src=x&gt;\.ts"/);
  assert.doesNotMatch(html, /<img src=x>/);
});

test('renderReviewLens omits the summary paragraph when a turn has no summary yet, but still shows the prompt', async () => {
  const { renderReviewLens } = await import('../src/render/lenses.mjs');
  const story = sampleStory({
    turns: [{ index: 1, id: 'u1', at: null, prompt: 'Investigate the flaky test', summary: '', edits: [] }],
  });

  const html = renderReviewLens(story);

  assert.match(html, /<blockquote class="turn-prompt">Investigate the flaky test<\/blockquote>/);
  assert.doesNotMatch(html, /class="turn-summary"/);
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

test('renderHeader renders the counts as stat tiles with icons, a decorative motif, and a per-turn session strip', () => {
  const story = sampleStory({
    turns: [
      { index: 1, id: 'u1', prompt: 'a', summary: 'A.', edits: [{ id: 'e1', tool: 'Edit', file: '/p/a', rel: 'a', kind: 'update', by_subagent: null, result: 'ok', hunks: [], stats: { added: 3, removed: 1 } }] },
      { index: 2, id: 'u2', prompt: 'b', summary: 'B.', edits: [] },
    ],
    totals: { turns: 2, files: 1, added: 3, removed: 1, edits: 1 },
  });

  const html = renderHeader(story);

  assert.equal((html.match(/class="stat-tile/g) || []).length, 4);
  assert.match(html, /<span class="stat-value">2<\/span>\s*<span class="stat-label">turns<\/span>/);
  assert.match(html, /class="stat-value"><span class="v-in">\+3<\/span>/);
  assert.match(html, /class="header-motif"/);
  assert.equal((html.match(/class="strip-seg/g) || []).length, 4); // one strip per scope
  assert.match(html, /class="strip-seg empty"/); // turn 2 made no edits
  assert.match(html, /title="Turn 1: \+3 −1"/);
});

test('renderReviewLens gives each timeline item an added/removed activity bar scaled to the busiest turn', async () => {
  const { renderReviewLens } = await import('../src/render/lenses.mjs');
  const story = sampleStory({
    turns: [
      { index: 1, id: 'u1', at: null, prompt: 'a', summary: 'A.', edits: [{ id: 'e1', tool: 'Edit', file: '/p/a', rel: 'a', kind: 'update', by_subagent: null, result: 'ok', hunks: [], stats: { added: 4, removed: 0 } }] },
      { index: 2, id: 'u2', at: null, prompt: 'b', summary: 'B.', edits: [{ id: 'e2', tool: 'Edit', file: '/p/b', rel: 'b', kind: 'update', by_subagent: null, result: 'ok', hunks: [], stats: { added: 1, removed: 1 } }] },
    ],
  });

  const html = renderReviewLens(story);

  // turn 1: 4 of max 4 -> 100% add, no del segment; turn 2: 25% add, 25% del
  assert.match(html, /<span class="bar-add" style="width:100%"><\/span>/);
  assert.match(html, /<span class="bar-add" style="width:25%"><\/span><span class="bar-del" style="width:25%"><\/span>/);
  assert.match(html, /<span class="bar-label"><span class="v-in">\+4 −0<\/span><span class="v-all">\+4 −0<\/span><\/span>/);
});

test('renderStoryLens cards carry the same activity bar as the review timeline', async () => {
  const { renderStoryLens } = await import('../src/render/lenses.mjs');
  const story = sampleStory({
    turns: [{ index: 1, id: 'u1', prompt: 'a', summary: 'A.', edits: [{ id: 'e1', tool: 'Edit', file: '/p/a', rel: 'a', kind: 'update', by_subagent: null, result: 'ok', hunks: [], stats: { added: 2, removed: 2 } }] }],
  });

  const html = renderStoryLens(story);

  assert.match(html, /class="turn-bars"/);
  assert.match(html, /\+2 −2/);
});

function outsideStory() {
  const inside = { id: 'e1', tool: 'Edit', file: '/p/a.ts', rel: 'a.ts', kind: 'update', by_subagent: null, result: 'ok', outside_cwd: false, before: 'a\n', hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+A'] }], stats: { added: 2, removed: 0 } };
  const outside = { id: 'e2', tool: 'Edit', file: '/tmp/s.json', rel: '../../tmp/s.json', kind: 'update', by_subagent: null, result: 'ok', outside_cwd: true, before: null, hunks: [], stats: { added: 5, removed: 5 } };
  return sampleStory({
    turns: [
      { index: 1, id: 'u1', at: null, prompt: 'p1', summary: 'S1.', edits: [inside, outside] },
      { index: 2, id: 'u2', at: null, prompt: 'p2', summary: 'S2.', edits: [outside] },
    ],
    files: [
      { rel: 'a.ts', language: 'typescript', turns: [1], churn: false, outside_cwd: false, stats: { added: 2, removed: 0 } },
      { rel: '../../tmp/s.json', language: 'json', turns: [1, 2], churn: true, outside_cwd: true, stats: { added: 10, removed: 10 } },
    ],
    totals: { turns: 2, files: 2, added: 7, removed: 5, edits: 3 },
  });
}

test('renderHeader carries both in-project and overall counts, two session strips, and a note about what is hidden', () => {
  const html = renderHeader(outsideStory());

  assert.match(html, /<span class="v-in">1<\/span><span class="v-all">2<\/span>/); // files
  assert.match(html, /<span class="v-in">\+2<\/span><span class="v-all">\+7<\/span>/); // added
  assert.match(html, /class="session-strip" data-scope="in"/);
  assert.match(html, /class="session-strip" data-scope="all"/);
  assert.match(html, /class="outside-note only-when-filtered"/);
  assert.match(html, /outside the project/i);
});

test('renderHeader skips combined_into shares in its project-only counts, as the session totals do', () => {
  const story = outsideStory();
  const inside = story.turns[0].edits[0];
  const outside = story.turns[0].edits[1];
  story.turns[1].edits = [{ ...inside, id: 'e3', combined_into: 1 }, { ...outside, id: 'e4', combined_into: 1 }];
  story.totals = { turns: 2, files: 2, added: 7, removed: 5, edits: 2 };

  const html = renderHeader(story);

  assert.match(html, /<span class="v-in">\+2<\/span><span class="v-all">\+7<\/span>/);
  assert.match(html, /<span class="v-in">−0<\/span><span class="v-all">−5<\/span>/);
  assert.match(html, /\(1 edit\) hidden/);
});

test('renderReviewLens marks out-of-project edits and chips, and explains a turn left empty by the filter', async () => {
  const { renderReviewLens } = await import('../src/render/lenses.mjs');

  const html = renderReviewLens(outsideStory());

  assert.match(html, /<button type="button" class="chip[^"]*" data-file="[^"]*" data-outside="1"/);
  assert.match(html, /<div class="edit" data-file="[^"]*" data-outside="1">/);
  assert.match(html, /<div class="edit" data-file="a\.ts">/); // the in-project edit is not marked
  // turn 2 only touched a file outside the project
  assert.match(html, /class="no-edits only-when-filtered"/);
});

test('renderDiffLens marks the out-of-project file in the tree and its panel', async () => {
  const { renderDiffLens } = await import('../src/render/lenses.mjs');

  const html = renderDiffLens(outsideStory());

  assert.match(html, /<li class="file-tree-item[^"]*" data-file="\.\.\/\.\.\/tmp\/s\.json" data-outside="1"/);
  assert.match(html, /<section class="file-panel" data-file-panel="\.\.\/\.\.\/tmp\/s\.json" data-outside="1"/);
});

test('renderReviewLens passes each edit its reconstructed pre-edit text so the full-file view can render', async () => {
  const { renderReviewLens } = await import('../src/render/lenses.mjs');

  const html = renderReviewLens(outsideStory());

  assert.match(html, /<table class="hunk full">/); // in-project edit had a before snapshot
  assert.match(html, /outside the project/i); // the outside edit gets a skip note, not a splice attempt
});

test('renderStoryLens keeps its collapsed code as hunks only, so the full-file toggle cannot empty it', async () => {
  const { renderStoryLens } = await import('../src/render/lenses.mjs');

  const html = renderStoryLens(outsideStory());

  assert.match(html, /class="view view-hunks"/);
  assert.doesNotMatch(html, /class="view view-full"/);
});

test('renderReviewLens and renderDiffLens skip splicing the full file for out-of-project edits, to save the page budget for project files', async () => {
  const { renderReviewLens, renderDiffLens } = await import('../src/render/lenses.mjs');
  const story = outsideStory();

  const reviewHtml = renderReviewLens(story);
  const diffHtml = renderDiffLens(story);

  // the outside edit (e2, no `before`) never gets a spliced attempt logged as unavailable;
  // it gets the dedicated skip note instead.
  assert.match(reviewHtml, /outside the project/i);
  assert.match(diffHtml, /outside the project/i);
});

test('renderHeader shows an outcome pill and the start/end commit range when report data is present', () => {
  const story = sampleStory({
    report: {
      plan: 'p', decisions: [], outcome: 'completed', outcome_note: null,
      dependencies: { manifests: [], installs: [], config_files: [] },
      git: {
        branch: 'main',
        start_commit: { sha: 'abc1234abc1234abc1234abc1234abc1234abcd', subject: 'Initial commit' },
        end_commit: { sha: 'def5678def5678def5678def5678def5678defg', subject: 'Add feature' },
        commits: [],
        dirty: false,
        status: { modified: 0, added: 0, deleted: 0, untracked: 0 },
      },
    },
  });

  const html = renderHeader(story);

  assert.match(html, /outcome-pill outcome-completed/);
  assert.match(html, /Completed/);
  assert.match(html, /abc1234/);
  assert.match(html, /def5678/);
});

test('renderHeader omits the outcome pill and commit range when report is absent', () => {
  const story = sampleStory();
  delete story.report;

  const html = renderHeader(story);

  assert.doesNotMatch(html, /outcome-pill/);
});

test('the fallback title uses only the first line of the prompt, clamped to 60 chars', () => {
  const story = sampleStory();
  story.session.title = null;
  story.turns[0].prompt = 'Extend session story so that includes also:\nTo add:\nPlan / intent';

  const html = renderHeader(story);

  assert.match(html, /<h1>Extend session story so that includes also:<\/h1>/);
  assert.doesNotMatch(html, /To add:/);
});

test('a long single-line fallback title is truncated to 60 characters plus an ellipsis', () => {
  const story = sampleStory();
  story.session.title = null;
  story.turns[0].prompt = 'a'.repeat(120);

  const html = renderHeader(story);

  const [, heading] = html.match(/<h1>([^<]*)<\/h1>/);
  assert.equal(heading, `${'a'.repeat(60)}…`);
});

test('the header prefers the harness ai_title over the first prompt when Claude wrote no title', () => {
  const story = sampleStory();
  story.session.title = null;
  story.session.ai_title = 'Panel title prop';
  story.turns[0].prompt = 'Add a title prop to Panel and then also write up a README for it';

  const html = renderHeader(story);

  assert.match(html, /<h1>Panel title prop<\/h1>/);
});

test('a Claude-written title still wins over ai_title', () => {
  const story = sampleStory();
  story.session.ai_title = 'Harness guess';

  const html = renderHeader(story);

  assert.match(html, /<h1>Panel title\/subtitle<\/h1>/);
});

test('formatRange shows the start and end time, with the date once when both fall on the same day', () => {
  assert.equal(
    formatRange('2026-09-10T10:00:00.000Z', '2026-09-10T10:05:30.000Z'),
    '2026-09-10 10:00 → 10:05 UTC'
  );
});

test('formatRange repeats the date when the session crosses midnight', () => {
  assert.equal(
    formatRange('2026-09-10T23:50:00.000Z', '2026-09-11T00:20:00.000Z'),
    '2026-09-10 23:50 → 2026-09-11 00:20 UTC'
  );
});

test('formatRange falls back to the start alone without a usable end', () => {
  assert.equal(formatRange('2026-09-10T10:00:00.000Z', null), '2026-09-10 10:00 UTC');
  assert.equal(formatRange('2026-09-10T10:00:00.000Z', 'nope'), '2026-09-10 10:00 UTC');
  assert.equal(formatRange(null, null), '');
});

test('renderHeader shows when the session started and ended', () => {
  const html = renderHeader(sampleStory());
  assert.match(html, /2026-09-10 10:00 → 10:05 UTC/);
});

test('renderHeader shows input tokens incl. cache, output tokens and cost when the story has usage', () => {
  const html = renderHeader(sampleStory({
    metrics: { usage: { input_tokens: 1200, cache_read_tokens: 150000, cache_creation_tokens: 27517, output_tokens: 860, total_cost_usd: 4.2226 } },
  }));
  assert.equal((html.match(/class="stat-tile/g) || []).length, 7);
  assert.match(html, /<span class="stat-value">178\.7k<\/span>\s*<span class="stat-label">input tokens incl\. cache<\/span>/);
  assert.match(html, /<span class="stat-value">860<\/span>\s*<span class="stat-label">output tokens<\/span>/);
  assert.match(html, /<span class="stat-value">\$4\.22<\/span>\s*<span class="stat-label">cost<\/span>/);
});

test('renderHeader leaves out usage tiles it has no numbers for', () => {
  const transcriptOnly = renderHeader(sampleStory({
    metrics: { usage: { input_tokens: 10, cache_read_tokens: 0, cache_creation_tokens: 0, output_tokens: 5, total_cost_usd: null } },
  }));
  assert.equal((transcriptOnly.match(/class="stat-tile/g) || []).length, 6);
  assert.doesNotMatch(transcriptOnly, /stat-label">cost</);
  assert.equal((renderHeader(sampleStory()).match(/class="stat-tile/g) || []).length, 4);
});

test('renderReviewLens stamps each timeline item and turn panel with when the prompt was sent', async () => {
  const { renderReviewLens } = await import('../src/render/lenses.mjs');
  const html = renderReviewLens(sampleStory());
  assert.match(html, /<time class="turn-time" datetime="2026-09-10T10:00:00\.000Z">2026-09-10 10:00 UTC<\/time>/);
  assert.equal(html.match(/class="turn-time"/g).length, 2);
});

test('renderReviewLens omits the timestamp for a turn without one', async () => {
  const { renderReviewLens } = await import('../src/render/lenses.mjs');
  const story = sampleStory();
  story.turns[0].at = null;
  assert.doesNotMatch(renderReviewLens(story), /turn-time/);
});

test('renderStoryLens offers no "Show code" for a turn whose edits carry no diff', async () => {
  const { renderStoryLens } = await import('../src/render/lenses.mjs');
  const story = sampleStory({
    turns: [{ index: 1, id: 'u1', prompt: 'p', summary: 'S.', edits: [
      { id: 'e1', tool: 'Edit', file: '/p/a.ts', rel: 'a.ts', kind: 'update', by_subagent: null, result: 'error', error: 'old_string not found', hunks: [], stats: { added: 0, removed: 0 } },
      { id: 'e2', tool: 'Bash', file: '/p/logo.png', rel: 'logo.png', kind: 'update', by_subagent: null, result: 'ok', binary: true, hunks: [], stats: { added: 0, removed: 0 } },
    ] }],
  });

  assert.doesNotMatch(renderStoryLens(story), /Show code/);
});

test('renderStoryLens shows only edits with a diff under "Show code"', async () => {
  const { renderStoryLens } = await import('../src/render/lenses.mjs');
  const story = sampleStory({
    turns: [{ index: 1, id: 'u1', prompt: 'p', summary: 'S.', edits: [
      { id: 'e1', tool: 'Edit', file: '/p/a.ts', rel: 'a.ts', kind: 'update', by_subagent: null, result: 'error', error: 'old_string not found', hunks: [], stats: { added: 0, removed: 0 } },
      { id: 'e2', tool: 'Edit', file: '/p/b.ts', rel: 'b.ts', kind: 'update', by_subagent: null, result: 'ok',
        hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }], stats: { added: 1, removed: 1 } },
    ] }],
  });

  const html = renderStoryLens(story);

  assert.match(html, /<details class="story-code">/);
  assert.match(html, /data-file="b\.ts"/);
  assert.doesNotMatch(html, /data-file="a\.ts"/);
});

test('renderStoryLens hides "Show code" with the project filter when every change is outside the project', async () => {
  const { renderStoryLens } = await import('../src/render/lenses.mjs');
  const story = outsideStory();
  const hunks = [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-x', '+y'] }];
  for (const turn of story.turns) turn.edits = turn.edits.map((e) => (e.outside_cwd ? { ...e, hunks } : e));
  const html = renderStoryLens(story);
  const turn2 = html.slice(html.lastIndexOf('<article'));

  // turn 2 only touched ../../tmp/s.json, so its toggle hides while "Project files only" is on
  assert.match(turn2, /<details class="story-code" data-outside="1">/);
  // turn 1 has a project change, so its toggle always shows
  assert.match(html.slice(0, html.lastIndexOf('<article')), /<details class="story-code">/);
});
