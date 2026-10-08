import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  storyFileName,
  libraryEntry,
  upsertEntry,
  renderSessionsJs,
  renderIndexPage,
} from '../src/render/library.mjs';

function sampleStory(overrides = {}) {
  return {
    schema_version: 1,
    session: {
      id: 'eb076ea5-5cf4-4dfa-9afd-44894bf556a6',
      cwd: '/proj',
      chain: ['eb076ea5-5cf4-4dfa-9afd-44894bf556a6'],
      started_at: '2026-09-14T10:32:00.000Z',
      ended_at: '2026-09-14T11:02:00.000Z',
      duration_ms: 1800000,
      title: null,
      summary: 'Added a session browser.',
      blind_spots: [],
    },
    turns: [{ index: 1, id: 'u1', at: null, prompt: 'Add a session browser', summary: null, edits: [] }],
    files: [],
    totals: { turns: 1, files: 2, added: 30, removed: 4, edits: 3 },
    report: { outcome: 'completed' },
    ...overrides,
  };
}

test('storyFileName combines the start date, a short session id, and a slug of the title', () => {
  assert.equal(
    storyFileName(sampleStory()),
    '2026-09-14-eb076ea5-add-a-session-browser.html'
  );
});

test('storyFileName is deterministic for the same story', () => {
  assert.equal(storyFileName(sampleStory()), storyFileName(sampleStory()));
});

test('storyFileName sanitizes slashes, spaces, punctuation and unicode out of the slug', () => {
  const story = sampleStory();
  story.session.title = 'Fix src/render/template.mjs — “quotes”, spaces & Ünicode!';
  const name = storyFileName(story);
  assert.match(name, /^2026-09-14-eb076ea5-[a-z0-9-]+\.html$/);
  assert.ok(!name.includes('/'), 'no path separators');
});

test('storyFileName trims a long title back to a word boundary', () => {
  const story = sampleStory();
  story.session.title = 'Extend session story so that it includes also the plan intent and more';
  assert.equal(
    storyFileName(story),
    '2026-09-14-eb076ea5-extend-session-story-so-that-it-includes-also-the-plan.html'
  );
});

test('storyFileName caps the slug length', () => {
  const story = sampleStory();
  story.session.title = 'a'.repeat(200);
  const slug = storyFileName(story).replace(/^2026-09-14-eb076ea5-/, '').replace(/\.html$/, '');
  assert.ok(slug.length <= 60, `slug was ${slug.length} chars`);
});

test('storyFileName falls back to today and a generic slug with no title, prompt or start time', () => {
  const story = sampleStory();
  story.turns = [];
  story.session.started_at = null;
  assert.match(storyFileName(story), /^\d{4}-\d{2}-\d{2}-eb076ea5-session-story\.html$/);
});

test('libraryEntry carries the metadata the index and switcher need', () => {
  const entry = libraryEntry(sampleStory(), { file: 'x.html' });
  assert.equal(entry.file, 'x.html');
  assert.equal(entry.id, 'eb076ea5-5cf4-4dfa-9afd-44894bf556a6');
  assert.equal(entry.title, 'Add a session browser');
  assert.equal(entry.summary, 'Added a session browser.');
  assert.equal(entry.cwd, '/proj');
  assert.equal(entry.started_at, '2026-09-14T10:32:00.000Z');
  assert.equal(entry.duration_ms, 1800000);
  assert.deepEqual(entry.totals, { turns: 1, files: 2, added: 30, removed: 4, edits: 3 });
  assert.equal(entry.outcome, 'completed');
  assert.deepEqual(entry.usage, { input_tokens: null, output_tokens: null, cost_usd: null });
  assert.deepEqual(entry.chain, ['eb076ea5-5cf4-4dfa-9afd-44894bf556a6']);
  assert.ok(entry.generated_at, 'stamped with a generation time');
});

test('libraryEntry tolerates a story with no report', () => {
  const story = sampleStory();
  delete story.report;
  assert.equal(libraryEntry(story, { file: 'x.html' }).outcome, null);
});

test('upsertEntry replaces an entry with the same session id rather than appending', () => {
  const a = { id: 's1', file: 'old.html', started_at: '2026-09-10T00:00:00.000Z' };
  const b = { id: 's2', file: 'b.html', started_at: '2026-09-12T00:00:00.000Z' };
  const a2 = { id: 's1', file: 'new.html', started_at: '2026-09-10T00:00:00.000Z' };

  const entries = upsertEntry(upsertEntry([a], b), a2);
  assert.equal(entries.length, 2);
  assert.equal(entries.find((e) => e.id === 's1').file, 'new.html');
});

test('upsertEntry sorts newest first', () => {
  const older = { id: 's1', started_at: '2026-09-10T00:00:00.000Z' };
  const newer = { id: 's2', started_at: '2026-09-12T00:00:00.000Z' };
  assert.deepEqual(upsertEntry([older], newer).map((e) => e.id), ['s2', 's1']);
});

test('upsertEntry puts the most recently active session first, by when it ended', () => {
  // A session joined across /clear starts early but ends last; it belongs on top.
  const chained = { id: 's1', started_at: '2026-10-08T07:41:00.000Z', ended_at: '2026-10-08T12:55:00.000Z' };
  const later = { id: 's2', started_at: '2026-10-08T09:00:00.000Z', ended_at: '2026-10-08T09:40:00.000Z' };
  assert.deepEqual(upsertEntry([chained], later).map((e) => e.id), ['s1', 's2']);
});

