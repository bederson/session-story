import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPage } from '../src/render/template.mjs';

function sampleStory() {
  return {
    schema_version: 1,
    session: {
      id: 's1', cwd: '/proj', git_branch: 'main', title: 'Panel title/subtitle',
      started_at: '2026-09-10T10:00:00.000Z', ended_at: '2026-09-10T10:05:30.000Z', duration_ms: 330000,
      summary: 'Added a title and subtitle to Panel.', blind_spots: [],
    },
    turns: [{ index: 1, id: 'u1', at: null, prompt: 'Add a title prop', summary: 'Added title prop.', edits: [] }],
    files: [],
    totals: { turns: 1, files: 0, added: 0, removed: 0, edits: 0 },
  };
}

test('renderPage produces a full HTML document with a title and all three lens sections', () => {
  const html = renderPage(sampleStory());

  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<title>Panel title\/subtitle<\/title>/);
  assert.match(html, /id="lens-review"/);
  assert.match(html, /id="lens-diff"/);
  assert.match(html, /id="lens-story"/);
  assert.match(html, /<script>/);
  assert.match(html, /<style>/);
});

test('renderPage escapes a title containing HTML-significant characters', () => {
  const story = sampleStory();
  story.session.title = '<img src=x onerror=alert(1)>';

  const html = renderPage(story);

  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
});
