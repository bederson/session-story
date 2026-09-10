import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, cp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const binPath = path.join(repoRoot, 'bin', 'story.mjs');

test('extract -> validate -> render produces a story.json and story.html matching the fixture transcript', async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), 'story-cli-'));
  const cwd = '/proj';
  const claudeDir = path.join(workdir, 'claude-projects');
  const slugDir = path.join(claudeDir, '-proj');
  await mkdir(slugDir, { recursive: true });
  await cp(
    path.join(__dirname, 'fixtures', 'simple-session.jsonl'),
    path.join(slugDir, 'sess-1.jsonl')
  );

  const storyJsonPath = path.join(workdir, 'story.json');
  const extractResult = await run('node', [
    binPath, 'extract',
    '--claude-dir', claudeDir,
    '--cwd', cwd,
    '--session', 'sess-1',
    '-o', storyJsonPath,
    '--brief',
  ]);
  const brief = JSON.parse(extractResult.stdout);
  assert.equal(brief.turns.length, 2);
  assert.equal(brief.turns[0].edits[0].rel, 'src/Panel.tsx');

  // non-strict validate passes even though summaries are empty
  await run('node', [binPath, 'validate', storyJsonPath]);

  // strict validate fails until summaries are filled
  await assert.rejects(() => run('node', [binPath, 'validate', storyJsonPath, '--strict']));

  const story = JSON.parse(await readFile(storyJsonPath, 'utf8'));
  story.session.summary = 'Added a title prop and a README.';
  story.turns[0].summary = 'Added a title prop to Panel.';
  story.turns[1].summary = 'Created the README.';
  await import('node:fs/promises').then((fs) => fs.writeFile(storyJsonPath, JSON.stringify(story, null, 2)));

  await run('node', [binPath, 'validate', storyJsonPath, '--strict']);

  const storyHtmlPath = path.join(workdir, 'story.html');
  await run('node', [binPath, 'render', storyJsonPath, '-o', storyHtmlPath]);
  const html = await readFile(storyHtmlPath, 'utf8');

  assert.match(html, /Added a title prop to Panel\./);
  assert.match(html, /src\/Panel\.tsx/);
  assert.match(html, /README\.md/);
  // hunk count in the page matches the IR: 1 Edit hunk + 1 synthesized create hunk,
  // each rendered once per lens (review, diff, story) = 2 * 3 = 6 <table class="hunk"> occurrences
  const hunkTableMatches = html.match(/<table class="hunk">/g) || [];
  assert.equal(hunkTableMatches.length, 6);
});
