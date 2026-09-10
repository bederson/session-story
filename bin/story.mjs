#!/usr/bin/env node
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { parseTranscript } from '../src/transcript/parse.mjs';
import { locateSession, locateSubagents, defaultClaudeDir } from '../src/transcript/locate.mjs';
import { buildStory } from '../src/transcript/claude-code.mjs';
import { validateStory } from '../src/ir/validate.mjs';
import { renderPage } from '../src/render/template.mjs';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { _: [] };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        opts[key] = next;
        i++;
      } else {
        opts[key] = true;
      }
    } else if (arg === '-o') {
      opts.output = rest[i + 1];
      i++;
    } else {
      opts._.push(arg);
    }
  }
  return { command, opts };
}

function briefProjection(story) {
  return {
    session: { id: story.session.id, cwd: story.session.cwd, summary: story.session.summary },
    turns: story.turns.map((t) => ({
      index: t.index,
      prompt: t.prompt,
      edits: t.edits.map((e) => ({ rel: e.rel, kind: e.kind, stats: e.stats })),
    })),
  };
}

async function cmdExtract(opts) {
  const cwd = opts.cwd || process.cwd();
  const claudeDir = opts['claude-dir'] || defaultClaudeDir();
  const located = await locateSession({
    claudeDir,
    cwd,
    sessionId: typeof opts.session === 'string' ? opts.session : undefined,
    latest: opts.latest === true || opts.session === undefined,
  });

  const { records, warnings } = await parseTranscript(located.transcriptPath);
  for (const w of warnings) process.stderr.write(`warning: ${w}\n`);

  const subagentPaths = await locateSubagents({ claudeDir, cwd, sessionId: located.sessionId });
  const subagents = {};
  for (const [agentId, filePath] of Object.entries(subagentPaths)) {
    const parsed = await parseTranscript(filePath);
    subagents[agentId] = parsed.records;
  }

  const story = buildStory(records, { sessionId: located.sessionId, cwd, subagents });
  story.generator = { name: 'metafyl-story', version: '0.1.0' };
  story.session.blind_spots = ['Changes made by shell commands (Bash) are not tracked, only Edit/Write/NotebookEdit tool calls.'];
  story.session.title = null;

  const outPath = opts.output || 'story.json';
  await writeFile(outPath, JSON.stringify(story, null, 2));
  process.stderr.write(`Wrote ${outPath} (${story.turns.length} turns, ${story.files.length} files)\n`);

  if (opts.brief) {
    process.stdout.write(JSON.stringify(briefProjection(story), null, 2) + '\n');
  }
}

async function cmdValidate(opts) {
  const file = opts._[0];
  if (!file) {
    process.stderr.write('usage: story.mjs validate <story.json> [--strict]\n');
    process.exitCode = 1;
    return;
  }
  const story = JSON.parse(await readFile(file, 'utf8'));
  const result = validateStory(story, { strict: opts.strict === true });
  if (result.valid) {
    process.stdout.write('valid\n');
  } else {
    process.stderr.write('invalid:\n');
    for (const err of result.errors) process.stderr.write(`  - ${err}\n`);
    process.exitCode = 1;
  }
}

async function cmdRender(opts) {
  const file = opts._[0];
  if (!file) {
    process.stderr.write('usage: story.mjs render <story.json> [-o out.html] [--open]\n');
    process.exitCode = 1;
    return;
  }
  const story = JSON.parse(await readFile(file, 'utf8'));
  const html = renderPage(story);
  const outPath = opts.output || 'story.html';
  await mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
  await writeFile(outPath, html);
  process.stderr.write(`Wrote ${outPath}\n`);

  if (opts.open) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    exec(`${opener} "${path.resolve(outPath)}"`);
  }
}

async function main() {
  const { command, opts } = parseArgs(process.argv.slice(2));
  switch (command) {
    case 'extract':
      await cmdExtract(opts);
      break;
    case 'validate':
      await cmdValidate(opts);
      break;
    case 'render':
      await cmdRender(opts);
      break;
    default:
      process.stderr.write('usage: story.mjs <extract|validate|render> [options]\n');
      process.exitCode = 1;
  }
}

main().catch((err) => {
  process.stderr.write(`error: ${err.message}\n`);
  process.exitCode = 1;
});
