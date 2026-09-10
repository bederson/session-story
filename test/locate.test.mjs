import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { slugify, locateSession } from '../src/transcript/locate.mjs';

test('slugify turns an absolute cwd into the ~/.claude/projects folder slug', () => {
  assert.equal(slugify('/Users/nalaj/Development/AI/metafyl'), '-Users-nalaj-Development-AI-metafyl');
});

test('slugify also replaces dots, matching Claude Code’s real project folder naming', () => {
  // Verified against a real ~/.claude/projects folder: cwd "/Users/nalaj/Projects/own.ai/ai-harlequins"
  // is stored as "-Users-nalaj-Projects-own-ai-ai-harlequins" -- the "." in "own.ai" becomes "-" too.
  assert.equal(
    slugify('/Users/nalaj/Projects/own.ai/ai-harlequins'),
    '-Users-nalaj-Projects-own-ai-ai-harlequins'
  );
});

async function makeClaudeDir() {
  const root = await mkdtemp(path.join(tmpdir(), 'claude-test-'));
  return path.join(root, 'projects');
}

test('locateSession with --latest returns the most recently modified transcript for the cwd', async () => {
  const claudeDir = await makeClaudeDir();
  const cwd = '/proj';
  const slugDir = path.join(claudeDir, slugify(cwd));
  await mkdir(slugDir, { recursive: true });
  const older = path.join(slugDir, 'session-a.jsonl');
  const newer = path.join(slugDir, 'session-b.jsonl');
  await writeFile(older, '{}\n');
  await writeFile(newer, '{}\n');
  const now = new Date();
  await utimes(older, now, new Date(now.getTime() - 60000));
  await utimes(newer, now, now);

  const result = await locateSession({ claudeDir, cwd, latest: true });

  assert.equal(result.transcriptPath, newer);
  assert.equal(result.sessionId, 'session-b');
});

test('locateSession with a specific sessionId returns that file directly', async () => {
  const claudeDir = await makeClaudeDir();
  const cwd = '/proj';
  const slugDir = path.join(claudeDir, slugify(cwd));
  await mkdir(slugDir, { recursive: true });
  await writeFile(path.join(slugDir, 'abc-123.jsonl'), '{}\n');

  const result = await locateSession({ claudeDir, cwd, sessionId: 'abc-123' });

  assert.equal(result.transcriptPath, path.join(slugDir, 'abc-123.jsonl'));
});

test('locateSession throws a clear error listing available project slugs when the cwd has none', async () => {
  const claudeDir = await makeClaudeDir();
  await mkdir(path.join(claudeDir, '-Users-nalaj-other-project'), { recursive: true });

  await assert.rejects(
    () => locateSession({ claudeDir, cwd: '/no/such/project', latest: true }),
    (err) => {
      assert.match(err.message, /-Users-nalaj-other-project/);
      return true;
    }
  );
});

test('locateSubagents returns a map of agentId -> transcript path for a session', async () => {
  const claudeDir = await makeClaudeDir();
  const cwd = '/proj';
  const slugDir = path.join(claudeDir, slugify(cwd));
  const subDir = path.join(slugDir, 'sess-1', 'subagents');
  await mkdir(subDir, { recursive: true });
  await writeFile(path.join(subDir, 'agent-ad8ff631be07e1ecc.jsonl'), '{}\n');
  await writeFile(path.join(subDir, 'agent-a857f2cbeaf39bf9e.jsonl'), '{}\n');

  const { locateSubagents } = await import('../src/transcript/locate.mjs');
  const result = await locateSubagents({ claudeDir, cwd, sessionId: 'sess-1' });

  assert.deepEqual(Object.keys(result).sort(), ['a857f2cbeaf39bf9e', 'ad8ff631be07e1ecc']);
  assert.equal(result['ad8ff631be07e1ecc'], path.join(subDir, 'agent-ad8ff631be07e1ecc.jsonl'));
});

test('locateSubagents returns an empty map when the session has no subagents folder', async () => {
  const claudeDir = await makeClaudeDir();
  const cwd = '/proj';
  await mkdir(path.join(claudeDir, slugify(cwd)), { recursive: true });

  const { locateSubagents } = await import('../src/transcript/locate.mjs');
  const result = await locateSubagents({ claudeDir, cwd, sessionId: 'sess-1' });

  assert.deepEqual(result, {});
});
