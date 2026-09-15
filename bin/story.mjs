#!/usr/bin/env node
import { writeFile, readFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { parseTranscript } from '../src/transcript/parse.mjs';
import { locateSession, locateSubagents, locateChain, defaultClaudeDir } from '../src/transcript/locate.mjs';
import { buildStory, refreshDerived } from '../src/transcript/claude-code.mjs';
import { fillBashEditsFromGit } from '../src/ir/git-edits.mjs';
import { fillBasesFromDisk } from '../src/ir/disk-base.mjs';
import { buildDependencies } from '../src/ir/dependencies.mjs';
import { fillGitState } from '../src/ir/git-state.mjs';
import { validateStory } from '../src/ir/validate.mjs';
import { renderPage } from '../src/render/template.mjs';
import {
  storyFileName, libraryEntry, upsertEntry, renderSessionsJs, renderIndexPage,
  LIBRARY_DIR, MANIFEST_FILE, SESSIONS_FILE, INDEX_FILE,
} from '../src/render/library.mjs';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { _: [] };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg.startsWith('--no-')) {
      // A negated flag never takes a value, so it must not eat the next arg.
      opts[arg.slice(5)] = false;
    } else if (arg.startsWith('--')) {
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

/**
 * A rough signal for `report.outcome`, from the last test/lint/build
 * command's exit status: Claude reads this alongside the brief and writes
 * the actual field, this is not written to story.json itself.
 */
function outcomeHints(story) {
  const validation = story.turns.flatMap((t) => (t.bash || []).filter((b) => ['test', 'lint', 'build'].includes(b.category)));
  const last = validation[validation.length - 1];
  const outcome = !last || last.ok === null ? null : last.ok ? 'completed' : 'partial';
  const failed_validations = validation
    .filter((b) => b.ok === false)
    .map((b) => ({ command: b.command, output_excerpt: (b.output_tail || '').slice(-600) }));
  return { outcome, failed_validations };
}

function briefProjection(story) {
  return {
    session: {
      id: story.session.id,
      cwd: story.session.cwd,
      chain: story.session.chain,
      summary: story.session.summary,
    },
    report: {
      git: story.report.git,
      dependencies: story.report.dependencies,
    },
    hints: outcomeHints(story),
    turns: story.turns.map((t) => ({
      index: t.index,
      prompt: t.prompt,
      edits: t.edits.map((e) => ({ rel: e.rel, kind: e.kind, stats: e.stats })),
      commands: (t.bash || []).map((b) => ({ command: b.command, category: b.category, ok: b.ok, exit_code: b.exit_code })),
      errors: (t.errors || []).map((e) => ({ tool: e.tool, target: e.target, message: e.message })),
      plan: t.plan ? { approved: t.plan.approved, excerpt: t.plan.text.slice(0, 1500) } : null,
    })),
  };
}

/**
 * What this story cannot see, stated plainly on the page. Shell-driven
 * changes come from git rather than the transcript, so their limits differ
 * from the Edit/Write ones and are worth naming.
 */
function blindSpots({ ranShell, recovered, commits = 0, chain = [] }) {
  const spots = [];
  if (chain.length > 1) {
    const earlier = chain.slice(0, -1);
    spots.push(
      `Includes ${earlier.length} earlier session${earlier.length === 1 ? '' : 's'} joined across ` +
      `/clear (${earlier.map((id) => id.slice(0, 8)).join(', ')}): /clear starts a new transcript, ` +
      'so the work before it would otherwise be missing.'
    );
  }
  if (recovered > 0) {
    const base = commits > 0
      ? `git (the commit the session started from, through ${commits} commit${commits === 1 ? '' : 's'} ` +
        'made during it, to the working tree)'
      : 'git (working tree vs HEAD)';
    spots.push(
      `Changes made by shell commands were reconstructed from ${base}, ` +
      'not from the transcript: they may include edits made outside this session.'
    );
  } else if (ranShell) {
    spots.push(
      'This session ran shell commands, which carry no diff in the transcript. Git reported no ' +
      'matching changes since the session started, so any files they changed are not shown.'
    );
  }
  return spots;
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

  // `/clear` starts a new transcript rather than continuing the session, so
  // the work before it lives in another file. Read the whole chain unless
  // asked not to (see src/transcript/locate.mjs).
  const chain = opts.chain === false
    ? [{ sessionId: located.sessionId, transcriptPath: located.transcriptPath }]
    : await locateChain({
      claudeDir,
      cwd,
      sessionId: located.sessionId,
      transcriptPath: located.transcriptPath,
    });

  const records = [];
  const subagents = {};
  for (const link of chain) {
    const parsed = await parseTranscript(link.transcriptPath);
    for (const w of parsed.warnings) process.stderr.write(`warning: ${link.sessionId}: ${w}\n`);
    records.push(...parsed.records);

    const subagentPaths = await locateSubagents({ claudeDir, cwd, sessionId: link.sessionId });
    for (const [agentId, filePath] of Object.entries(subagentPaths)) {
      const sub = await parseTranscript(filePath);
      subagents[agentId] = sub.records;
    }
  }

  const story = buildStory(records, { sessionId: located.sessionId, cwd, subagents });
  story.session.chain = chain.map((link) => link.sessionId);
  // Bash carries no diff in the transcript; git does. Recover those changes
  // and re-derive the counts around them (see src/ir/git-edits.mjs).
  const ranShell = story.turns.some((t) => (t.bash || []).length > 0);
  const recovered = opts.git === false ? 0 : fillBashEditsFromGit(story);
  if (recovered > 0) refreshDerived(story);
  // Files the transcript never snapshotted can often still be read from
  // disk; only verified reversals are kept (see src/ir/disk-base.mjs).
  fillBasesFromDisk(story);
  story.report.dependencies = buildDependencies(story);
  if (opts.git !== false) fillGitState(story);
  story.generator = { name: 'metafyl-story', version: '0.1.0' };
  const gitCommits = (story.report.git && story.report.git.commits) || [];
  story.session.blind_spots = blindSpots({
    ranShell,
    recovered,
    commits: gitCommits.length,
    chain: story.session.chain,
  });
  story.session.title = null;

  const outPath = opts.output || 'story.json';
  await writeFile(outPath, JSON.stringify(story, null, 2));
  const joined = chain.length > 1 ? `, ${chain.length} sessions joined across /clear` : '';
  process.stderr.write(`Wrote ${outPath} (${story.turns.length} turns, ${story.files.length} files${joined})\n`);

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

/**
 * Where this render goes. A story is one self-contained page either way;
 * the library just keeps every session instead of overwriting last one.
 * `-o` still means "that exact file, on its own", so existing scripts and
 * one-off renders behave as they always did.
 */
function renderTarget(story, opts) {
  if (opts.library === false) return { mode: 'single', outPath: opts.output || 'story.html' };
  if (typeof opts.library === 'string') return { mode: 'library', dir: path.resolve(opts.library) };
  if (opts.output) return { mode: 'single', outPath: opts.output };
  const base = story.session.cwd || process.cwd();
  return { mode: 'library', dir: path.resolve(base, LIBRARY_DIR) };
}

/**
 * The manifest is the library's memory. A damaged one is not fatal, but it
 * does mean the index loses the sessions it listed (their pages are still
 * on disk), so keep the broken file rather than overwriting it quietly.
 */
async function readManifest(dir) {
  const manifestPath = path.join(dir, MANIFEST_FILE);
  try {
    const parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (Array.isArray(parsed.entries)) return parsed.entries;
    throw new Error('no entries array');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    const kept = `${manifestPath}.broken`;
    await rename(manifestPath, kept).catch(() => {});
    process.stderr.write(
      `warning: ${MANIFEST_FILE} is unreadable (${err.message}); kept it as ` +
      `${path.basename(kept)} and started a new index — earlier sessions will drop off it ` +
      `until they are rendered again.\n`
    );
    return [];
  }
}

async function writeLibrary(story, dir) {
  await mkdir(dir, { recursive: true });

  const file = storyFileName(story);
  const html = renderPage(story, {
    library: { indexHref: INDEX_FILE, manifestHref: SESSIONS_FILE },
  });
  const outPath = path.join(dir, file);
  await writeFile(outPath, html);

  const entries = upsertEntry(await readManifest(dir), libraryEntry(story, { file }));
  await writeFile(
    path.join(dir, MANIFEST_FILE),
    JSON.stringify({ version: 1, cwd: story.session.cwd || '', entries }, null, 2)
  );
  await writeFile(path.join(dir, SESSIONS_FILE), renderSessionsJs(entries));
  await writeFile(path.join(dir, INDEX_FILE), renderIndexPage(entries, { cwd: story.session.cwd }));

  return { outPath, indexPath: path.join(dir, INDEX_FILE), count: entries.length };
}

async function cmdRender(opts) {
  const file = opts._[0];
  if (!file) {
    process.stderr.write('usage: story.mjs render <story.json> [-o out.html] [--library <dir>] [--no-library] [--open]\n');
    process.exitCode = 1;
    return;
  }
  const story = JSON.parse(await readFile(file, 'utf8'));
  const target = renderTarget(story, opts);

  let outPath;
  if (target.mode === 'library') {
    const written = await writeLibrary(story, target.dir);
    outPath = written.outPath;
    process.stderr.write(
      `Wrote ${outPath}\nIndex: ${written.indexPath} (${written.count} ${written.count === 1 ? 'session' : 'sessions'})\n`
    );
  } else {
    outPath = target.outPath;
    await mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
    await writeFile(outPath, renderPage(story));
    process.stderr.write(`Wrote ${outPath}\n`);
  }

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
