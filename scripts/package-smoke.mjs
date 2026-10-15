#!/usr/bin/env node
/**
 * Proves the installable payload is self-contained: copies only
 * `session-story/` (what `npx skills add` installs) to a temp dir and runs
 * the full extract → validate → render flow from there on the demo session.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDemo } from './demo-session.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const payload = path.join(root, 'session-story');

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'session-story-smoke-'));
const installed = path.join(tmp, 'skills', 'session-story');
await fs.cp(payload, installed, { recursive: true });

for (const required of ['SKILL.md', 'LICENSE', 'package.json', 'bin/story.mjs', 'schemas/story.schema.json']) {
  await fs.access(path.join(installed, required));
}
for (const forbidden of ['test', 'site', 'docs', 'node_modules']) {
  if (await fs.stat(path.join(installed, forbidden)).catch(() => null)) {
    throw new Error(`payload must not ship ${forbidden}/`);
  }
}

const skill = await fs.readFile(path.join(installed, 'SKILL.md'), 'utf8');
const pkg = JSON.parse(await fs.readFile(path.join(installed, 'package.json'), 'utf8'));
const skillVersion = skill.match(/^\s+version:\s*"([^"]+)"/m)?.[1];
if (!/^name: session-story$/m.test(skill)) throw new Error('SKILL.md name must be session-story');
if (skillVersion !== pkg.version) throw new Error(`SKILL.md version ${skillVersion} != package.json ${pkg.version}`);

const marketplace = JSON.parse(await fs.readFile(path.join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
const plugin = marketplace.plugins.find((p) => p.name === 'session-story');
if (plugin?.source !== './session-story') throw new Error('marketplace.json must list session-story with source ./session-story');
if (plugin.version !== pkg.version) throw new Error(`marketplace.json version ${plugin.version} != package.json ${pkg.version}`);

const out = path.join(tmp, 'story.html');
await renderDemo({ bin: path.join(installed, 'bin', 'story.mjs'), out });
const html = await fs.readFile(out, 'utf8');
if (!html.includes('Due dates for todos')) throw new Error('rendered page is missing the demo title');
if (/<script[^>]+src="https?:/i.test(html) || /<link[^>]+href="https?:/i.test(html)) {
  throw new Error('rendered page must not load remote resources');
}

console.log(`ok — installed payload v${pkg.version} rendered ${path.basename(out)} (${(html.length / 1024).toFixed(0)} KB)`);
await fs.rm(tmp, { recursive: true, force: true });
