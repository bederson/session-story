import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPage } from '../src/render/template.mjs';
import { richStory, longStory } from './fixtures/story-fixture.mjs';

// Capability checklist: each existing user-visible feature of the story page
// maps to one preservation assertion, so the redesign cannot silently drop it.

const html = renderPage(richStory(), { library: { indexHref: 'index.html', manifestHref: 'sessions.js' } });
const markup = html.replace(/<script[^>]*>[^]*?<\/script>/g, '');

test('capability: five views and their tabs exist, Trace only with trace data', () => {
  for (const v of ['review', 'diff', 'story', 'report', 'trace']) assert.match(html, new RegExp(`id="lens-${v}"`));
  assert.doesNotMatch(renderPage(Object.assign(richStory(), { trace: undefined })), /id="lens-trace"/);
});

test('capability: session context is shown (title, cwd, branch, outcome, blind spots)', () => {
  assert.match(markup, /Rich fixture session/);
  assert.match(markup, /\/proj/);
  assert.match(markup, /outcome-partial/);
  assert.match(markup, /One change was made by a shell command\./);
});

test('capability: scope and full-file toggles persist through their storage keys', () => {
  assert.match(html, /session-story-scope/);
  assert.match(html, /session-story-view/);
  assert.match(html, /session-story-theme/);
});

test('capability: code is carried as data, not rendered tables', () => {
  assert.match(html, /id="story-data"/);
  assert.doesNotMatch(markup, /<table class="hunk/);
});

test('capability: outside-project edits are marked so the scope filter can hide them', () => {
  assert.match(markup, /data-outside="1"/);
});

test('capability: failed and empty edits explain themselves', () => {
  assert.match(html, /Edit failed: old string not found/);
  assert.match(html, /No file edits in this turn\./);
});

test('capability: Review has prompt copy, earlier replies disclosure and file filters', () => {
  assert.match(html, /class="copy-btn"/);
  assert.match(html, /earlier message/);
  assert.match(html, /data-file-filter=""/);
});

test('capability: Diff has name filter and clickable turn tags', () => {
  assert.match(html, /placeholder="Filter files"/);
  assert.match(html, /data-jump-turn="1"/);
});

test('capability: Report shows validation, errors with resolution, and long commands truncated', () => {
  assert.match(markup, /Tests &amp; validation|Tests & validation/);
  assert.match(markup, /Fixed in turn 2\./);
  assert.match(markup, /more characters/);
});

test('capability: Trace has filters, failures-only and jumps into Review', () => {
  assert.match(html, /data-trace-filter="error"/);
  assert.match(html, /class="trace-failures"/);
  assert.match(html, /class="trace-jump"/);
});

test('capability: keyboard shortcuts j/k and bracket view switching are wired', () => {
  assert.match(html, /e\.key === 'j'/);
  assert.match(html, /e\.key === '\['/);
});

test('capability: library chrome is present only with a library, and never loads from the network', () => {
  assert.match(html, /class="lib-nav" hidden/);
  assert.doesNotMatch(renderPage(richStory()), /class="lib-nav"/);
  assert.doesNotMatch(html, /(src|href)="(https?:)?\/\//);
});

test('capability: print hydrates every view', () => {
  assert.match(html, /addEventListener\('beforeprint', renderAll\)/);
});

test('baseline: a 60-turn story renders without hunk tables in markup and stays within a size bound', () => {
  const page = renderPage(longStory(60));
  const live = page.replace(/<script[^>]*>[^]*?<\/script>/g, '');
  assert.doesNotMatch(live, /<table class="hunk/);
  assert.ok(page.length < 2_000_000, `page was ${page.length} bytes`);
  // Record the baseline for later phases (bytes), visible in test output.
  console.log(`# baseline long-story bytes: ${page.length}`);
});