test('upsertEntry falls back to the start time for an entry without an end time', () => {
  const noEnd = { id: 's1', started_at: '2026-10-08T11:00:00.000Z', ended_at: null };
  const ended = { id: 's2', started_at: '2026-10-08T09:00:00.000Z', ended_at: '2026-10-08T10:00:00.000Z' };
  assert.deepEqual(upsertEntry([ended], noEnd).map((e) => e.id), ['s1', 's2']);
});

test('upsertEntry does not mutate the array it is given', () => {
  const entries = [{ id: 's1', started_at: '2026-09-10T00:00:00.000Z' }];
  upsertEntry(entries, { id: 's2', started_at: '2026-09-12T00:00:00.000Z' });
  assert.equal(entries.length, 1);
});

test('renderSessionsJs assigns a global array that parses back out', () => {
  const js = renderSessionsJs([libraryEntry(sampleStory(), { file: 'x.html' })]);
  assert.match(js, /window\.SESSION_STORY_LIBRARY\s*=/);
  const json = js.slice(js.indexOf('=') + 1).trim().replace(/;\s*$/, '');
  const parsed = JSON.parse(json);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].file, 'x.html');
  assert.equal(parsed[0].id, 'eb076ea5-5cf4-4dfa-9afd-44894bf556a6');
  assert.equal(parsed[0].title, 'Add a session browser');
});

test('renderSessionsJs cannot break out of the script element', () => {
  const entry = libraryEntry(sampleStory(), { file: 'x.html' });
  entry.title = 'oops </script><script>alert(1)</script>';
  assert.ok(!renderSessionsJs([entry]).includes('</script>'));
});

test('renderIndexPage renders a card per session, linking to its file', () => {
  const entries = [
    libraryEntry(sampleStory(), { file: 'a.html' }),
    libraryEntry(sampleStory({ session: { ...sampleStory().session, id: 's2' } }), { file: 'b.html' }),
  ];
  const html = renderIndexPage(entries, { cwd: '/proj' });

  assert.match(html, /<!doctype html>/i);
  assert.match(html, /href="a\.html"/);
  assert.match(html, /href="b\.html"/);
  assert.equal(html.match(/class="session-card"/g).length, 2);
  assert.match(html, /\/proj/);
});

test('renderIndexPage escapes session titles and summaries', () => {
  const entry = libraryEntry(sampleStory(), { file: 'a.html' });
  entry.title = '<script>alert(1)</script>';
  const html = renderIndexPage([entry], { cwd: '/proj' });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;/);
});

test('renderIndexPage handles an empty library', () => {
  const html = renderIndexPage([], { cwd: '/proj' });
  assert.match(html, /<!doctype html>/i);
  assert.doesNotMatch(html, /class="session-card"/);
});

test('renderIndexPage shows each session start and end date and time', () => {
  const html = renderIndexPage([libraryEntry(sampleStory(), { file: 'a.html' })], { cwd: '/proj' });
  assert.match(html, /<time datetime="2026-09-14T11:02:00\.000Z">2026-09-14 11:02 UTC<\/time>/);
});

test('libraryEntry records token usage and cost from the story metrics', () => {
  const story = sampleStory();
  story.metrics = { usage: { input_tokens: 100, cache_read_tokens: 900, cache_creation_tokens: 0, output_tokens: 50, total_cost_usd: 1.5 } };
  assert.deepEqual(libraryEntry(story, { file: 'x.html' }).usage, { input_tokens: 1000, output_tokens: 50, cost_usd: 1.5 });
});

test('renderIndexPage shows usage on each card and in the rollup, and notes partial cost', () => {
  const withUsage = libraryEntry(sampleStory(), { file: 'a.html' });
  withUsage.usage = { input_tokens: 178717, output_tokens: 860, cost_usd: 4.2226 };
  const older = libraryEntry(sampleStory({ session: { ...sampleStory().session, id: 's2' } }), { file: 'b.html' });
  delete older.usage; // a manifest entry written before usage was recorded
  const html = renderIndexPage([withUsage, older], { cwd: '/proj' });

  assert.match(html, /178\.7k in · 860 out/);
  assert.match(html, /data-input="178717" data-output="860" data-cost="4\.2226"/);
  assert.match(html, /data-input="" data-output="" data-cost=""/);
  assert.match(html, /data-roll="cost">\$4\.22</);
  assert.match(html, /data-roll-part="cost-note">/); // shown: cost known for 1 of 2
  assert.match(html, /for 1 of 2/);
});

test('renderIndexPage hides usage rollup parts when no session recorded usage', () => {
  const html = renderIndexPage([libraryEntry(sampleStory(), { file: 'a.html' })], { cwd: '/proj' });
  assert.match(html, /data-roll-part="input" hidden/);
  assert.match(html, /data-roll-part="cost" hidden/);
});

test('renderIndexPage offers time period filters, hidden until the script runs, defaulting to all time', () => {
  const html = renderIndexPage([libraryEntry(sampleStory(), { file: 'a.html' })], { cwd: '/proj' });
  assert.match(html, /class="lib-periods" role="group" aria-label="Time period" hidden/);
  for (const key of ['today', '7d', '30d', 'month', 'last-month', 'all']) {
    assert.match(html, new RegExp(`data-period="${key}"`));
  }
  assert.match(html, /data-period="all" aria-pressed="true">All time</);
  assert.match(html, /data-active="2026-09-14T11:02:00\.000Z"/);
});

test('renderIndexPage renders no period filter for an empty library', () => {
  assert.doesNotMatch(renderIndexPage([], { cwd: '/proj' }), /lib-periods" role/);
});
