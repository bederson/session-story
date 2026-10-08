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

## 5. Phase 1 inspection (2026-10-08)

Two real sessions were extracted with the Phase 1 code, validated and rendered.

**Live session `894d22cb` (Claude Code 2.1.292, three turns, no cost-state yet).**
- 155 trace events: 3 prompts, 148 tool calls, 4 subagents. Statuses: 145 ok, 7 error, 2 rejected, 1 unknown (the call still running at extract time).
- All four background agents (three Explore, one Plan) had `agent_type` from their meta file, were closed by their `<task-notification>` (`ended_source: notification`), and carried 13 to 21 child events with deduped usage.
- Turn durations came from `turn_duration` records for the two finished turns and were derived for the turn in progress, as designed.
- `metrics.usage.source` was `transcript` with `complete: true` and `total_cost_usd: null`. `environment` listed version 2.1.292 and both models used.

**Finished session `3ad2cfc2` (one `cost-state` record).**
- `metrics.usage.source` was `cost-state` and `total_cost_usd` equalled the record's `totalCostUSD` (4.2226…). The model list included `claude-haiku-4-5-20251001`, which never appears as an assistant `message.model` in that transcript: the harness's background calls are only visible through `cost-state`. The two sources also name the same model differently: the 98 assistant records say `claude-opus-5`, while `cost-state` says `claude-opus-5[1m]`. `environment.models` comes from the records and `metrics.usage.models` from `cost-state` when present, so the two lists can disagree; the Trace view should show them as separate facts rather than merge them.

**Rendering.** Both stories validate, and the page rendered by this branch is byte-identical to the one `main` renders from the same story.json, with the same four tabs.

**Fixed during inspection.**
- `extract --latest -o <file>` ignored `-o`: the arg parser let `--latest` take `-o` as its value and wrote `./story.json`. Fixed in the parser.
- `metrics.validation.last_command` held a whole multi-line heredoc. It now shows the first line, capped at 200 characters.

**Known limits seen on real data, left as documented behaviour.**
- `classifyCommand` classifies a line by any segment it contains, so a scripted heredoc that ends in `npm test` counts as a test command. Validation counts therefore include such compound lines.
- A notification that arrives after the next prompt closes its agent event but cannot extend the already-closed earlier turn's derived duration.
- When a story joins several sessions across `/clear` and only some have a `cost-state`, `metrics.usage` uses the cost-state totals and marks `complete: false`.

## 6. Phase 2 inspection (2026-10-08)

This session's story (`894d22cb`, 168 trace events at render time) was rendered with the Trace tab.

**Verified without a browser.**
- The page has five tabs. Both inline scripts parse, checked by compiling each one with `new Function`.
- All 12 "View diff in Review" buttons point at an edit whose `.edit-header[data-edit-id]` is inside the matching Review turn panel.
- Size: the page is 4.57 MB with the Trace lens and 4.36 MB without it. The lens adds 214 KB, about 1.3 KB per event, which is more than the plan's estimate of about 0.5 KB. Most of it is the expandable detail of each event. It is still small next to the pre-rendered diffs. If it becomes a problem for very long sessions, the detail rows are the place to trim.

**Not verified: the in-browser behavior.** The Chrome extension was not connected, and headless Chrome hangs in this environment even on a three-line page. These still need a manual check in a browser over `file://`:
- Filters and Failures only narrow the list.
- Jumps land on the edit and flash it.
- An edit outside the project switches the scope toggle on.
- The light and dark themes, a phone-width layout, and the console being free of errors.
