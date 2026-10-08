# Transcript record audit for agent observability (Phase 1)

Verified against Claude Code 2.1.288–2.1.292 on 2026-10-08, from transcripts
under `~/.claude/projects/-Users-nalaj-Development-AI-metafyl/` and one other
project. This is the implementation note the observability spec
(`metafyl-improvements-impl-plan-0810.md`, §29) asks for before code. The
older audit in `2026-09-10-session-story-design.md` covered 2.1.227–2.1.266.

## 1. Record types seen

Across the metafyl main transcripts: `assistant` 1676, `attachment` 1563,
`user` 1067, `last-prompt` 318, `mode` 317, `atis-latch` 316, `ai-title` 296,
`permission-mode` 251, `file-history-snapshot` 77, `system` 68,
`file-history-delta` 55, `cost-state` 17, `agent-name` 13,
`queue-operation` 10. Never seen: `summary`, `progress`.

`system` subtypes seen: `turn_duration` (with `durationMs`, `messageCount`),
`away_summary`, `local_command`. Not seen: `compact_boundary`, `api_error`.

## 2. Facts the observability spec did not assume

| Spec assumption | Reality |
| --- | --- |
| Tokens probably unavailable | Every `assistant` record carries `message.usage` (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`) and `message.model`. There is one record per content block: records of the same API call share `message.id` and `requestId` and repeat the identical usage object. Summing naively double counts, so usage is deduped by `message.id`. |
| Cost unavailable | A `cost-state` record exists: `{totalCostUSD, totalAPIDuration, totalToolDuration, totalDuration, modelUsage:{<model>:{inputTokens, outputTokens, thinkingTokens, cacheReadInputTokens, cacheCreationInputTokens, costUSD}}, hasUnknownModelCost}`. It has no timestamp and is written at session exit, so a `/story` run inside a live session usually does not have it. |
| Durations "where timestamps permit" | `system/turn_duration` records with `durationMs` follow a turn's last assistant record. A turn can hold more than one (a background-agent notification absorbed mid-turn), so they are summed. Tool results carry `sourceToolAssistantUUID`; tool latency is the result timestamp minus the tool_use timestamp, which includes permission and hook wait. |
| Bash exit code | No exit-code field. A non-zero exit arrives as a `toolUseResult` string `"Error: Exit code N\n…"` with `is_error:true`. Success is `{stdout, stderr, interrupted, isImage}`. |
| Subagents | Agent results are async: `{isAsync:true, status:"async_launched", agentId, description}`. The sidechain transcript is `<slug>/<sessionId>/subagents/agent-<id>.jsonl`, beside `agent-<id>.meta.json` `{agentType, description, toolUseId}`. Completion arrives later as a `<task-notification>` block (in a `queue-operation` record or a user record) carrying `<tool-use-id>`, `<status>`, and `<usage><subagent_tokens>`, `<tool_uses>`, `<duration_ms>`. |
| — | Bash results sometimes carry `gitOperation.commit.sha` and `bashEditDiff` (hunks for shell-made edits). Unused in Phase 1; better sources than parsing output or git recovery for a later phase. |

## 3. Fields the spec wants that these records cannot supply

- Per-call or per-turn USD cost. Cost exists only session-wide in `cost-state`.
- Tool runtime separated from permission and hook wait. Per-call latency includes the wait.
- Test pass/fail counts. Only command exit status is recorded, so "tests run" means test commands.
- Files read through Bash (`cat`, `sed -n`).
- A `summary` or `progress` record type (never seen).
- Synchronous Agent results (every one seen was `async_launched`). Handled defensively, untested on real data.

## 4. Files Phase 1 changes

`src/transcript/claude-code.mjs`, `src/ir/trace.mjs` (new), `src/ir/metrics.mjs`
(new), `src/ir/validate.mjs`, `schemas/story.schema.json`, `bin/story.mjs`,
`src/transcript/locate.mjs`, `SKILL.md`, `README.md`, and tests under `test/`.
