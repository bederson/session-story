/**
 * Adapter: Claude Code transcript records -> Story IR.
 * See docs/superpowers/specs/2026-09-10-session-story-design.md for the
 * record shapes this relies on and the IR shape it produces.
 */

import path from 'node:path';
import { crossIndexFiles } from '../ir/cross-index.mjs';

const NOISE_PATTERN = /^<(local-command-caveat|command-name|local-command-stdout|local-command-stderr)>/;
const FILE_EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);
const AGENT_TOOL = 'Agent';

function isRealUserPrompt(record) {
  if (record.type !== 'user') return false;
  const content = record.message && record.message.content;
  if (typeof content !== 'string') return false;
  return !NOISE_PATTERN.test(content.trim());
}

function toolUseCalls(record) {
  if (record.type !== 'assistant') return [];
  const content = record.message && record.message.content;
  if (!Array.isArray(content)) return [];
  return content.filter((block) => block.type === 'tool_use' && FILE_EDIT_TOOLS.has(block.name));
}

function agentToolUseCalls(record) {
  if (record.type !== 'assistant') return [];
  const content = record.message && record.message.content;
  if (!Array.isArray(content)) return [];
  return content.filter((block) => block.type === 'tool_use' && block.name === AGENT_TOOL);
}

/**
 * Extract file edits from a subagent's own flat record stream (no turns:
 * a subagent's records form one sequence, all attributed to the turn that
 * spawned it).
 */
function extractSubagentEdits(subRecords, cwd, agentId) {
  const edits = [];
  const pending = new Map();

  for (const record of subRecords) {
    const calls = toolUseCalls(record);
    for (const call of calls) {
      const edit = {
        id: call.id,
        tool: call.name,
        file: call.input.file_path,
        rel: relativePath(call.input.file_path, cwd),
        kind: null,
        by_subagent: agentId,
        result: 'unknown',
        hunks: [],
        stats: { added: 0, removed: 0 },
      };
      edits.push(edit);
      pending.set(call.id, edit);
    }

    const toolResult = toolResultFor(record);
    if (toolResult && pending.has(toolResult.toolUseId)) {
      const edit = pending.get(toolResult.toolUseId);
      const r = toolResult.result || {};
      edit.kind = r.type || null;
      const hunks = r.type === 'create'
        ? synthesizeCreateHunk(r.content || '')
        : (r.structuredPatch || []);
      edit.result = 'ok';
      edit.hunks = hunks;
      edit.stats = hunkStats(hunks);
      pending.delete(toolResult.toolUseId);
    }
  }

  return edits;
}

function toolResultFor(record) {
  if (record.type !== 'user') return null;
  const content = record.message && record.message.content;
  if (!Array.isArray(content)) return null;
  const resultBlock = content.find((block) => block.type === 'tool_result');
  if (!resultBlock) return null;
  return { toolUseId: resultBlock.tool_use_id, result: record.toolUseResult };
}

function synthesizeCreateHunk(content) {
  const lines = content.replace(/\n$/, '').split('\n');
  if (lines.length === 1 && lines[0] === '') return [];
  return [{
    oldStart: 0,
    oldLines: 0,
    newStart: 1,
    newLines: lines.length,
    lines: lines.map((l) => `+${l}`),
  }];
}

function hunkStats(hunks) {
  let added = 0;
  let removed = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) added++;
      else if (line.startsWith('-')) removed++;
    }
  }
  return { added, removed };
}

function relativePath(filePath, cwd) {
  if (!cwd || !filePath) return filePath;
  return path.relative(cwd, filePath) || filePath;
}

export function buildStory(records, { sessionId, cwd, subagents } = {}) {
  const turns = [];
  // toolUseId -> { edit, turn } for edits whose result hasn't arrived yet
  const pending = new Map();
  const pendingAgents = new Map(); // agent tool_use id -> spawning turn
  let currentTurn = null;

  for (const record of records) {
    if (isRealUserPrompt(record)) {
      currentTurn = {
        index: turns.length + 1,
        id: record.uuid,
        at: record.timestamp,
        prompt: record.message.content,
        summary: '',
        edits: [],
      };
      turns.push(currentTurn);
      continue;
    }

    const agentCalls = agentToolUseCalls(record);
    if (agentCalls.length > 0 && currentTurn) {
      for (const call of agentCalls) {
        pendingAgents.set(call.id, currentTurn);
      }
    }

    const calls = toolUseCalls(record);
    if (calls.length > 0 && currentTurn) {
      for (const call of calls) {
        const edit = {
          id: call.id,
          tool: call.name,
          file: call.input.file_path,
          rel: relativePath(call.input.file_path, cwd),
          kind: null,
          result: 'unknown',
          hunks: [],
          stats: { added: 0, removed: 0 },
        };
        currentTurn.edits.push(edit);
        pending.set(call.id, edit);
      }
      continue;
    }

    const toolResult = toolResultFor(record);
    if (toolResult && pendingAgents.has(toolResult.toolUseId)) {
      const spawningTurn = pendingAgents.get(toolResult.toolUseId);
      const r = toolResult.result || {};
      const agentId = r.agentId;
      const subRecords = (subagents && subagents[agentId]) || [];
      const subEdits = extractSubagentEdits(subRecords, cwd, agentId);
      spawningTurn.edits.push(...subEdits);
      pendingAgents.delete(toolResult.toolUseId);
    }

    if (toolResult && pending.has(toolResult.toolUseId)) {
      const edit = pending.get(toolResult.toolUseId);
      const r = toolResult.result || {};
      edit.kind = r.type || null;
      const hunks = r.type === 'create'
        ? synthesizeCreateHunk(r.content || '')
        : (r.structuredPatch || []);
      edit.result = 'ok';
      edit.hunks = hunks;
      edit.stats = hunkStats(hunks);
      pending.delete(toolResult.toolUseId);
    }
  }

  const startedAt = turns.length > 0 ? turns[0].at : null;
  const endedAt = turns.length > 0 ? turns[turns.length - 1].at : null;
  const durationMs = startedAt && endedAt
    ? new Date(endedAt).getTime() - new Date(startedAt).getTime()
    : 0;

  const allEdits = turns.flatMap((t) => t.edits);
  const files = new Set(allEdits.map((e) => e.rel));
  const totals = allEdits.reduce(
    (acc, e) => ({
      turns: turns.length,
      files: files.size,
      added: acc.added + e.stats.added,
      removed: acc.removed + e.stats.removed,
      edits: acc.edits + 1,
    }),
    { turns: turns.length, files: files.size, added: 0, removed: 0, edits: 0 }
  );

  return {
    schema_version: 1,
    session: {
      id: sessionId,
      cwd,
      started_at: startedAt,
      ended_at: endedAt,
      duration_ms: durationMs,
    },
    turns,
    files: crossIndexFiles(turns),
    totals,
  };
}
