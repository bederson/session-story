/**
 * Trace events: the normalized, chronological record of what a session did
 * (prompts, tool calls, subagents) with timing, status and provenance.
 * Pure helpers only. The Claude Code adapter (src/transcript/claude-code.mjs)
 * builds events while it walks the records; src/ir/metrics.mjs counts them.
 *
 * A tool event's duration_ms is the tool_result record's timestamp minus the
 * tool_use record's: it includes permission prompts and hook time, so it is a
 * latency, not the tool's own runtime.
 */

import path from 'node:path';
import { isRejection } from './commands.mjs';

export const EVENT_KINDS = ['prompt', 'tool', 'subagent'];
export const EVENT_STATUSES = ['ok', 'error', 'rejected', 'interrupted', 'unknown'];
export const DURATION_SOURCES = ['transcript', 'derived', 'unknown'];
const SUMMARY_MAX = 200;
const FILE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'Read']);

/** Positive difference in ms between two ISO timestamps, or null if either is missing/unparseable. */
export function msBetween(startIso, endIso) {
  if (typeof startIso !== 'string' || typeof endIso !== 'string') return null;
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

export function newEvent({
  id, kind, turn, parentId = null, tool = null, category = null, summary = '', startedAt = null, agentId = null,
}) {
  const event = {
    id,
    kind,
    turn,
    parent_id: parentId,
    tool,
    category,
    status: kind === 'prompt' ? 'ok' : 'unknown',
    summary,
    started_at: startedAt,
    ended_at: null,
    duration_ms: null,
    source: 'transcript',
  };
  if (agentId) event.agent_id = agentId;
  return event;
}

export function finishEvent(event, endedAt, status) {
  event.ended_at = typeof endedAt === 'string' ? endedAt : null;
  event.duration_ms = msBetween(event.started_at, event.ended_at);
  event.status = status;
  return event;
}

/** rejected > interrupted > error > ok, from a tool_result's is_error flag and toolUseResult. */
export function resultStatus(isError, toolUseResult) {
  if (isRejection(toolUseResult)) return 'rejected';
  if (toolUseResult && typeof toolUseResult === 'object' && toolUseResult.interrupted) return 'interrupted';
  return isError ? 'error' : 'ok';
}

function firstLine(text) {
  const line = String(text || '').split('\n')[0].trim();
  return line.length > SUMMARY_MAX ? line.slice(0, SUMMARY_MAX) : line;
}

function rel(filePath, cwd) {
  if (!filePath) return '';
  if (!cwd) return filePath;
  return path.relative(cwd, filePath) || filePath;
}

/** One short line naming what a tool call acted on; '' when the input says nothing useful. */
export function eventSummary(name, input, cwd) {
  const i = input || {};
  if (name === 'Bash') return firstLine(i.command);
  if (FILE_TOOLS.has(name)) return firstLine(rel(i.file_path || i.notebook_path, cwd));
  if (name === 'Glob' || name === 'Grep') return firstLine(i.path ? `${i.pattern} in ${rel(i.path, cwd)}` : i.pattern);
  if (name === 'Agent') return firstLine(i.description);
  if (name === 'WebFetch' || name === 'WebSearch') return firstLine(i.url || i.query);
  return firstLine(i.description || '');
}

/**
 * How long a turn took. The harness writes `system/turn_duration` records
 * (summed per turn by the adapter); without them, wall clock from the prompt
 * to the last finished event; without that, unknown — never 0.
 */
export function turnDuration({ harnessMs, promptAt, lastEndedAt }) {
  if (Number.isFinite(harnessMs) && harnessMs > 0) return { duration_ms: harnessMs, duration_source: 'transcript' };
  const ms = msBetween(promptAt, lastEndedAt);
  if (ms === null) return { duration_ms: null, duration_source: 'unknown' };
  return { duration_ms: ms, duration_source: 'derived' };
}

/** Stable sort by started_at; an event with no timestamp keeps its place after the last dated one. */
export function sortEvents(events) {
  let lastT = -Infinity;
  const keyed = events.map((event, i) => {
    const t = Date.parse(event.started_at);
    if (Number.isFinite(t)) lastT = t;
    return { event, i, t: lastT };
  });
  keyed.sort((a, b) => (a.t - b.t) || (a.i - b.i));
  return keyed.map((k) => k.event);
}
