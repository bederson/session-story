import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/**
 * Convert an absolute cwd into the folder slug Claude Code uses under
 * ~/.claude/projects: every "/" and "." becomes "-" (verified against real
 * project folders, e.g. cwd ".../own.ai/ai-harlequins" -> "...-own-ai-ai-harlequins").
 * @param {string} cwd
 * @returns {string}
 */
export function slugify(cwd) {
  return cwd.replace(/[/.]/g, '-');
}

export function defaultClaudeDir() {
  return path.join(os.homedir(), '.claude', 'projects');
}

/**
 * Find a session transcript file.
 * @param {{claudeDir?: string, cwd: string, sessionId?: string, latest?: boolean}} opts
 * @returns {Promise<{transcriptPath: string, sessionId: string, projectSlug: string}>}
 */
export async function locateSession({ claudeDir = defaultClaudeDir(), cwd, sessionId, latest }) {
  const slug = slugify(cwd);
  const slugDir = path.join(claudeDir, slug);

  if (sessionId) {
    const transcriptPath = path.join(slugDir, `${sessionId}.jsonl`);
    await stat(transcriptPath).catch(() => {
      throw new Error(`No transcript found for session "${sessionId}" in ${slugDir}`);
    });
    return { transcriptPath, sessionId, projectSlug: slug };
  }

  let entries;
  try {
    entries = await readdir(slugDir);
  } catch {
    entries = null;
  }

  if (!entries) {
    let available = [];
    try {
      available = await readdir(claudeDir);
    } catch {
      // claudeDir itself doesn't exist; leave available empty
    }
    const list = available.length > 0 ? available.join(', ') : '(none found)';
    throw new Error(
      `No transcripts found for cwd "${cwd}" (looked in ${slugDir}). ` +
      `Available project folders: ${list}`
    );
  }

  const jsonlFiles = entries.filter((f) => f.endsWith('.jsonl'));
  if (jsonlFiles.length === 0) {
    throw new Error(`No .jsonl transcripts found in ${slugDir}`);
  }

  const withStats = await Promise.all(
    jsonlFiles.map(async (f) => {
      const p = path.join(slugDir, f);
      const s = await stat(p);
      return { file: f, path: p, mtimeMs: s.mtimeMs };
    })
  );

  withStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const chosen = withStats[0];

  return {
    transcriptPath: chosen.path,
    sessionId: chosen.file.replace(/\.jsonl$/, ''),
    projectSlug: slug,
  };
}

/**
 * Find subagent transcript files for a session:
 * <claudeDir>/<slug>/<sessionId>/subagents/agent-<agentId>.jsonl
 * @param {{claudeDir?: string, cwd: string, sessionId: string}} opts
 * @returns {Promise<Record<string, string>>} agentId -> transcript path
 */
export async function locateSubagents({ claudeDir = defaultClaudeDir(), cwd, sessionId }) {
  const slug = slugify(cwd);
  const subDir = path.join(claudeDir, slug, sessionId, 'subagents');

  let entries;
  try {
    entries = await readdir(subDir);
  } catch {
    return {};
  }

  const result = {};
  for (const entry of entries) {
    const match = entry.match(/^agent-(.+)\.jsonl$/);
    if (match) {
      result[match[1]] = path.join(subDir, entry);
    }
  }
  return result;
}
