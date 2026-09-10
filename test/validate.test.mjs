import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStory } from '../src/ir/validate.mjs';

function minimalStory(overrides = {}) {
  return {
    schema_version: 1,
    session: { id: 's1', cwd: '/proj', started_at: null, ended_at: null, duration_ms: 0, summary: '' },
    turns: [
      { index: 1, id: 'u1', at: null, prompt: 'do a thing', summary: '', edits: [] },
    ],
    files: [],
    totals: { turns: 1, files: 0, added: 0, removed: 0, edits: 0 },
    ...overrides,
  };
}

test('accepts a structurally valid story in non-strict mode even with empty summaries', () => {
  const result = validateStory(minimalStory());
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('reports a clear error when a required top-level field is missing', () => {
  const story = minimalStory();
  delete story.turns;

  const result = validateStory(story);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /turns/.test(e)));
});

test('reports a clear error when an edit is missing a required field', () => {
  const story = minimalStory();
  story.turns[0].edits.push({ id: 'e1', tool: 'Edit', file: '/proj/a.ts' /* missing rel, hunks, stats */ });

  const result = validateStory(story);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /turns\[0\]\.edits\[0\]/.test(e)));
});

test('strict mode requires the session summary and every turn summary to be non-empty', () => {
  const result = validateStory(minimalStory(), { strict: true });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /session\.summary/.test(e)));
  assert.ok(result.errors.some((e) => /turns\[0\]\.summary/.test(e)));
});

test('strict mode passes once every summary is filled in', () => {
  const story = minimalStory();
  story.session.summary = 'Refactored the Panel component.';
  story.turns[0].summary = 'Added a title prop.';

  const result = validateStory(story, { strict: true });

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});
