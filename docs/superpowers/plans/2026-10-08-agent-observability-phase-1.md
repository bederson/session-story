# Agent Observability (Trace) — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give story.json a deterministic execution trace (every prompt, tool call and subagent, with timing and status), a metrics block, real token/cost usage, and an environment fingerprint — so a later Trace view can be rendered from facts alone.

**Architecture:** Extend the single pass in `src/transcript/claude-code.mjs` (`buildStory`) to emit `trace.events[]`, per-turn durations and per-turn usage while it already walks the records; add a pure `src/ir/metrics.mjs` that derives `metrics` from turns + trace; wire both into `cmdExtract` in `bin/story.mjs` and the `--brief` projection. All new fields are optional and snake_case, like the rest of the IR.

**Tech Stack:** Node ≥18.18 ESM, zero runtime deps, `node --test`, hand-written validator (no JSON Schema engine).

**Spec:** `docs/superpowers/specs/metafyl-improvements-impl-plan-0810.md` (the observability plan), read together with `docs/superpowers/specs/2026-09-10-session-story-design.md` (the existing design and IR). This file should be copied to `docs/superpowers/plans/2026-10-08-agent-observability-phase-1.md` as the first commit of the work (Task 0), since plan mode cannot write into the repo.

---

## Context

The spec turns Session Story from a review artifact into a local-first coding-agent observability artifact: a fifth **Trace** view with a chronological event timeline, a scorecard, deterministic metrics, deterministic pathology findings, separate Claude "interpretations", and a redaction pass. It insists (rightly) on a strict fact/interpretation boundary, on honesty about unavailable telemetry, and on keeping the output one standalone `file://` HTML page.

Phase 1 is the data layer. Nothing in the UI changes yet except that the old page must still render from the new story.json.

### What the exploration found (facts the spec did not know)

Verified against transcripts on this machine (Claude Code **2.1.288–2.1.292**; the design doc's record audit was 2.1.227–2.1.266, so Task 1 re-records the shapes):

| Spec assumption | Reality |
| --- | --- |
| Tokens probably unavailable | Every `assistant` record carries `message.usage` (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`) and `message.model`. **One record per content block**: records of the same API call share `message.id`/`requestId` and repeat the identical usage object. Summing naively double counts; dedupe by `message.id`. |
| Cost unavailable; "do not fabricate from model names" | A `cost-state` record exists: `{totalCostUSD, totalAPIDuration, totalToolDuration, totalDuration, modelUsage:{<model>:{inputTokens, outputTokens, thinkingTokens, cacheReadInputTokens, cacheCreationInputTokens, costUSD}}, hasUnknownModelCost}`. It has no timestamp and is written at session exit, so a `/story` run inside a live session usually will not have it. Show it when present, provenance `transcript`. |
| Durations "where timestamps permit" | `system` records with `subtype:"turn_duration"` and `durationMs` land right after a turn's last assistant record (harness-reported). Tool results carry `sourceToolAssistantUUID` pointing at the issuing assistant record, so tool latency = result timestamp − tool_use timestamp (includes permission/hook wait; label it latency, not runtime). |
| Bash exit code | No exit-code field. Non-zero exit arrives as `toolUseResult` string `"Error: Exit code N\n…"` with `is_error:true` (already parsed by `parseExitCode`). Success is `{stdout, stderr, interrupted, isImage}`. |
| Subagents | Agent results are now **async**: `{isAsync:true, status:"async_launched", agentId, description}`. Sidechain file `<slug>/<sessionId>/subagents/agent-<id>.jsonl` plus `agent-<id>.meta.json` `{agentType, description, toolUseId}`. Completion lands later as a `<task-notification>` block (in a `queue-operation` or user record) carrying `<usage><subagent_tokens>`, `<tool_uses>`, `<duration_ms>`. |
| — | Bash results sometimes carry `gitOperation.commit.sha` and `bashEditDiff` (hunks for shell-made edits). Not needed in Phase 1, but noted in the roadmap as better sources than regex-parsing output / git recovery. |

Already in the IR today (the spec's Phase 1/3 lists partly re-describe it): `turns[].bash[]` with `category` (test/lint/build/install/git/other), `ok`, `exit_code`, `rejected`, `interrupted`, `output_tail`; `turns[].errors[]` for every tool; `turns[].plan`; `edits[].result` ok/unknown/error; `files[].churn`; `totals`; `report.git` and `report.dependencies`; subagent edits/bash/errors flattened into the spawning turn; `session.duration_ms`. Not captured today: Read/Glob/Grep/any other tool call, result timestamps, durations, usage, model, Claude Code version.

## Critique of the spec (what to change, and why)

Decisions already taken with the user on 2026-10-08 are marked **(agreed)**.

1. **Overlapping event types → one `kind` plus attributes.** The spec's nine event types (`command`, `edit`, `test`, `error`, `git`, …) are not disjoint: a test is a command is a Bash tool call; an error is a status. Forcing one type per event loses information and makes filters lie. Plan: `kind ∈ {prompt, tool, subagent}` with `tool`, `category` (Bash classification), `status`. Trace filters (Phase 2) derive from attributes: Commands = `tool==="Bash"`, Edits = `tool ∈ {Edit, Write, NotebookEdit}`, Tests = `category==="test"`, Errors = `status ∈ {error, rejected}`. `assistant` text events are dropped (nothing observable to show); `plan` is kept on the turn as today.
2. **`telemetry` would duplicate `totals`.** The spec's `telemetry` block repeats `totals` (turns, files, lines) under new names. Plan: leave `totals` untouched (the header depends on it) and add a `metrics` object grouped exactly as the spec's §13 panel (`execution`, `code`, `validation`, `reads`, `usage`) so the renderer never regroups.
3. **camelCase in the spec vs snake_case in the IR.** Every example (`durationMs`, `turnId`, `startedAt`) must become `duration_ms`, `turn`, `started_at`. The validator and renderer use snake_case throughout.
4. **Add real usage and cost (agreed).** Capture per-turn and session token usage from `message.usage` (deduped) and `cost-state` when present, each with `source`. Unknown stays `null`, never `0`.
5. **Drop the runtime fingerprint (agreed).** `node`/`platform`/`arch` at extract time describe the machine running the extractor, not the session. `environment` = `{agent:{name:"Claude Code", version}, models:[…]}`, both from the records. Repository facts stay in `report.git`.
6. **Defer `rework` to Phase 3 (agreed).** The spec itself hedges it. Phase 1 ships `edits_per_file` and the existing `churn`; Phase 3 defines rework precisely as `1 − net_lines / intermediate_lines` per file, only where `ir/file-state.mjs` chaining is exact, else `null`.
7. **Drop the "repeated context read" detector (agreed).** Re-reading after compaction or a long tool run is normal; it would mostly flag noise. Keep the `reads.files_read` count.
8. **"Tests run / failed" must mean test *commands*.** Frameworks print pass counts differently; the extractor should not parse them. Name the metric `validation.commands`, `passed`, `failed`, and keep the spec's `testsRun: 8` reading as "8 test commands".
9. **Define "retry" and "turn duration" exactly** (the spec leaves both open). Retry: a Bash call whose whitespace-normalised command text equals an earlier Bash call in the same session that had `ok === false`. Turn duration: harness `turn_duration.durationMs` when the record follows the turn (`source:"transcript"`), else last event end − prompt time (`source:"derived"`), else `null`.
10. **Trace diffs by jump link, not re-render (agreed; Phase 2).** Re-rendering hunks inside Trace would double the heaviest part of the page (one real story is 3.4 MB). Trace edit events link to the existing `.edit[data-file]` in the Review panel, reusing the chip-click flash behaviour in `template.mjs` `SCRIPT`. Phase 1 makes this possible by giving each tool event the same `id` as the edit's tool_use id.
11. **Embedded JSON vs pre-rendered DOM (Phase 2).** §12 says "everything operates against data embedded in the HTML". The current page embeds no JSON; everything is pre-rendered and filtered by CSS classes (`show-outside`, `.v-in/.v-all`). Trace should follow that pattern (`data-kind`, `data-status`, `data-tool` attributes + class toggles), not ship a second copy of the data as JSON.
12. **Redaction belongs on the IR, not only on render (Phase 5).** `render --redact` alone leaves secrets in `story.json`, in `.session-stories/index.json` and `sessions.js`. Plan: a pure `redactStory(story) → {story, report}` transform applied in `cmdRender` before `renderPage` *and* before `libraryEntry`, plus a `story redact in.json -o out.json` command for sharing the JSON.
13. **Phase ordering.** The spec computes "deterministic telemetry" in Phase 1 and a "metrics module" again in Phase 3. Merge: the metrics module is Phase 1; Phase 3 is pathologies + findings only.
14. **Skill arguments.** `SKILL.md` has no `$ARGUMENTS` handling today. `/story --no-open`, `/story --redact`, and `focus on …` are feasible (Claude reads the arguments and adapts steps 2 and 4), and the spec is right that focus must only steer the semantic step. Phase 4.
15. **Keep `schema_version` at 1.** Every addition is optional; old story.json files must validate and render unchanged (regression test in Task 9).

## Global Constraints

- Zero npm runtime dependencies; Node ≥ 18.18; ESM `.mjs`; `node --test test/`.
- IR field names are snake_case; ids are the transcript's own ids (`uuid`, tool_use `id`).
- Unknown telemetry is `null`, never `0`; every derived block states its `source` (`transcript | git | filesystem | derived | claude | unknown`).
- No field is added that is not verified against a real record shape (Task 1's note is the record of that verification).
- Existing tests keep passing at every commit; an old `story.json` (no `trace`, `metrics`, `environment`) still validates and renders.
- Never ask Claude to compute what the extractor can derive; Phase 1 adds nothing for Claude to write.
- Per-event payload is small: no output text, no hunks (the edit already holds them, found by the shared id).

## Review Focus

Inputs the spec implies but no spec test names; each has a test pinned to the owning task below.

1. **A session interrupted mid-tool-call** (tool_use with no result record): the event must end with `status:"unknown"`, `ended_at:null`, `duration_ms:null`, and the metrics must not count it as failed. → Task 2 (adapter test) and Task 6 (metrics count only `error`).
2. **Assistant records that share one API call** (same `message.id`, repeated usage): per-turn usage must count the call once. → Task 4.
3. **A transcript with no `turn_duration` records and no tool results** (old Claude Code, or a prompt-only session): `turns[].duration_ms` must be `null` with `duration_source:"unknown"`, never `0`. → Task 3.
4. **Two Agent calls in one turn, one with a missing sidechain file**: the present subagent's events get `parent_id` set to its Agent event; the missing one yields an Agent event with no children and `usage:null`, with no throw; notifications match by tool-use id, not order. → Task 5.
5. **A retry across turns and a retry with different whitespace**: `npm test` failing in turn 1 and run again in turn 2 counts as one retry; `npm  test` counts too; `npm test -- --watch` does not; an `interrupted` run is not a retry anchor. → Task 6.

---

## Roadmap after Phase 1 (interfaces pinned now, tasks written later)

Each later phase gets its own plan document when Phase 1 has been inspected on a real session (spec §29).

- **Phase 2 — Trace view.** `renderTraceLens(story)` in a new `src/render/trace.mjs`; `lensTab('trace','Trace')` and `<section id="lens-trace">` added in `template.mjs` `renderPage`; a `trace` icon in `icons.mjs`. Scorecard tiles from `metrics` (omit a tile when the value is `null`). Timeline: one `<li class="trace-event" data-kind data-tool data-status data-turn>` per event, `<details>` for expansion, relative time from `session.started_at`. Filters: buttons toggling `html.trace-<filter>` classes, CSS-only hiding, same pattern as `OPTIONS` in `template.mjs`. Edit events link to the Review edit via the shared tool_use id. Metrics panel = the five `metrics` groups. Headless `file://` smoke test.
- **Phase 3 — Pathologies + findings.** `src/ir/pathologies.mjs` `detectPathologies(story) → findings[]` with `{type, severity: 'info'|'warning', confidence: 'low'|'medium'|'high', turns:[…], evidence:[event ids], summary, source:'derived'}`; stored at `report.findings`. Detectors: repeated failing command, edit/test loop, high churn (same file edited ≥ N times), validation missing after last edit, final validation failed. `rework` defined here. Findings panel in Trace under "Detected".
- **Phase 4 — Semantic observations.** `briefProjection` adds `metrics` and `report.findings`; SKILL.md step 2 asks for optional `report.observations[]` `{type, confidence, turns, summary}` and documents `$ARGUMENTS` (`--no-open`, `--redact`, `focus on …`); `validate --strict` checks enums when present but never requires observations. Rendered under "Interpretation", visually distinct.
- **Phase 5 — Redaction.** `src/ir/redact.mjs` `redactStory(story) → {story, report:{secrets, paths, urls}}`; applied in `cmdRender --redact` before render and before `libraryEntry`; `story redact` command; adversarial fixtures; test asserts no fixture secret appears in the HTML, `index.json`, or `sessions.js`.
- **Later (spec Phases 6–9):** compare, evals, adapter boundary, OTLP export — unchanged, out of this plan.

---

## Phase 1 — data shapes (the contract every task below implements)

All snake_case, all optional on the story. `id`s are the transcript's own ids, so `turns[].edits[].id`, `turns[].bash[].id` and `turns[].errors[].id` join to `trace.events[].id` with no extra field.

```jsonc
"trace": {
  "events": [
    // kind: prompt — id is the turn id; duration mirrors the turn's
    { "id": "u1", "kind": "prompt", "turn": 1, "parent_id": null, "tool": null, "category": null,
      "status": "ok", "summary": "Fix the failing test", "started_at": "2026-10-08T10:00:00.000Z",
      "ended_at": "2026-10-08T10:00:18.000Z", "duration_ms": 18000, "source": "transcript" },
    // kind: tool — any tool; Bash carries its category, everything else null
    { "id": "toolu_02", "kind": "tool", "turn": 1, "parent_id": null, "tool": "Bash", "category": "test",
      "status": "error", "summary": "npm test", "started_at": "…:00:03.000Z", "ended_at": "…:00:10.000Z",
      "duration_ms": 7000, "source": "transcript" },
    // kind: subagent — the Agent tool_use; children point at it through parent_id
    { "id": "toolu_09", "kind": "subagent", "turn": 2, "parent_id": null, "tool": "Agent", "category": null,
      "status": "ok", "summary": "Explore IR and extraction layer", "started_at": "…", "ended_at": "…",
      "duration_ms": 113554, "source": "transcript", "agent_id": "aeb9fccb49f2b42de", "agent_type": "Explore",
      "ended_source": "notification",
      "usage": { "input_tokens": 12, "output_tokens": 4100, "cache_read_tokens": 90000, "cache_creation_tokens": 8000,
                 "api_calls": 9, "models": ["claude-opus-5-5"], "complete": true } },
    // a subagent's own tool call: kind tool, parent_id set, agent_id set
    { "id": "toolu_10", "kind": "tool", "turn": 2, "parent_id": "toolu_09", "tool": "Read", "category": null,
      "status": "ok", "summary": "src/ir/validate.mjs", "started_at": "…", "ended_at": "…", "duration_ms": 412,
      "source": "transcript", "agent_id": "aeb9fccb49f2b42de" }
  ],
  "cost_states": [ // one per chain link that had a `cost-state` record; usually empty for a live session
    { "total_cost_usd": 0.75, "total_api_duration_ms": 91788, "total_tool_duration_ms": 7280,
      "model_usage": { "claude-opus-5-5": { "inputTokens": 898, "outputTokens": 14, "cacheReadInputTokens": 0, "cacheCreationInputTokens": 0, "costUSD": 0.7 } },
      "has_unknown_model_cost": false }
  ]
}
```

Enums: `kind` ∈ `prompt|tool|subagent`; `status` ∈ `ok|error|rejected|interrupted|unknown`; `source` is always `transcript` in Phase 1 (`agent_id` says which transcript); `ended_source` (subagent only) ∈ `result|notification|subagent_transcript|null`.

```jsonc
// per turn
"duration_ms": 18000, "duration_source": "transcript",   // transcript (harness turn_duration, summed) | derived | unknown
"usage": { "input_tokens": 30, "output_tokens": 65, "cache_read_tokens": 1100, "cache_creation_tokens": 100,
           "api_calls": 4, "models": ["claude-opus-5-5"], "complete": true }   // null when the turn had no assistant records

// session level
"environment": { "agent": { "name": "Claude Code", "version": "2.1.288" }, "models": ["claude-opus-5-5"] },
"metrics": {
  "execution":  { "duration_ms": 18500, "turns": 1, "tool_calls": 4, "failed_tool_calls": 1, "rejected_tool_calls": 0,
                  "commands": 2, "failed_commands": 1, "retries": 1 },
  "code":       { "files_changed": 1, "lines_added": 1, "lines_removed": 1, "edits": 1,
                  "files_edited_repeatedly": [ { "rel": "src/a.js", "edits": 3 } ] },
  "validation": { "commands": 2, "passed": 1, "failed": 1, "final_state": "passed", "last_command": "npm test" },
  "reads":      { "files_read": 1, "tool_calls": 1 },
  "usage":      { "input_tokens": 30, "output_tokens": 65, "cache_read_tokens": 1100, "cache_creation_tokens": 100,
                  "total_cost_usd": 0.05, "models": ["claude-opus-5-5"], "source": "cost-state", "complete": true }
}
```

`metrics.*` leaves are a number or `null` (unknown). `validation.final_state` ∈ `passed|failed|none|unknown`. `usage.source` ∈ `cost-state|transcript|none`; `total_cost_usd` is non-null only from `cost-state`. `totals` is untouched.

Definitions (also go into the schema descriptions):
- **Tool latency** (`duration_ms` on a tool event) = tool_result record timestamp − tool_use record timestamp. It includes permission and hook wait, so the page must call it latency.
- **Turn duration** = sum of the turn's `system/turn_duration.durationMs` records (`transcript`); else last finished event's `ended_at` − prompt `at` (`derived`); else `null` (`unknown`).
- **Retry** = a Bash run whose whitespace-normalised command (collapse runs of whitespace, drop a trailing `;`, trim) equals the most recent earlier run of the same text and that earlier run ended `error`.
- **Validation** = Bash runs with category `test|lint|build`; `passed` = status `ok`, `failed` = `error`; `final_state` from the last one (`ok`→passed, `error`→failed, none→none, anything else→unknown).
- **Reads** = `Read|Glob|Grep` tool events; `files_read` = distinct summaries of `ok` `Read` events (files read through `cat` in Bash are not detected — documented limit).

---

## Phase 1 Tasks

### Task 0: Put the plan and the record audit in the repo

**Files:**
- Create: `docs/superpowers/plans/2026-10-08-agent-observability-phase-1.md` (this file, verbatim)
- Create: `docs/superpowers/specs/2026-10-08-transcript-record-audit.md`

This is the "short implementation note" the spec's §29 demands before code. Its content is already established above: copy the table from **What the exploration found** and the two lists below into the audit file, with the header "Verified against Claude Code 2.1.288–2.1.292 on 2026-10-08".

- [ ] **Step 1: Write the audit note** with these sections: (1) record types seen and their counts; (2) the fact table from Context; (3) "Fields the spec wants that these records cannot supply": per-call USD cost; tool runtime separated from permission/hook wait; test pass/fail counts (only command exit status); files read via Bash; a Claude Code `summary`/`progress` record type (never seen); synchronous Agent results (all seen were `async_launched`); (4) "Files Phase 1 changes": `src/transcript/claude-code.mjs`, `src/ir/trace.mjs` (new), `src/ir/metrics.mjs` (new), `src/ir/validate.mjs`, `schemas/story.schema.json`, `bin/story.mjs`, `src/transcript/locate.mjs`, `SKILL.md`, `test/*`.
- [ ] **Step 2: Copy this plan** to `docs/superpowers/plans/2026-10-08-agent-observability-phase-1.md`.
- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-10-08-agent-observability-phase-1.md docs/superpowers/specs/2026-10-08-transcript-record-audit.md docs/superpowers/specs/metafyl-improvements-impl-plan-0810.md
git commit -m "docs: observability spec, record audit and Phase 1 plan"
```

---

### Task 1: Trace helpers (`src/ir/trace.mjs`)

**Files:**
- Create: `src/ir/trace.mjs`
- Test: `test/trace.test.mjs`

**Interfaces:**
- Consumes: `isRejection` from `src/ir/commands.mjs`.
- Produces (used by Tasks 2–6): `EVENT_KINDS`, `EVENT_STATUSES`, `DURATION_SOURCES`, `msBetween(startIso, endIso) → number|null`, `newEvent({id, kind, turn, parentId, tool, category, summary, startedAt, agentId}) → event`, `finishEvent(event, endedAt, status) → event`, `resultStatus(isError, toolUseResult) → status`, `eventSummary(name, input, cwd) → string`, `turnDuration({harnessMs, promptAt, lastEndedAt}) → {duration_ms, duration_source}`, `sortEvents(events) → events`.

- [ ] **Step 1: Write the failing tests**

```js
// test/trace.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  msBetween, newEvent, finishEvent, resultStatus, eventSummary, turnDuration, sortEvents,
} from '../src/ir/trace.mjs';

test('msBetween returns the positive difference in ms, or null when either timestamp is missing or unparseable', () => {
  assert.equal(msBetween('2026-10-08T10:00:01.000Z', '2026-10-08T10:00:09.500Z'), 8500);
  assert.equal(msBetween('2026-10-08T10:00:09.000Z', '2026-10-08T10:00:01.000Z'), 0);
  assert.equal(msBetween(null, '2026-10-08T10:00:01.000Z'), null);
  assert.equal(msBetween('garbage', '2026-10-08T10:00:01.000Z'), null);
});

test('newEvent starts a tool event as unknown with no end, and a prompt event as ok', () => {
  const ev = newEvent({ id: 'toolu_1', kind: 'tool', turn: 1, tool: 'Read', summary: 'src/a.js', startedAt: '2026-10-08T10:00:01.000Z' });
  assert.deepEqual(ev, {
    id: 'toolu_1', kind: 'tool', turn: 1, parent_id: null, tool: 'Read', category: null,
    status: 'unknown', summary: 'src/a.js', started_at: '2026-10-08T10:00:01.000Z',
    ended_at: null, duration_ms: null, source: 'transcript',
  });
  assert.equal(newEvent({ id: 'u1', kind: 'prompt', turn: 1, summary: 'hi' }).status, 'ok');
  assert.equal(newEvent({ id: 'x', kind: 'tool', turn: 1, agentId: 'ag1' }).agent_id, 'ag1');
});

test('finishEvent sets ended_at, latency and status', () => {
  const ev = newEvent({ id: 't', kind: 'tool', turn: 1, tool: 'Bash', startedAt: '2026-10-08T10:00:01.000Z' });
  finishEvent(ev, '2026-10-08T10:00:09.500Z', 'error');
  assert.equal(ev.ended_at, '2026-10-08T10:00:09.500Z');
  assert.equal(ev.duration_ms, 8500);
  assert.equal(ev.status, 'error');
});

test('resultStatus ranks rejected over interrupted over error over ok', () => {
  assert.equal(resultStatus(true, 'User rejected tool use'), 'rejected');
  assert.equal(resultStatus(true, { stdout: '', stderr: '', interrupted: true }), 'interrupted');
  assert.equal(resultStatus(true, 'Error: Exit code 1'), 'error');
  assert.equal(resultStatus(false, { stdout: 'ok' }), 'ok');
});

test('eventSummary names the command, the relative file, the pattern, or the description', () => {
  assert.equal(eventSummary('Bash', { command: 'npm test\necho done' }, '/proj'), 'npm test');
  assert.equal(eventSummary('Read', { file_path: '/proj/src/a.js' }, '/proj'), 'src/a.js');
  assert.equal(eventSummary('Edit', { file_path: '/proj/src/a.js' }, '/proj'), 'src/a.js');
  assert.equal(eventSummary('Grep', { pattern: 'foo', path: '/proj/src' }, '/proj'), 'foo in src');
  assert.equal(eventSummary('Glob', { pattern: '**/*.mjs' }, '/proj'), '**/*.mjs');
  assert.equal(eventSummary('Agent', { description: 'Explore IR' }, '/proj'), 'Explore IR');
  assert.equal(eventSummary('WebFetch', { url: 'https://x.test' }, '/proj'), 'https://x.test');
  assert.equal(eventSummary('Skill', { skill: 'tdd' }, '/proj'), '');
  assert.equal(eventSummary('Bash', { command: 'x'.repeat(300) }, '/proj').length, 200);
});

test('turnDuration prefers the harness total, then wall clock to the last event, then unknown', () => {
  assert.deepEqual(turnDuration({ harnessMs: 3000, promptAt: 'a', lastEndedAt: 'b' }), { duration_ms: 3000, duration_source: 'transcript' });
  assert.deepEqual(
    turnDuration({ harnessMs: null, promptAt: '2026-10-08T10:00:00.000Z', lastEndedAt: '2026-10-08T10:00:18.000Z' }),
    { duration_ms: 18000, duration_source: 'derived' }
  );
  assert.deepEqual(turnDuration({ harnessMs: 0, promptAt: '2026-10-08T10:00:00.000Z', lastEndedAt: null }), { duration_ms: null, duration_source: 'unknown' });
});

test('sortEvents orders by started_at, keeps ties in insertion order, and keeps an undated event right after the dated one inserted before it', () => {
  const a = newEvent({ id: 'a', kind: 'tool', turn: 1, startedAt: '2026-10-08T10:00:05.000Z' });
  const b = newEvent({ id: 'b', kind: 'tool', turn: 1, startedAt: '2026-10-08T10:00:01.000Z' });
  const c = newEvent({ id: 'c', kind: 'tool', turn: 1, startedAt: null }); // inserted after b, so it sorts with b's time
  const d = newEvent({ id: 'd', kind: 'tool', turn: 1, startedAt: '2026-10-08T10:00:01.000Z' });
  assert.deepEqual(sortEvents([a, b, c, d]).map((e) => e.id), ['b', 'c', 'd', 'a']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/trace.test.mjs`
Expected: FAIL — `Cannot find module '../src/ir/trace.mjs'`

- [ ] **Step 3: Implement `src/ir/trace.mjs`**

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/trace.test.mjs`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/ir/trace.mjs test/trace.test.mjs
git commit -m "feat(trace): event helpers — status, latency, summaries, turn duration"
```

---

### Task 2: Adapter emits prompt and tool events for the main transcript

**Files:**
- Modify: `src/transcript/claude-code.mjs` (`buildStory`, lines 338–514)
- Test: `test/adapter.test.mjs`

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces: `story.trace = { events, cost_states: [] }` (cost_states filled in Task 4); every tool_use in the main transcript becomes a `tool` event (or `subagent` for `Agent`) with the tool_use `id`; every prompt becomes a `prompt` event with the turn's `id`. Tool events whose result never arrives stay `status:"unknown"`.

- [ ] **Step 1: Write the failing tests** (append to `test/adapter.test.mjs`; reuse its `userRecord` and `assistantBash` helpers, lines 294–315)

```js
function assistantTool({ uuid, ts, id, name, input, messageId, usage, model, version }) {
  const record = {
    type: 'assistant', uuid, timestamp: ts, gitBranch: 'main',
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
  };
  if (messageId) record.message.id = messageId;
  if (usage) record.message.usage = usage;
  if (model) record.message.model = model;
  if (version) record.version = version;
  return record;
}

test('trace: emits a prompt event per turn whose id is the turn id', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-08T10:00:00.000Z', message: { role: 'user', content: 'first' } },
    { type: 'user', uuid: 'u2', timestamp: '2026-10-08T10:05:00.000Z', message: { role: 'user', content: 'second' } },
  ];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });
  const prompts = story.trace.events.filter((e) => e.kind === 'prompt');
  assert.deepEqual(prompts.map((e) => e.id), ['u1', 'u2']);
  assert.deepEqual(prompts.map((e) => e.turn), [1, 2]);
  assert.equal(prompts[0].summary, 'first');
});

test('trace: every tool call becomes a tool event with latency and status, including Read and Grep', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-08T10:00:00.000Z', message: { role: 'user', content: 'look around' } },
    assistantTool({ uuid: 'a1', ts: '2026-10-08T10:00:01.000Z', id: 'tu1', name: 'Read', input: { file_path: '/proj/src/a.js' } }),
    userRecord({ uuid: 'r1', ts: '2026-10-08T10:00:01.400Z', toolUseId: 'tu1', content: { type: 'text', file: { filePath: '/proj/src/a.js', content: 'x', numLines: 1 } } }),
    assistantTool({ uuid: 'a2', ts: '2026-10-08T10:00:02.000Z', id: 'tu2', name: 'Grep', input: { pattern: 'foo', path: '/proj/src' } }),
    userRecord({ uuid: 'r2', ts: '2026-10-08T10:00:02.250Z', toolUseId: 'tu2', content: 'No matches found', isError: true }),
    assistantBash({ uuid: 'a3', ts: '2026-10-08T10:00:03.000Z', id: 'tu3', command: 'npm test', description: 'run tests' }),
    userRecord({ uuid: 'r3', ts: '2026-10-08T10:00:10.000Z', toolUseId: 'tu3', content: 'Error: Exit code 1\n1 failing', isError: true }),
  ];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });
  const tools = story.trace.events.filter((e) => e.kind === 'tool');
  assert.deepEqual(tools.map((e) => [e.id, e.tool, e.category, e.status, e.summary, e.duration_ms]), [
    ['tu1', 'Read', null, 'ok', 'src/a.js', 400],
    ['tu2', 'Grep', null, 'error', 'foo in src', 250],
    ['tu3', 'Bash', 'test', 'error', 'npm test', 7000],
  ]);
  assert.ok(tools.every((e) => e.turn === 1 && e.parent_id === null && e.source === 'transcript'));
});

test('trace: a rejected tool use is rejected and an interrupted Bash is interrupted, not error', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-08T10:00:00.000Z', message: { role: 'user', content: 'go' } },
    assistantBash({ uuid: 'a1', ts: '2026-10-08T10:00:01.000Z', id: 'tu1', command: 'rm -rf build' }),
    userRecord({ uuid: 'r1', ts: '2026-10-08T10:00:02.000Z', toolUseId: 'tu1', content: 'User rejected tool use', isError: true }),
    assistantBash({ uuid: 'a2', ts: '2026-10-08T10:00:03.000Z', id: 'tu2', command: 'npm run dev' }),
    userRecord({ uuid: 'r2', ts: '2026-10-08T10:00:33.000Z', toolUseId: 'tu2', content: { stdout: '', stderr: '', interrupted: true }, isError: true }),
  ];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });
  const byId = Object.fromEntries(story.trace.events.map((e) => [e.id, e]));
  assert.equal(byId.tu1.status, 'rejected');
  assert.equal(byId.tu2.status, 'interrupted');
});

test('trace: a tool call whose result never arrives stays unknown with no end and no latency', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-08T10:00:00.000Z', message: { role: 'user', content: 'go' } },
    assistantTool({ uuid: 'a1', ts: '2026-10-08T10:00:01.000Z', id: 'tu1', name: 'Edit', input: { file_path: '/proj/a.js', old_string: 'a', new_string: 'b' } }),
  ];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });
  const ev = story.trace.events.find((e) => e.id === 'tu1');
  assert.equal(ev.status, 'unknown');
  assert.equal(ev.ended_at, null);
  assert.equal(ev.duration_ms, null);
});

test('trace: events are in chronological order with the prompt first', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-08T10:00:00.000Z', message: { role: 'user', content: 'go' } },
    assistantBash({ uuid: 'a1', ts: '2026-10-08T10:00:05.000Z', id: 'tu1', command: 'ls' }),
    assistantBash({ uuid: 'a2', ts: '2026-10-08T10:00:01.000Z', id: 'tu2', command: 'pwd' }),
  ];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });
  assert.deepEqual(story.trace.events.map((e) => e.id), ['u1', 'tu2', 'tu1']);
});

test('trace: a result for an unknown tool_use id is ignored', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-08T10:00:00.000Z', message: { role: 'user', content: 'go' } },
    userRecord({ uuid: 'r1', ts: '2026-10-08T10:00:02.000Z', toolUseId: 'ghost', content: 'ok' }),
  ];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });
  assert.equal(story.trace.events.length, 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/adapter.test.mjs`
Expected: the six new `trace:` tests FAIL with `Cannot read properties of undefined (reading 'events')`; all existing tests still PASS.

- [ ] **Step 3: Implement in `buildStory`**

Add the import at the top of `src/transcript/claude-code.mjs`:

```js
import { newEvent, finishEvent, resultStatus, eventSummary, sortEvents } from '../ir/trace.mjs';
```

Inside `buildStory`, next to the other Maps (after `pendingAny`, line 347):

```js
  const events = [];
  // tool_use id -> its trace event, until the tool_result arrives
  const pendingEvents = new Map();
```

In the prompt branch (line 365), after `turns.push(currentTurn)` and before `continue`:

```js
      events.push(newEvent({ id: record.uuid, kind: 'prompt', turn: currentTurn.index, summary: currentTurn.prompt.length > 200 ? currentTurn.prompt.slice(0, 200) : currentTurn.prompt, startedAt: record.timestamp || null }));
```

Extend the `allToolUseCalls` loop (line 381) so it also creates events:

```js
    for (const block of allToolUseCalls(record)) {
      if (!currentTurn) continue;
      pendingAny.set(block.id, { name: block.name, input: block.input, turnRef: currentTurn });
      const command = block.name === BASH_TOOL ? ((block.input && block.input.command) || '') : null;
      const event = newEvent({
        id: block.id,
        kind: block.name === AGENT_TOOL ? 'subagent' : 'tool',
        turn: currentTurn.index,
        tool: block.name,
        category: command === null ? null : classifyCommand(command),
        summary: eventSummary(block.name, block.input, cwd),
        startedAt: record.timestamp || null,
      });
      events.push(event);
      pendingEvents.set(block.id, event);
    }
```

In the tool-result section, right after `const info = pendingAny.get(toolResult.toolUseId);` (line 425):

```js
    const event = pendingEvents.get(toolResult.toolUseId);
    if (event) {
      finishEvent(event, record.timestamp || null, resultStatus(toolResult.isError, toolResult.result));
      pendingEvents.delete(toolResult.toolUseId);
    }
```

(Task 5 changes this block for async `Agent` results; keep it simple here.)

In the returned object (line 490), add after `report`:

```js
    trace: { events: sortEvents(events), cost_states: [] },
```

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS, including the six new tests.

- [ ] **Step 5: Commit**

```bash
git add src/transcript/claude-code.mjs test/adapter.test.mjs
git commit -m "feat(trace): emit prompt and tool events from the main transcript"
```

---

### Task 3: Turn durations

**Files:**
- Modify: `src/transcript/claude-code.mjs` (`buildStory`)
- Test: `test/adapter.test.mjs`

**Interfaces:**
- Produces: `turns[].duration_ms` (int|null), `turns[].duration_source` (`transcript|derived|unknown`); the prompt event's `ended_at`/`duration_ms` mirror the turn.

- [ ] **Step 1: Write the failing tests**

```js
function turnDurationRecord({ uuid, ts, durationMs }) {
  return { type: 'system', subtype: 'turn_duration', uuid, timestamp: ts, durationMs, isMeta: false };
}

test('turn duration sums the harness turn_duration records of the turn and marks the source transcript', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-08T10:00:00.000Z', message: { role: 'user', content: 'go' } },
    assistantBash({ uuid: 'a1', ts: '2026-10-08T10:00:01.000Z', id: 'tu1', command: 'ls' }),
    userRecord({ uuid: 'r1', ts: '2026-10-08T10:00:02.000Z', toolUseId: 'tu1', content: { stdout: 'a', stderr: '', interrupted: false } }),
    turnDurationRecord({ uuid: 's1', ts: '2026-10-08T10:00:02.100Z', durationMs: 1000 }),
    turnDurationRecord({ uuid: 's2', ts: '2026-10-08T10:00:30.000Z', durationMs: 2000 }),
    { type: 'user', uuid: 'u2', timestamp: '2026-10-08T10:01:00.000Z', message: { role: 'user', content: 'next' } },
  ];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });
  assert.equal(story.turns[0].duration_ms, 3000);
  assert.equal(story.turns[0].duration_source, 'transcript');
  const prompt = story.trace.events.find((e) => e.id === 'u1');
  assert.equal(prompt.duration_ms, 3000);
});

test('turn duration falls back to wall clock up to the last finished event when the harness wrote none', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-08T10:00:00.000Z', message: { role: 'user', content: 'go' } },
    assistantBash({ uuid: 'a1', ts: '2026-10-08T10:00:01.000Z', id: 'tu1', command: 'ls' }),
    userRecord({ uuid: 'r1', ts: '2026-10-08T10:00:18.000Z', toolUseId: 'tu1', content: { stdout: 'a', stderr: '', interrupted: false } }),
  ];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });
  assert.equal(story.turns[0].duration_ms, 18000);
  assert.equal(story.turns[0].duration_source, 'derived');
  assert.equal(story.trace.events.find((e) => e.id === 'u1').ended_at, '2026-10-08T10:00:18.000Z');
});

test('turn with no finished events and no turn_duration has an unknown duration, never 0', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-08T10:00:00.000Z', message: { role: 'user', content: 'go' } },
    assistantBash({ uuid: 'a1', ts: '2026-10-08T10:00:01.000Z', id: 'tu1', command: 'ls' }),
  ];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });
  assert.equal(story.turns[0].duration_ms, null);
  assert.equal(story.turns[0].duration_source, 'unknown');
});

test('a turn_duration record before any prompt is ignored', () => {
  const records = [
    turnDurationRecord({ uuid: 's0', ts: '2026-10-08T09:59:00.000Z', durationMs: 5000 }),
    { type: 'user', uuid: 'u1', timestamp: '2026-10-08T10:00:00.000Z', message: { role: 'user', content: 'go' } },
  ];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });
  assert.equal(story.turns[0].duration_ms, null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/adapter.test.mjs`
Expected: the four new tests FAIL (`duration_ms` is `undefined`).

- [ ] **Step 3: Implement**

Import `turnDuration` from `../ir/trace.mjs`. In `buildStory`, add state next to `events`:

```js
  const harnessMs = new Map(); // turn index -> summed system/turn_duration ms
  const lastEnded = new Map(); // turn index -> latest ended_at among its events
  const promptEvents = new Map(); // turn index -> its prompt event

  function noteEnd(event) {
    if (!event.ended_at) return;
    const prev = lastEnded.get(event.turn);
    if (!prev || Date.parse(event.ended_at) > Date.parse(prev)) lastEnded.set(event.turn, event.ended_at);
  }

  function closeTurn(turn) {
    if (!turn) return;
    const { duration_ms, duration_source } = turnDuration({
      harnessMs: harnessMs.get(turn.index),
      promptAt: turn.at,
      lastEndedAt: lastEnded.get(turn.index) || null,
    });
    turn.duration_ms = duration_ms;
    turn.duration_source = duration_source;
    const prompt = promptEvents.get(turn.index);
    if (prompt) {
      prompt.ended_at = lastEnded.get(turn.index) || null;
      prompt.duration_ms = duration_ms;
    }
  }
```

At the top of the loop body, after the `ai-title` branch (line 363):

```js
    if (record.type === 'system' && record.subtype === 'turn_duration') {
      if (currentTurn && Number.isFinite(record.durationMs)) {
        harnessMs.set(currentTurn.index, (harnessMs.get(currentTurn.index) || 0) + record.durationMs);
      }
      continue;
    }
```

In the prompt branch, call `closeTurn(currentTurn)` **before** `currentTurn = {...}`, and store the prompt event: `promptEvents.set(currentTurn.index, promptEvent)` (keep a `const promptEvent = newEvent(...)` then `events.push(promptEvent)`). Initialise the turn with `duration_ms: null, duration_source: 'unknown'` after `plan: null` so the keys always exist.

In the tool-result block from Task 2, after `finishEvent(...)`, add `noteEnd(event);`.

After the `for` loop ends (before `const startedAt = ...`): `closeTurn(currentTurn);`.

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/transcript/claude-code.mjs test/adapter.test.mjs
git commit -m "feat(trace): per-turn duration from harness turn_duration, else wall clock, else unknown"
```

---

### Task 4: Token usage, cost-state and environment

**Files:**
- Modify: `src/ir/trace.mjs` (add usage helpers)
- Modify: `src/transcript/claude-code.mjs`
- Test: `test/trace.test.mjs`, `test/adapter.test.mjs`

**Interfaces:**
- Produces in `trace.mjs`: `newUsageAcc() → acc`, `noteUsage(acc, record)`, `usageTotals(acc) → usage|null`, `pickCostState(record) → cost_state`.
- Produces on the story: `turns[].usage`, `trace.cost_states[]`, `environment = { agent: { name: 'Claude Code', version }, models }`.

- [ ] **Step 1: Write the failing tests**

In `test/trace.test.mjs`:

```js
import { newUsageAcc, noteUsage, usageTotals, pickCostState } from '../src/ir/trace.mjs';

test('usage is counted once per API call even though each content block is its own record', () => {
  const usage = { input_tokens: 2, output_tokens: 278, cache_creation_input_tokens: 18435, cache_read_input_tokens: 25520 };
  const acc = newUsageAcc();
  noteUsage(acc, { type: 'assistant', uuid: 'a1', message: { id: 'msg_1', model: 'claude-opus-5-5', usage } });
  noteUsage(acc, { type: 'assistant', uuid: 'a2', message: { id: 'msg_1', model: 'claude-opus-5-5', usage } });
  noteUsage(acc, { type: 'assistant', uuid: 'a3', message: { id: 'msg_2', model: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: 22 } } });
  assert.deepEqual(usageTotals(acc), {
    input_tokens: 3, output_tokens: 300, cache_read_tokens: 25520, cache_creation_tokens: 18435,
    api_calls: 2, models: ['claude-opus-5-5'], complete: true,
  });
});

test('usage is incomplete when an API call carried no usage, and null when there were no assistant records', () => {
  const acc = newUsageAcc();
  noteUsage(acc, { type: 'assistant', uuid: 'a1', message: { id: 'msg_1', model: 'claude-opus-5-5' } });
  assert.equal(usageTotals(acc).complete, false);
  assert.equal(usageTotals(newUsageAcc()), null);
  noteUsage(acc, { type: 'user', uuid: 'u1', message: { role: 'user', content: 'x' } });
  assert.equal(usageTotals(acc).api_calls, 0);
});

test('pickCostState keeps the totals and per-model usage, with nulls for missing numbers', () => {
  assert.deepEqual(pickCostState({ type: 'cost-state', totalCostUSD: 0.75, modelUsage: { 'claude-opus-5-5': { inputTokens: 1 } } }), {
    total_cost_usd: 0.75, total_api_duration_ms: null, total_tool_duration_ms: null,
    model_usage: { 'claude-opus-5-5': { inputTokens: 1 } }, has_unknown_model_cost: false,
  });
});
```

In `test/adapter.test.mjs`:

```js
test('each turn carries its deduped usage, and the story its environment', () => {
  const usage = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 100, cache_read_input_tokens: 200 };
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-08T10:00:00.000Z', version: '2.1.288', message: { role: 'user', content: 'go' } },
    assistantTool({ uuid: 'a1', ts: '2026-10-08T10:00:01.000Z', id: 'tu1', name: 'Read', input: { file_path: '/proj/a.js' }, messageId: 'm1', usage, model: 'claude-opus-5-5', version: '2.1.288' }),
    { type: 'assistant', uuid: 'a1b', timestamp: '2026-10-08T10:00:01.100Z', version: '2.1.288',
      message: { id: 'm1', role: 'assistant', model: 'claude-opus-5-5', usage, content: [{ type: 'text', text: 'reading' }] } },
    { type: 'user', uuid: 'u2', timestamp: '2026-10-08T10:01:00.000Z', message: { role: 'user', content: 'again' } },
    assistantTool({ uuid: 'a2', ts: '2026-10-08T10:01:01.000Z', id: 'tu2', name: 'Read', input: { file_path: '/proj/b.js' }, messageId: 'm2', usage: { input_tokens: 1, output_tokens: 2 }, model: 'claude-haiku-4-5-20251001', version: '2.1.289' }),
    { type: 'user', uuid: 'u3', timestamp: '2026-10-08T10:02:00.000Z', message: { role: 'user', content: 'unanswered' } },
  ];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });
  assert.deepEqual(story.turns[0].usage, { input_tokens: 10, output_tokens: 5, cache_read_tokens: 200, cache_creation_tokens: 100, api_calls: 1, models: ['claude-opus-5-5'], complete: true });
  assert.equal(story.turns[1].usage.models[0], 'claude-haiku-4-5-20251001');
  assert.equal(story.turns[2].usage, null);
  assert.deepEqual(story.environment, { agent: { name: 'Claude Code', version: '2.1.289' }, models: ['claude-haiku-4-5-20251001', 'claude-opus-5-5'] });
});

test('a cost-state record lands on trace.cost_states and is not an event', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-08T10:00:00.000Z', message: { role: 'user', content: 'go' } },
    { type: 'cost-state', sessionId: 's1', totalCostUSD: 0.05, totalAPIDuration: 9000, totalToolDuration: 11000,
      modelUsage: { 'claude-opus-5-5': { inputTokens: 30, outputTokens: 65, cacheReadInputTokens: 1100, cacheCreationInputTokens: 100, costUSD: 0.05 } },
      hasUnknownModelCost: false },
  ];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj' });
  assert.equal(story.trace.events.length, 1);
  assert.equal(story.trace.cost_states.length, 1);
  assert.equal(story.trace.cost_states[0].total_cost_usd, 0.05);
  assert.equal(story.trace.cost_states[0].total_api_duration_ms, 9000);
});

test('environment has a null version and no models when the records carry none', () => {
  const story = buildStory([
    { type: 'user', uuid: 'u1', timestamp: '2026-10-08T10:00:00.000Z', message: { role: 'user', content: 'go' } },
  ], { sessionId: 's1', cwd: '/proj' });
  assert.deepEqual(story.environment, { agent: { name: 'Claude Code', version: null }, models: [] });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/trace.test.mjs test/adapter.test.mjs`
Expected: FAIL — `newUsageAcc` is not exported; `story.turns[0].usage` undefined.

- [ ] **Step 3: Implement the helpers in `src/ir/trace.mjs`**

```js
/** Accumulator for message.usage across the assistant records of one turn (or one subagent). */
export function newUsageAcc() {
  return { byMessage: new Map(), noUsage: new Set(), models: new Set() };
}

/**
 * Claude Code writes one assistant record per content block, and every
 * record of the same API call repeats the identical usage object, so the
 * usage is keyed by message.id and counted once.
 */
export function noteUsage(acc, record) {
  if (!record || record.type !== 'assistant' || !record.message) return;
  const { id, usage, model } = record.message;
  if (typeof model === 'string' && model) acc.models.add(model);
  const key = id || record.uuid;
  if (!usage || typeof usage !== 'object') {
    acc.noUsage.add(key);
    return;
  }
  acc.byMessage.set(key, usage);
}

/** Totals for the accumulator, or null when it saw no assistant records at all. */
export function usageTotals(acc) {
  if (acc.byMessage.size === 0 && acc.noUsage.size === 0) return null;
  const totals = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 };
  for (const u of acc.byMessage.values()) {
    totals.input_tokens += u.input_tokens || 0;
    totals.output_tokens += u.output_tokens || 0;
    totals.cache_read_tokens += u.cache_read_input_tokens || 0;
    totals.cache_creation_tokens += u.cache_creation_input_tokens || 0;
  }
  const complete = [...acc.noUsage].every((key) => acc.byMessage.has(key));
  return { ...totals, api_calls: acc.byMessage.size, models: [...acc.models].sort(), complete };
}

/** The session-level totals Claude Code writes in a `cost-state` record at exit. */
export function pickCostState(record) {
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    total_cost_usd: num(record.totalCostUSD),
    total_api_duration_ms: num(record.totalAPIDuration),
    total_tool_duration_ms: num(record.totalToolDuration),
    model_usage: record.modelUsage && typeof record.modelUsage === 'object' ? record.modelUsage : {},
    has_unknown_model_cost: !!record.hasUnknownModelCost,
  };
}
```

- [ ] **Step 4: Implement in `buildStory`**

Import `newUsageAcc, noteUsage, usageTotals, pickCostState`. Add state:

```js
  const usageAcc = new Map(); // turn index -> usage accumulator
  const costStates = [];
  const models = new Set();
  let version = null;
```

At the top of the loop body, before the `turn_duration` branch:

```js
    if (typeof record.version === 'string' && record.version) version = record.version;
    if (record.type === 'cost-state') {
      costStates.push(pickCostState(record));
      continue;
    }
    if (record.type === 'assistant') {
      if (record.message && typeof record.message.model === 'string') models.add(record.message.model);
      if (currentTurn) {
        if (!usageAcc.has(currentTurn.index)) usageAcc.set(currentTurn.index, newUsageAcc());
        noteUsage(usageAcc.get(currentTurn.index), record);
      }
    }
```

In `closeTurn`, add: `turn.usage = usageAcc.has(turn.index) ? usageTotals(usageAcc.get(turn.index)) : null;`. Initialise `usage: null` on the turn literal.

Return `trace: { events: sortEvents(events), cost_states: costStates }` and, after it, `environment: { agent: { name: 'Claude Code', version }, models: [...models].sort() }`.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ir/trace.mjs src/transcript/claude-code.mjs test/trace.test.mjs test/adapter.test.mjs
git commit -m "feat(trace): per-turn token usage deduped by API call, cost-state capture, environment"
```

---

### Task 5: Subagent events, async Agent results and task notifications

**Files:**
- Modify: `src/ir/trace.mjs` (add `parseTaskNotifications`)
- Modify: `src/transcript/claude-code.mjs` (`extractSubagentEdits` → `extractSubagent`, `buildStory`)
- Modify: `src/transcript/locate.mjs` (`locateSubagents` also reports the meta file)
- Modify: `bin/story.mjs` (`cmdExtract` passes `{records, meta}` per agent)
- Test: `test/trace.test.mjs`, `test/adapter.test.mjs`, `test/locate.test.mjs`

**Interfaces:**
- `parseTaskNotifications(text) → [{toolUseId, status, duration_ms}]`.
- `buildStory(records, { sessionId, cwd, subagents })` accepts, per agent id, either an array of records (today's callers and tests) or `{ records, meta }` where `meta` is the parsed `agent-<id>.meta.json` (`{agentType, description, toolUseId}`) or `null`.
- `locateSubagents(...)` keeps returning `agentId → transcript path` (unchanged signature; callers derive the meta path by replacing `.jsonl` with `.meta.json`).
- Produces: `subagent` events gain `agent_id`, `agent_type`, `usage`, `ended_source`; subagent tool calls become `tool` events with `parent_id` = the Agent tool_use id and `agent_id`.

- [ ] **Step 1: Write the failing tests**

In `test/trace.test.mjs`:

```js
import { parseTaskNotifications } from '../src/ir/trace.mjs';

test('parseTaskNotifications reads every notification block, keyed by its tool-use-id', () => {
  const text = 'Prompt text <task-notification><task-id>ab</task-id><tool-use-id>toolu_09</tool-use-id>' +
    '<status>completed</status><usage><subagent_tokens>63021</subagent_tokens><tool_uses>15</tool_uses>' +
    '<duration_ms>90800</duration_ms></usage></task-notification>' +
    '<task-notification><tool-use-id>toolu_10</tool-use-id><status>failed</status></task-notification>';
  assert.deepEqual(parseTaskNotifications(text), [
    { toolUseId: 'toolu_09', status: 'completed', duration_ms: 90800 },
    { toolUseId: 'toolu_10', status: 'failed', duration_ms: null },
  ]);
  assert.deepEqual(parseTaskNotifications('no notification here'), []);
  assert.deepEqual(parseTaskNotifications(null), []);
});
```

In `test/adapter.test.mjs`:

```js
function agentLaunch({ uuid, ts, id, description }) {
  return assistantTool({ uuid, ts, id, name: 'Agent', input: { description, prompt: 'look', subagent_type: 'Explore' } });
}

function agentAsyncResult({ uuid, ts, toolUseId, agentId }) {
  return userRecord({ uuid, ts, toolUseId, content: { isAsync: true, status: 'async_launched', agentId, description: 'd' } });
}

function notification({ uuid, ts, toolUseId, status = 'completed' }) {
  return {
    type: 'queue-operation', operation: 'enqueue', uuid, timestamp: ts, sessionId: 's1',
    content: `<task-notification><task-id>${toolUseId}</task-id><tool-use-id>${toolUseId}</tool-use-id><status>${status}</status><usage><duration_ms>5000</duration_ms></usage></task-notification>`,
  };
}

const SUB_RECORDS = [
  { type: 'user', uuid: 'su1', parentUuid: null, isSidechain: true, agentId: 'ag1', timestamp: '2026-10-08T10:00:03.000Z', message: { role: 'user', content: 'look' } },
  { type: 'assistant', uuid: 'sa1', isSidechain: true, agentId: 'ag1', timestamp: '2026-10-08T10:00:04.000Z',
    message: { id: 'sm1', role: 'assistant', model: 'claude-opus-5-5', usage: { input_tokens: 5, output_tokens: 7 }, content: [{ type: 'tool_use', id: 'stu1', name: 'Read', input: { file_path: '/proj/src/a.js' } }] } },
  { type: 'user', uuid: 'sr1', isSidechain: true, agentId: 'ag1', timestamp: '2026-10-08T10:00:04.400Z',
    toolUseResult: { type: 'text', file: { filePath: '/proj/src/a.js', content: 'x', numLines: 1 } },
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'stu1', is_error: false, content: 'x' }] } },
];

test('an async Agent becomes a subagent event closed by its task notification, with its children attached', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-08T10:00:00.000Z', message: { role: 'user', content: 'go' } },
    agentLaunch({ uuid: 'a1', ts: '2026-10-08T10:00:01.000Z', id: 'tu1', description: 'Explore IR' }),
    agentAsyncResult({ uuid: 'r1', ts: '2026-10-08T10:00:02.000Z', toolUseId: 'tu1', agentId: 'ag1' }),
    notification({ uuid: 'q1', ts: '2026-10-08T10:00:20.000Z', toolUseId: 'tu1' }),
  ];
  const subagents = { ag1: { records: SUB_RECORDS, meta: { agentType: 'Explore', description: 'Explore IR', toolUseId: 'tu1' } } };
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj', subagents });
  const agent = story.trace.events.find((e) => e.id === 'tu1');
  assert.equal(agent.kind, 'subagent');
  assert.equal(agent.status, 'ok');
  assert.equal(agent.ended_at, '2026-10-08T10:00:20.000Z');
  assert.equal(agent.duration_ms, 19000);
  assert.equal(agent.ended_source, 'notification');
  assert.equal(agent.agent_id, 'ag1');
  assert.equal(agent.agent_type, 'Explore');
  assert.equal(agent.usage.output_tokens, 7);
  const child = story.trace.events.find((e) => e.id === 'stu1');
  assert.equal(child.kind, 'tool');
  assert.equal(child.parent_id, 'tu1');
  assert.equal(child.agent_id, 'ag1');
  assert.equal(child.turn, 1);
  assert.equal(child.duration_ms, 400);
  assert.equal(story.turns[0].duration_ms, 20000); // derived: the notification closed the last event
});

test('subagents passed as plain record arrays still work (no meta)', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-08T10:00:00.000Z', message: { role: 'user', content: 'go' } },
    agentLaunch({ uuid: 'a1', ts: '2026-10-08T10:00:01.000Z', id: 'tu1', description: 'Explore IR' }),
    agentAsyncResult({ uuid: 'r1', ts: '2026-10-08T10:00:02.000Z', toolUseId: 'tu1', agentId: 'ag1' }),
  ];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj', subagents: { ag1: SUB_RECORDS } });
  const agent = story.trace.events.find((e) => e.id === 'tu1');
  assert.equal(agent.agent_type, null);
  assert.equal(agent.status, 'unknown');
  assert.equal(agent.ended_at, '2026-10-08T10:00:04.400Z'); // provisional: last sidechain record
  assert.equal(agent.ended_source, 'subagent_transcript');
});

test('two Agent calls in one turn match notifications by tool-use-id, and a missing sidechain file leaves no children', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-08T10:00:00.000Z', message: { role: 'user', content: 'go' } },
    agentLaunch({ uuid: 'a1', ts: '2026-10-08T10:00:01.000Z', id: 'tu1', description: 'first' }),
    agentLaunch({ uuid: 'a2', ts: '2026-10-08T10:00:01.500Z', id: 'tu2', description: 'second' }),
    agentAsyncResult({ uuid: 'r1', ts: '2026-10-08T10:00:02.000Z', toolUseId: 'tu1', agentId: 'ag1' }),
    agentAsyncResult({ uuid: 'r2', ts: '2026-10-08T10:00:02.500Z', toolUseId: 'tu2', agentId: 'ag-missing' }),
    notification({ uuid: 'q2', ts: '2026-10-08T10:00:10.000Z', toolUseId: 'tu2', status: 'failed' }),
    notification({ uuid: 'q1', ts: '2026-10-08T10:00:20.000Z', toolUseId: 'tu1' }),
  ];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj', subagents: { ag1: SUB_RECORDS } });
  const first = story.trace.events.find((e) => e.id === 'tu1');
  const second = story.trace.events.find((e) => e.id === 'tu2');
  assert.equal(first.status, 'ok');
  assert.equal(first.ended_at, '2026-10-08T10:00:20.000Z');
  assert.equal(second.status, 'error');
  assert.equal(second.ended_at, '2026-10-08T10:00:10.000Z');
  assert.equal(second.usage, null);
  assert.equal(story.trace.events.filter((e) => e.parent_id === 'tu2').length, 0);
  assert.equal(story.trace.events.filter((e) => e.parent_id === 'tu1').length, 1);
});

test('a task notification embedded in a real prompt still closes its agent and the prompt is still a turn', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-08T10:00:00.000Z', message: { role: 'user', content: 'go' } },
    agentLaunch({ uuid: 'a1', ts: '2026-10-08T10:00:01.000Z', id: 'tu1', description: 'first' }),
    agentAsyncResult({ uuid: 'r1', ts: '2026-10-08T10:00:02.000Z', toolUseId: 'tu1', agentId: 'ag1' }),
    { type: 'user', uuid: 'u2', timestamp: '2026-10-08T10:00:30.000Z', message: { role: 'user',
      content: '<task-notification><tool-use-id>tu1</tool-use-id><status>completed</status></task-notification>now continue' } },
  ];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj', subagents: {} });
  assert.equal(story.turns.length, 2);
  assert.equal(story.turns[1].prompt, 'now continue');
  const agent = story.trace.events.find((e) => e.id === 'tu1');
  assert.equal(agent.status, 'ok');
  assert.equal(agent.ended_at, '2026-10-08T10:00:30.000Z');
});

test('a synchronous Agent result closes the subagent event from the result itself', () => {
  const records = [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-08T10:00:00.000Z', message: { role: 'user', content: 'go' } },
    agentLaunch({ uuid: 'a1', ts: '2026-10-08T10:00:01.000Z', id: 'tu1', description: 'first' }),
    userRecord({ uuid: 'r1', ts: '2026-10-08T10:00:12.000Z', toolUseId: 'tu1', content: { agentId: 'ag1', content: [{ type: 'text', text: 'done' }] } }),
  ];
  const story = buildStory(records, { sessionId: 's1', cwd: '/proj', subagents: { ag1: SUB_RECORDS } });
  const agent = story.trace.events.find((e) => e.id === 'tu1');
  assert.equal(agent.status, 'ok');
  assert.equal(agent.ended_source, 'result');
  assert.equal(agent.duration_ms, 11000);
});
```

In `test/locate.test.mjs` (follow the file's existing temp-dir setup for `locateSubagents`):

```js
test('subagent meta path is the transcript path with .meta.json in place of .jsonl', async () => {
  const { subagentMetaPath } = await import('../src/transcript/locate.mjs');
  assert.equal(subagentMetaPath('/x/subagents/agent-ab12.jsonl'), '/x/subagents/agent-ab12.meta.json');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/trace.test.mjs test/adapter.test.mjs test/locate.test.mjs`
Expected: FAIL — `parseTaskNotifications`/`subagentMetaPath` not exported; subagent events missing.

- [ ] **Step 3: Implement `parseTaskNotifications` in `src/ir/trace.mjs`**

```js
const NOTIFICATION_RE = /<task-notification>([\s\S]*?)<\/task-notification>/g;

function tagText(block, name) {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block);
  return match ? match[1].trim() : null;
}

/**
 * The harness tells the main session a background agent finished by
 * injecting a <task-notification> block (into a queue-operation record or a
 * user record). Its <tool-use-id> is the Agent tool_use that launched it.
 */
export function parseTaskNotifications(text) {
  if (typeof text !== 'string') return [];
  const out = [];
  for (const match of text.matchAll(NOTIFICATION_RE)) {
    const block = match[1];
    const toolUseId = tagText(block, 'tool-use-id');
    if (!toolUseId) continue;
    const duration = tagText(block, 'duration_ms');
    out.push({
      toolUseId,
      status: tagText(block, 'status') || 'completed',
      duration_ms: duration === null || !Number.isFinite(Number(duration)) ? null : Number(duration),
    });
  }
  return out;
}
```

- [ ] **Step 4: Implement `subagentMetaPath` in `src/transcript/locate.mjs`**

```js
/** The `agent-<id>.meta.json` the harness writes beside a subagent transcript. */
export function subagentMetaPath(transcriptPath) {
  return transcriptPath.replace(/\.jsonl$/, '.meta.json');
}
```

- [ ] **Step 5: Implement in `src/transcript/claude-code.mjs`**

Import `parseTaskNotifications` too. Rename `extractSubagentEdits` to `extractSubagent` and extend it:

```js
function extractSubagent(subRecords, cwd, agentId, { parentId, turnIndex }) {
  const edits = [];
  const bash = [];
  const errors = [];
  const events = [];
  const pending = new Map();
  const pendingBash = new Map();
  const pendingAny = new Map();
  const pendingEvents = new Map();
  const usage = newUsageAcc();
  const errorSink = { errors };

  for (const record of subRecords) {
    noteUsage(usage, record);
    for (const block of allToolUseCalls(record)) {
      pendingAny.set(block.id, { name: block.name, input: block.input });
      const command = block.name === BASH_TOOL ? ((block.input && block.input.command) || '') : null;
      const event = newEvent({
        id: block.id,
        kind: 'tool',
        turn: turnIndex,
        parentId,
        tool: block.name,
        category: command === null ? null : classifyCommand(command),
        summary: eventSummary(block.name, block.input, cwd),
        startedAt: record.timestamp || null,
        agentId,
      });
      events.push(event);
      pendingEvents.set(block.id, event);
    }
    // ... existing shell / calls handling unchanged ...
    const toolResult = toolResultFor(record);
    if (!toolResult) continue;
    const event = pendingEvents.get(toolResult.toolUseId);
    if (event) {
      finishEvent(event, record.timestamp || null, resultStatus(toolResult.isError, toolResult.result));
      pendingEvents.delete(toolResult.toolUseId);
    }
    // ... existing error / bash / edit result handling unchanged ...
  }

  return { edits, bash, errors, events, usage: usageTotals(usage), last_at: latestTimestamp(subRecords, null) };
}
```

In `buildStory`: add `const awaitingAgents = new Map(); // Agent tool_use id -> event, until its task notification` and a helper that runs at the top of the loop body (before the prompt branch, so a prompt that also carries a notification is still a turn):

```js
    const notificationText = record.type === 'queue-operation'
      ? record.content
      : (record.type === 'user' && record.message && typeof record.message.content === 'string' ? record.message.content : null);
    for (const note of parseTaskNotifications(notificationText)) {
      const agentEvent = awaitingAgents.get(note.toolUseId);
      if (!agentEvent) continue;
      finishEvent(agentEvent, record.timestamp || null, note.status === 'completed' ? 'ok' : 'error');
      agentEvent.ended_source = 'notification';
      noteEnd(agentEvent);
    }
    if (record.type === 'queue-operation') continue;
```

Replace the Task 2 tool-result block with:

```js
    const event = pendingEvents.get(toolResult.toolUseId);
    if (event) {
      const r = toolResult.result;
      if (event.kind === 'subagent') {
        event.agent_id = (r && typeof r === 'object' && r.agentId) || null;
        event.agent_type = null;
        event.usage = null;
        event.ended_source = null;
        if (r && typeof r === 'object' && r.isAsync) {
          awaitingAgents.set(event.id, event);
        } else {
          finishEvent(event, record.timestamp || null, resultStatus(toolResult.isError, r));
          event.ended_source = 'result';
          noteEnd(event);
        }
      } else {
        finishEvent(event, record.timestamp || null, resultStatus(toolResult.isError, r));
        noteEnd(event);
      }
      pendingEvents.delete(toolResult.toolUseId);
    }
```

Rewrite the `pendingAgents` branch:

```js
    if (pendingAgents.has(toolResult.toolUseId)) {
      const spawningTurn = pendingAgents.get(toolResult.toolUseId);
      const r = toolResult.result || {};
      const agentId = r.agentId;
      const entry = (subagents && subagents[agentId]) || null;
      const subRecords = Array.isArray(entry) ? entry : (entry && entry.records) || [];
      const meta = Array.isArray(entry) ? null : (entry && entry.meta) || null;
      const sub = extractSubagent(subRecords, cwd, agentId, { parentId: toolResult.toolUseId, turnIndex: spawningTurn.index });
      spawningTurn.edits.push(...sub.edits);
      spawningTurn.bash.push(...sub.bash);
      spawningTurn.errors.push(...sub.errors);
      events.push(...sub.events);
      for (const child of sub.events) noteEnd(child);
      for (const model of (sub.usage && sub.usage.models) || []) models.add(model);
      if (event && event.kind === 'subagent') {
        event.agent_type = (meta && meta.agentType) || null;
        event.usage = sub.usage;
        if (event.ended_at === null && sub.last_at) {
          event.ended_at = sub.last_at;
          event.duration_ms = msBetween(event.started_at, sub.last_at);
          event.ended_source = 'subagent_transcript';
          noteEnd(event);
        }
      }
      pendingAgents.delete(toolResult.toolUseId);
    }
```

(`event` here is the `const event = pendingEvents.get(...)` from the block above; it is still in scope because both blocks live in the same loop body. Import `msBetween`.)

- [ ] **Step 6: Pass meta from `cmdExtract` in `bin/story.mjs`**

Replace the subagent loop (lines 150–154):

```js
    const subagentPaths = await locateSubagents({ claudeDir, cwd, sessionId: link.sessionId });
    for (const [agentId, filePath] of Object.entries(subagentPaths)) {
      const sub = await parseTranscript(filePath);
      let meta = null;
      try {
        meta = JSON.parse(await readFile(subagentMetaPath(filePath), 'utf8'));
      } catch {
        meta = null; // older harness versions wrote no meta file
      }
      subagents[agentId] = { records: sub.records, meta };
    }
```

Add `subagentMetaPath` to the `locate.mjs` import and make sure `readFile` is imported from `node:fs/promises`.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/ir/trace.mjs src/transcript/claude-code.mjs src/transcript/locate.mjs bin/story.mjs test/trace.test.mjs test/adapter.test.mjs test/locate.test.mjs
git commit -m "feat(trace): subagent events with parent ids, async Agent results closed by task notifications"
```

---

### Task 6: Deterministic metrics module (`src/ir/metrics.mjs`)

**Files:**
- Create: `src/ir/metrics.mjs`
- Test: `test/metrics.test.mjs`

**Interfaces:**
- Consumes: a story with `turns`, `totals`, `session`, optional `trace`; `msBetween` from `src/ir/trace.mjs`.
- Produces: `computeMetrics(story) → metrics` (shape above), `normalizeCommand(command) → string`, `countRetries(runs) → number`, `validationState(runs) → {commands, passed, failed, final_state, last_command}`, `FINAL_STATES`, `METRIC_GROUPS`. A "run" is `{command, category, status}` built from `turns[].bash[]` joined to its event by id.

- [ ] **Step 1: Write the failing tests**

```js
// test/metrics.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMetrics, normalizeCommand, countRetries, validationState } from '../src/ir/metrics.mjs';

function run(command, status, category = 'test') {
  return { command, status, category };
}

function story({ turns = [], events = [], costStates = [], totals, session } = {}) {
  return {
    schema_version: 1,
    session: session || { id: 's1', chain: ['s1'], started_at: '2026-10-08T10:00:00.000Z', ended_at: '2026-10-08T10:00:18.500Z' },
    turns,
    files: [],
    totals: totals || { turns: turns.length, files: 1, added: 1, removed: 1, edits: 1 },
    trace: { events, cost_states: costStates },
  };
}

test('normalizeCommand collapses whitespace and drops a trailing semicolon', () => {
  assert.equal(normalizeCommand('  npm   test ;'), 'npm test');
  assert.equal(normalizeCommand('npm test -- --watch'), 'npm test -- --watch');
  assert.equal(normalizeCommand(null), '');
});

test('countRetries counts a rerun of a failed command once and not a rerun after success', () => {
  assert.equal(countRetries([run('npm test', 'error'), run('npm  test', 'ok'), run('npm test', 'ok')]), 1);
  assert.equal(countRetries([run('npm test', 'error'), run('npm test', 'error'), run('npm test', 'ok')]), 2);
  assert.equal(countRetries([run('npm test', 'error'), run('npm test -- --watch', 'ok')]), 0);
  assert.equal(countRetries([run('npm test', 'interrupted'), run('npm test', 'ok')]), 0);
});

test('validationState reports the last test/lint/build command as passed, failed, unknown, or none', () => {
  assert.deepEqual(validationState([run('npm test', 'error'), run('ls', 'ok', 'other'), run('npm test', 'ok')]),
    { commands: 2, passed: 1, failed: 1, final_state: 'passed', last_command: 'npm test' });
  assert.equal(validationState([run('npm test', 'interrupted')]).final_state, 'unknown');
  assert.equal(validationState([run('npm run lint', 'error', 'lint')]).final_state, 'failed');
  assert.deepEqual(validationState([run('ls', 'ok', 'other')]), { commands: 0, passed: 0, failed: 0, final_state: 'none', last_command: null });
});

test('computeMetrics derives execution, code, validation and reads from turns and trace', () => {
  const turns = [{
    index: 1, id: 'u1', at: '2026-10-08T10:00:00.000Z', prompt: 'go', summary: '',
    edits: [
      { id: 'tu3', rel: 'src/a.js', stats: { added: 1, removed: 1 } },
      { id: 'tu5', rel: 'src/a.js', stats: { added: 1, removed: 0 } },
      { id: 'tu6', rel: 'src/b.js', stats: { added: 0, removed: 0 }, combined_into: 1 },
    ],
    bash: [
      { id: 'tu2', command: 'npm test', category: 'test', ok: false },
      { id: 'tu4', command: 'npm test', category: 'test', ok: true },
    ],
    errors: [], plan: null, usage: null,
  }];
  const events = [
    { id: 'u1', kind: 'prompt', turn: 1, status: 'ok', tool: null, summary: 'go' },
    { id: 'tu1', kind: 'tool', turn: 1, status: 'ok', tool: 'Read', summary: 'src/a.js' },
    { id: 'tu2', kind: 'tool', turn: 1, status: 'error', tool: 'Bash', category: 'test', summary: 'npm test' },
    { id: 'tu3', kind: 'tool', turn: 1, status: 'ok', tool: 'Edit', summary: 'src/a.js' },
    { id: 'tu4', kind: 'tool', turn: 1, status: 'ok', tool: 'Bash', category: 'test', summary: 'npm test' },
    { id: 'tu5', kind: 'tool', turn: 1, status: 'rejected', tool: 'Edit', summary: 'src/a.js' },
    { id: 'tu7', kind: 'tool', turn: 1, status: 'ok', tool: 'Read', summary: 'src/a.js' },
    { id: 'tu8', kind: 'tool', turn: 1, status: 'ok', tool: 'Grep', summary: 'foo in src' },
  ];
  const m = computeMetrics(story({ turns, events, totals: { turns: 1, files: 2, added: 2, removed: 1, edits: 2 } }));
  assert.deepEqual(m.execution, { duration_ms: 18500, turns: 1, tool_calls: 7, failed_tool_calls: 1, rejected_tool_calls: 1, commands: 2, failed_commands: 1, retries: 1 });
  assert.deepEqual(m.code, { files_changed: 2, lines_added: 2, lines_removed: 1, edits: 2, files_edited_repeatedly: [{ rel: 'src/a.js', edits: 2 }] });
  assert.deepEqual(m.validation, { commands: 2, passed: 1, failed: 1, final_state: 'passed', last_command: 'npm test' });
  assert.deepEqual(m.reads, { files_read: 1, tool_calls: 3 });
});

test('computeMetrics orders runs by the trace, not by turn, so a retry across turns counts', () => {
  const turns = [
    { index: 1, id: 'u1', prompt: 'a', edits: [], bash: [{ id: 'b1', command: 'npm test', category: 'test', ok: false }] },
    { index: 2, id: 'u2', prompt: 'b', edits: [], bash: [{ id: 'b2', command: 'npm test', category: 'test', ok: true }] },
  ];
  const events = [
    { id: 'u1', kind: 'prompt', turn: 1, status: 'ok' }, { id: 'b1', kind: 'tool', turn: 1, status: 'error', tool: 'Bash', category: 'test' },
    { id: 'u2', kind: 'prompt', turn: 2, status: 'ok' }, { id: 'b2', kind: 'tool', turn: 2, status: 'ok', tool: 'Bash', category: 'test' },
  ];
  assert.equal(computeMetrics(story({ turns, events })).execution.retries, 1);
});

test('usage prefers cost-state totals and reports the cost', () => {
  const costStates = [{
    total_cost_usd: 0.05, total_api_duration_ms: 9000, total_tool_duration_ms: 11000, has_unknown_model_cost: false,
    model_usage: { 'claude-opus-5-5': { inputTokens: 30, outputTokens: 65, cacheReadInputTokens: 1100, cacheCreationInputTokens: 100, costUSD: 0.05 } },
  }];
  const m = computeMetrics(story({ costStates }));
  assert.deepEqual(m.usage, { input_tokens: 30, output_tokens: 65, cache_read_tokens: 1100, cache_creation_tokens: 100, total_cost_usd: 0.05, models: ['claude-opus-5-5'], source: 'cost-state', complete: true });
});

test('usage sums turn and subagent usage with a null cost when there is no cost-state', () => {
  const turns = [
    { index: 1, id: 'u1', prompt: 'a', edits: [], bash: [], usage: { input_tokens: 1, output_tokens: 2, cache_read_tokens: 3, cache_creation_tokens: 4, api_calls: 1, models: ['claude-opus-5-5'], complete: true } },
    { index: 2, id: 'u2', prompt: 'b', edits: [], bash: [], usage: null },
  ];
  const events = [{ id: 'ag', kind: 'subagent', turn: 1, status: 'ok', tool: 'Agent', usage: { input_tokens: 10, output_tokens: 20, cache_read_tokens: 0, cache_creation_tokens: 0, api_calls: 2, models: ['claude-haiku-4-5-20251001'], complete: false } }];
  const m = computeMetrics(story({ turns, events }));
  assert.deepEqual(m.usage, { input_tokens: 11, output_tokens: 22, cache_read_tokens: 3, cache_creation_tokens: 4, total_cost_usd: null, models: ['claude-haiku-4-5-20251001', 'claude-opus-5-5'], source: 'transcript', complete: false });
});

test('usage is all null with source none when nothing carried usage', () => {
  const m = computeMetrics(story({ turns: [{ index: 1, id: 'u1', prompt: 'a', edits: [], bash: [], usage: null }] }));
  assert.deepEqual(m.usage, { input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_creation_tokens: null, total_cost_usd: null, models: [], source: 'none', complete: false });
});

test('an old story with no trace gets nulls for trace-derived counts, numbers for code, and no 0 for an unknown duration', () => {
  const old = { schema_version: 1, session: { id: 's1', started_at: null, ended_at: null }, turns: [{ index: 1, id: 'u1', prompt: 'a', edits: [], bash: [{ id: 'b1', command: 'npm test', category: 'test', ok: true }] }], files: [], totals: { turns: 1, files: 0, added: 0, removed: 0, edits: 0 } };
  const m = computeMetrics(old);
  assert.equal(m.execution.duration_ms, null);
  assert.equal(m.execution.tool_calls, null);
  assert.equal(m.execution.commands, 1);
  assert.equal(m.validation.final_state, 'passed');
  assert.deepEqual(m.reads, { files_read: null, tool_calls: null });
  assert.equal(m.code.files_changed, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/metrics.test.mjs`
Expected: FAIL — `Cannot find module '../src/ir/metrics.mjs'`

- [ ] **Step 3: Implement `src/ir/metrics.mjs`**

```js
/**
 * Deterministic session metrics, derived from the Story IR (turns, totals)
 * and its trace events. Every leaf is a number or null; null means the
 * transcript did not carry the information, and is never written as 0.
 *
 * Definitions (also in schemas/story.schema.json):
 * - retry: a Bash run whose normalized command text equals the most recent
 *   earlier run of that text, and that earlier run ended in `error`.
 * - validation: Bash runs classified test|lint|build; final_state comes from
 *   the last one (ok -> passed, error -> failed, none -> none, else unknown).
 * - reads: Read|Glob|Grep events; files_read = distinct ok Read targets.
 */

import { msBetween } from './trace.mjs';

export const FINAL_STATES = ['passed', 'failed', 'none', 'unknown'];
export const METRIC_GROUPS = ['execution', 'code', 'validation', 'reads', 'usage'];
const VALIDATION_CATEGORIES = new Set(['test', 'lint', 'build']);
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep']);

export function normalizeCommand(command) {
  return String(command || '').replace(/\s+/g, ' ').replace(/;\s*$/, '').trim();
}

/** Bash runs in trace order (falling back to turn order), each with its event status. */
function bashRuns(story) {
  const events = (story.trace && Array.isArray(story.trace.events)) ? story.trace.events : [];
  const order = new Map(events.map((e, i) => [e.id, i]));
  const statusOf = new Map(events.map((e) => [e.id, e.status]));
  const runs = [];
  for (const turn of story.turns || []) {
    for (const b of turn.bash || []) {
      runs.push({
        command: b.command,
        category: b.category,
        status: statusOf.get(b.id) || legacyStatus(b),
        order: order.has(b.id) ? order.get(b.id) : Number.MAX_SAFE_INTEGER,
        index: runs.length,
      });
    }
  }
  runs.sort((a, b) => (a.order - b.order) || (a.index - b.index));
  return runs.map(({ command, category, status }) => ({ command, category, status }));
}

function legacyStatus(b) {
  if (b.rejected) return 'rejected';
  if (b.interrupted) return 'interrupted';
  if (b.ok === null || b.ok === undefined) return 'unknown';
  return b.ok ? 'ok' : 'error';
}

export function countRetries(runs) {
  const lastStatus = new Map();
  let retries = 0;
  for (const r of runs) {
    const key = normalizeCommand(r.command);
    if (!key) continue;
    if (lastStatus.get(key) === 'error') retries++;
    lastStatus.set(key, r.status);
  }
  return retries;
}

export function validationState(runs) {
  const v = runs.filter((r) => VALIDATION_CATEGORIES.has(r.category));
  const last = v.length > 0 ? v[v.length - 1] : null;
  let final_state = 'none';
  if (last) final_state = last.status === 'ok' ? 'passed' : last.status === 'error' ? 'failed' : 'unknown';
  return {
    commands: v.length,
    passed: v.filter((r) => r.status === 'ok').length,
    failed: v.filter((r) => r.status === 'error').length,
    final_state,
    last_command: last ? last.command : null,
  };
}

function codeMetrics(story) {
  const totals = story.totals || {};
  const counts = new Map();
  for (const turn of story.turns || []) {
    for (const edit of turn.edits || []) {
      if (edit.combined_into) continue;
      counts.set(edit.rel, (counts.get(edit.rel) || 0) + 1);
    }
  }
  const files_edited_repeatedly = [...counts]
    .filter(([, n]) => n > 1)
    .map(([rel, edits]) => ({ rel, edits }))
    .sort((a, b) => (b.edits - a.edits) || a.rel.localeCompare(b.rel));
  const num = (v) => (Number.isFinite(v) ? v : null);
  return {
    files_changed: num(totals.files),
    lines_added: num(totals.added),
    lines_removed: num(totals.removed),
    edits: num(totals.edits),
    files_edited_repeatedly,
  };
}

function readMetrics(toolEvents) {
  const reads = toolEvents.filter((e) => READ_TOOLS.has(e.tool));
  const files = new Set(reads.filter((e) => e.tool === 'Read' && e.status === 'ok').map((e) => e.summary));
  return { files_read: files.size, tool_calls: reads.length };
}

const NO_USAGE = Object.freeze({
  input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_creation_tokens: null,
  total_cost_usd: null, models: [], source: 'none', complete: false,
});

function usageFromCostStates(states, links) {
  const totals = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 };
  const models = new Set();
  let cost = 0;
  for (const s of states) {
    cost += s.total_cost_usd || 0;
    for (const [model, u] of Object.entries(s.model_usage || {})) {
      models.add(model);
      totals.input_tokens += u.inputTokens || 0;
      totals.output_tokens += u.outputTokens || 0;
      totals.cache_read_tokens += u.cacheReadInputTokens || 0;
      totals.cache_creation_tokens += u.cacheCreationInputTokens || 0;
    }
  }
  return {
    ...totals,
    total_cost_usd: cost,
    models: [...models].sort(),
    source: 'cost-state',
    complete: states.length === links && states.every((s) => !s.has_unknown_model_cost),
  };
}

function usageMetrics(story) {
  const trace = story.trace || {};
  const costStates = Array.isArray(trace.cost_states) ? trace.cost_states : [];
  const links = (story.session && Array.isArray(story.session.chain) && story.session.chain.length) || 1;
  if (costStates.length > 0) return usageFromCostStates(costStates, links);

  const turnUsage = (story.turns || []).map((t) => t.usage).filter(Boolean);
  const subagents = (Array.isArray(trace.events) ? trace.events : []).filter((e) => e.kind === 'subagent');
  const subUsage = subagents.map((e) => e.usage).filter(Boolean);
  const all = [...turnUsage, ...subUsage];
  if (all.length === 0) return { ...NO_USAGE };
  const sum = (key) => all.reduce((n, u) => n + (u[key] || 0), 0);
  return {
    input_tokens: sum('input_tokens'),
    output_tokens: sum('output_tokens'),
    cache_read_tokens: sum('cache_read_tokens'),
    cache_creation_tokens: sum('cache_creation_tokens'),
    total_cost_usd: null,
    models: [...new Set(all.flatMap((u) => u.models || []))].sort(),
    source: 'transcript',
    complete: all.every((u) => u.complete) && subUsage.length === subagents.length,
  };
}

/**
 * @param {object} story - a Story IR, with or without `trace`
 * @returns {{execution: object, code: object, validation: object, reads: object, usage: object}}
 */
export function computeMetrics(story) {
  const hasTrace = !!(story.trace && Array.isArray(story.trace.events));
  const toolEvents = hasTrace ? story.trace.events.filter((e) => e.kind !== 'prompt') : [];
  const runs = bashRuns(story);
  const session = story.session || {};
  return {
    execution: {
      duration_ms: msBetween(session.started_at, session.ended_at),
      turns: (story.turns || []).length,
      tool_calls: hasTrace ? toolEvents.length : null,
      failed_tool_calls: hasTrace ? toolEvents.filter((e) => e.status === 'error').length : null,
      rejected_tool_calls: hasTrace ? toolEvents.filter((e) => e.status === 'rejected').length : null,
      commands: runs.length,
      failed_commands: runs.filter((r) => r.status === 'error').length,
      retries: countRetries(runs),
    },
    code: codeMetrics(story),
    validation: validationState(runs),
    reads: hasTrace ? readMetrics(toolEvents) : { files_read: null, tool_calls: null },
    usage: usageMetrics(story),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/metrics.test.mjs`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/ir/metrics.mjs test/metrics.test.mjs
git commit -m "feat(metrics): deterministic execution, code, validation, reads and usage metrics"
```

---

### Task 7: Wire extraction, the brief, a trace fixture and the CLI test

**Files:**
- Modify: `bin/story.mjs` (`cmdExtract` line 121–187, `briefProjection` line 61)
- Create: `test/fixtures/trace-session.jsonl`
- Modify: `test/cli.test.mjs`, `SKILL.md`

**Interfaces:**
- `story.metrics = computeMetrics(story)` is set **after** `fillBashEditsFromGit`/`refreshDerived`/`fillGitState`, so `code` metrics include git-recovered shell edits.
- `briefProjection(story)` gains `metrics` (with `code.files_edited_repeatedly` cut to its first five), `environment`, and per turn `duration_ms` and `tool_calls` (events of that turn with `kind !== 'prompt'`).

- [ ] **Step 1: Create the fixture** `test/fixtures/trace-session.jsonl` (one JSON object per line; `cwd` is `/proj`)

```jsonl
{"type":"user","uuid":"u1","timestamp":"2026-10-08T10:00:00.000Z","version":"2.1.288","gitBranch":"main","message":{"role":"user","content":"Fix the failing test"}}
{"type":"assistant","uuid":"a1","timestamp":"2026-10-08T10:00:01.000Z","version":"2.1.288","gitBranch":"main","message":{"id":"m1","role":"assistant","model":"claude-opus-5-5","usage":{"input_tokens":10,"output_tokens":5,"cache_creation_input_tokens":100,"cache_read_input_tokens":200},"content":[{"type":"tool_use","id":"tu1","name":"Read","input":{"file_path":"/proj/src/a.js"}}]}}
{"type":"user","uuid":"r1","timestamp":"2026-10-08T10:00:02.000Z","toolUseResult":{"type":"text","file":{"filePath":"/proj/src/a.js","content":"x\n","numLines":1}},"message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu1","is_error":false,"content":"x"}]}}
{"type":"assistant","uuid":"a2","timestamp":"2026-10-08T10:00:03.000Z","version":"2.1.288","gitBranch":"main","message":{"id":"m2","role":"assistant","model":"claude-opus-5-5","usage":{"input_tokens":10,"output_tokens":20,"cache_creation_input_tokens":0,"cache_read_input_tokens":300},"content":[{"type":"tool_use","id":"tu2","name":"Bash","input":{"command":"npm test","description":"run the tests"}}]}}
{"type":"user","uuid":"r2","timestamp":"2026-10-08T10:00:10.000Z","toolUseResult":"Error: Exit code 1\n1 failing","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu2","is_error":true,"content":"Exit code 1\n1 failing"}]}}
{"type":"assistant","uuid":"a3","timestamp":"2026-10-08T10:00:11.000Z","version":"2.1.288","gitBranch":"main","message":{"id":"m3","role":"assistant","model":"claude-opus-5-5","usage":{"input_tokens":5,"output_tokens":30,"cache_creation_input_tokens":0,"cache_read_input_tokens":300},"content":[{"type":"tool_use","id":"tu3","name":"Edit","input":{"file_path":"/proj/src/a.js","old_string":"x","new_string":"y"}}]}}
{"type":"user","uuid":"r3","timestamp":"2026-10-08T10:00:12.000Z","toolUseResult":{"filePath":"/proj/src/a.js","oldString":"x","newString":"y","originalFile":"x\n","replaceAll":false,"structuredPatch":[{"oldStart":1,"oldLines":1,"newStart":1,"newLines":1,"lines":["-x","+y"]}],"userModified":false},"message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu3","is_error":false,"content":"The file has been updated."}]}}
{"type":"assistant","uuid":"a4","timestamp":"2026-10-08T10:00:13.000Z","version":"2.1.288","gitBranch":"main","message":{"id":"m4","role":"assistant","model":"claude-opus-5-5","usage":{"input_tokens":5,"output_tokens":10,"cache_creation_input_tokens":0,"cache_read_input_tokens":300},"content":[{"type":"tool_use","id":"tu4","name":"Bash","input":{"command":"npm test","description":"run the tests again"}}]}}
{"type":"user","uuid":"r4","timestamp":"2026-10-08T10:00:18.000Z","toolUseResult":{"stdout":"1 passing\n","stderr":"","interrupted":false,"isImage":false},"message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu4","is_error":false,"content":"1 passing"}]}}
{"type":"system","subtype":"turn_duration","uuid":"s1","timestamp":"2026-10-08T10:00:18.500Z","durationMs":18000,"isMeta":false}
{"type":"cost-state","sessionId":"sess-trace","totalCostUSD":0.05,"totalAPIDuration":9000,"totalToolDuration":11000,"totalDuration":18500,"modelUsage":{"claude-opus-5-5":{"inputTokens":30,"outputTokens":65,"thinkingTokens":0,"cacheReadInputTokens":1100,"cacheCreationInputTokens":100,"costUSD":0.05}},"hasUnknownModelCost":false}
```

- [ ] **Step 2: Write the failing CLI test** (append to `test/cli.test.mjs`, same temp-dir setup as the first test)

```js
test('extract writes trace, metrics and environment, and --brief carries metrics and per-turn timing', async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), 'story-cli-trace-'));
  const claudeDir = path.join(workdir, 'claude-projects');
  const slugDir = path.join(claudeDir, '-proj');
  await mkdir(slugDir, { recursive: true });
  await cp(path.join(__dirname, 'fixtures', 'trace-session.jsonl'), path.join(slugDir, 'sess-trace.jsonl'));
  const storyJsonPath = path.join(workdir, 'story.json');

  const { stdout } = await run('node', [binPath, 'extract', '--claude-dir', claudeDir, '--cwd', '/proj', '--session', 'sess-trace', '-o', storyJsonPath, '--brief']);
  const brief = JSON.parse(stdout);
  const story = JSON.parse(await readFile(storyJsonPath, 'utf8'));

  assert.equal(story.trace.events.length, 5);
  assert.deepEqual(story.trace.events.map((e) => e.id), ['u1', 'tu1', 'tu2', 'tu3', 'tu4']);
  assert.equal(story.turns[0].duration_ms, 18000);
  assert.equal(story.turns[0].duration_source, 'transcript');
  assert.equal(story.turns[0].usage.api_calls, 4);
  assert.deepEqual(story.environment, { agent: { name: 'Claude Code', version: '2.1.288' }, models: ['claude-opus-5-5'] });
  assert.deepEqual(story.metrics.execution, { duration_ms: 18500, turns: 1, tool_calls: 4, failed_tool_calls: 1, rejected_tool_calls: 0, commands: 2, failed_commands: 1, retries: 1 });
  assert.deepEqual(story.metrics.validation, { commands: 2, passed: 1, failed: 1, final_state: 'passed', last_command: 'npm test' });
  assert.deepEqual(story.metrics.reads, { files_read: 1, tool_calls: 1 });
  assert.equal(story.metrics.usage.source, 'cost-state');
  assert.equal(story.metrics.usage.total_cost_usd, 0.05);
  assert.equal(story.metrics.code.lines_added, 1);

  assert.equal(brief.metrics.execution.retries, 1);
  assert.equal(brief.metrics.usage.total_cost_usd, 0.05);
  assert.equal(brief.turns[0].duration_ms, 18000);
  assert.equal(brief.turns[0].tool_calls, 4);
  assert.equal(brief.environment.agent.version, '2.1.288');

  // non-strict validate accepts the new blocks; render still works and still has four lenses
  await run('node', [binPath, 'validate', storyJsonPath]);
  const htmlPath = path.join(workdir, 'story.html');
  await run('node', [binPath, 'render', storyJsonPath, '-o', htmlPath]);
  const html = await readFile(htmlPath, 'utf8');
  assert.match(html, /id="lens-report"/);
  assert.doesNotMatch(html, /id="lens-trace"/);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test test/cli.test.mjs`
Expected: the new test FAILS (`story.metrics` undefined).

- [ ] **Step 4: Implement in `bin/story.mjs`**

Import: `import { computeMetrics } from '../src/ir/metrics.mjs';`

In `cmdExtract`, after `if (opts.git !== false) fillGitState(story);` (line 168):

```js
  // Metrics come last: the git pass above can add edits and change totals.
  story.metrics = computeMetrics(story);
```

In `briefProjection`, add after `hints`:

```js
    environment: story.environment || null,
    metrics: story.metrics
      ? { ...story.metrics, code: { ...story.metrics.code, files_edited_repeatedly: (story.metrics.code.files_edited_repeatedly || []).slice(0, 5) } }
      : null,
```

and per turn, after `plan`:

```js
      duration_ms: t.duration_ms === undefined ? null : t.duration_ms,
      tool_calls: toolCallsInTurn(story, t.index),
```

with the helper next to `outcomeHints`:

```js
/** Tool calls (any tool, main or subagent) the trace attributes to one turn. */
function toolCallsInTurn(story, index) {
  const events = (story.trace && story.trace.events) || null;
  if (!events) return null;
  return events.filter((e) => e.turn === index && e.kind !== 'prompt').length;
}
```

- [ ] **Step 5: Update `SKILL.md` step 1** — add this sentence after the `hints` sentence (line 49): "The brief also carries `metrics` (execution, code, validation, reads, usage — deterministic counts with `null` for anything the transcript did not record), `environment` (agent version and model ids) and, per turn, `duration_ms` and `tool_calls`. Use them to inform `report.outcome` and `outcome_note`; never restate or recompute them, and never write a number the brief shows as `null`."

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add bin/story.mjs test/fixtures/trace-session.jsonl test/cli.test.mjs SKILL.md
git commit -m "feat(extract): compute metrics at extract time and expose them in the brief"
```

---

### Task 8: Validation, schema documentation and renderer regression

**Files:**
- Modify: `src/ir/validate.mjs`
- Modify: `schemas/story.schema.json`
- Test: `test/validate.test.mjs`, `test/template.test.mjs`

**Interfaces:**
- `validateStory` checks `trace`, `metrics`, `turns[].duration_source` only when present; strict mode adds nothing new.
- `renderPage` output is byte-identical with and without the new blocks (the Phase 2 renderer will be the first to read them).

- [ ] **Step 1: Write the failing tests**

In `test/validate.test.mjs`:

```js
test('accepts a story with no trace, metrics or environment (older story.json)', () => {
  assert.equal(validateStory(minimalStory()).valid, true);
});

test('accepts a well-formed trace and metrics', () => {
  const story = minimalStory({
    trace: { events: [{ id: 'u1', kind: 'prompt', turn: 1, status: 'ok' }, { id: 't1', kind: 'tool', turn: 1, status: 'unknown' }], cost_states: [] },
    metrics: { execution: {}, code: {}, validation: { final_state: 'none' }, reads: {}, usage: {} },
  });
  story.turns[0].duration_source = 'derived';
  assert.deepEqual(validateStory(story).errors, []);
});

test('rejects an event with an unknown kind or status, and a non-array events list', () => {
  const bad = minimalStory({ trace: { events: [{ id: 'x', kind: 'command', turn: 1, status: 'ok' }, { id: 'y', kind: 'tool', turn: 1, status: 'crashed' }] } });
  const result = validateStory(bad);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /trace\.events\[0\]\.kind/.test(e)));
  assert.ok(result.errors.some((e) => /trace\.events\[1\]\.status/.test(e)));
  assert.ok(validateStory(minimalStory({ trace: { events: 'nope' } })).errors.some((e) => /trace\.events must be an array/.test(e)));
});

test('rejects metrics missing a group or with an unknown final_state, and a bad duration_source', () => {
  const result = validateStory(minimalStory({ metrics: { execution: {}, code: {}, validation: { final_state: 'green' }, usage: {} } }));
  assert.ok(result.errors.some((e) => /metrics\.reads/.test(e)));
  assert.ok(result.errors.some((e) => /final_state/.test(e)));
  const story = minimalStory();
  story.turns[0].duration_source = 'guess';
  assert.ok(validateStory(story).errors.some((e) => /turns\[0\]\.duration_source/.test(e)));
});
```

In `test/template.test.mjs` (uses its `sampleStory` factory):

```js
test('renderPage output is unchanged by the Phase 1 trace, metrics and environment blocks', () => {
  const plain = sampleStory();
  const enriched = sampleStory({
    trace: { events: [{ id: 'u1', kind: 'prompt', turn: 1, status: 'ok', summary: 'x', started_at: null, ended_at: null, duration_ms: null, source: 'transcript' }], cost_states: [] },
    metrics: { execution: { turns: 1 }, code: {}, validation: { final_state: 'none' }, reads: {}, usage: {} },
    environment: { agent: { name: 'Claude Code', version: '2.1.288' }, models: [] },
  });
  assert.equal(renderPage(enriched), renderPage(plain));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/validate.test.mjs test/template.test.mjs`
Expected: the "rejects" tests FAIL (no errors reported yet); the two "accepts"/"unchanged" tests already PASS — keep them as regression pins.

- [ ] **Step 3: Implement in `src/ir/validate.mjs`**

```js
import { EVENT_KINDS, EVENT_STATUSES, DURATION_SOURCES } from './trace.mjs';
import { FINAL_STATES, METRIC_GROUPS } from './metrics.mjs';
```

Inside the turns loop, after the required-field checks:

```js
      if (turn.duration_source !== undefined && !DURATION_SOURCES.includes(turn.duration_source)) {
        errors.push(`${turnPrefix}.duration_source must be one of: ${DURATION_SOURCES.join(', ')}`);
      }
```

After the turns block, before the strict section:

```js
  // Phase 1 observability blocks are optional; when present they must be well-formed.
  if (story.trace !== undefined) {
    if (!story.trace || !Array.isArray(story.trace.events)) {
      errors.push('trace.events must be an array');
    } else {
      story.trace.events.forEach((event, i) => {
        const prefix = `trace.events[${i}]`;
        if (typeof event.id !== 'string') errors.push(`${prefix}.id must be a string`);
        if (!EVENT_KINDS.includes(event.kind)) errors.push(`${prefix}.kind must be one of: ${EVENT_KINDS.join(', ')}`);
        if (!EVENT_STATUSES.includes(event.status)) errors.push(`${prefix}.status must be one of: ${EVENT_STATUSES.join(', ')}`);
        if (event.turn !== null && !Number.isInteger(event.turn)) errors.push(`${prefix}.turn must be an integer or null`);
      });
    }
  }
  if (story.metrics !== undefined) {
    for (const group of METRIC_GROUPS) {
      if (!story.metrics || typeof story.metrics[group] !== 'object' || story.metrics[group] === null) {
        errors.push(`metrics.${group} is required when metrics is present`);
      }
    }
    const validation = story.metrics && story.metrics.validation;
    if (validation && !FINAL_STATES.includes(validation.final_state)) {
      errors.push(`metrics.validation.final_state must be one of: ${FINAL_STATES.join(', ')}`);
    }
  }
```

- [ ] **Step 4: Document the new blocks in `schemas/story.schema.json`**

Add to `properties.turns.items.properties`:

```json
"duration_ms": { "type": ["integer", "null"], "minimum": 0, "description": "How long the turn took. Summed from the harness's system/turn_duration records when present (duration_source \"transcript\"), else prompt-to-last-event wall clock (\"derived\"), else null (\"unknown\"). Never 0 for unknown." },
"duration_source": { "type": "string", "enum": ["transcript", "derived", "unknown"] },
"usage": { "type": ["object", "null"], "description": "Token usage of this turn's API calls in the main transcript, counted once per message.id (one assistant record per content block repeats the same usage). null when the turn had no assistant records.", "properties": { "input_tokens": { "type": "integer" }, "output_tokens": { "type": "integer" }, "cache_read_tokens": { "type": "integer" }, "cache_creation_tokens": { "type": "integer" }, "api_calls": { "type": "integer" }, "models": { "type": "array", "items": { "type": "string" } }, "complete": { "type": "boolean", "description": "false when some API call carried no usage object." } } }
```

Add top-level `properties`:

```json
"trace": {
  "type": "object",
  "description": "Normalized, chronological trace of the session: prompts, tool calls and subagents. ids are the transcript's own (user uuid / tool_use id), so turns[].edits[].id, bash[].id and errors[].id join to events by id.",
  "required": ["events"],
  "properties": {
    "events": { "type": "array", "items": { "type": "object", "required": ["id", "kind", "turn", "status"], "properties": {
      "id": { "type": "string" },
      "kind": { "type": "string", "enum": ["prompt", "tool", "subagent"] },
      "turn": { "type": ["integer", "null"] },
      "parent_id": { "type": ["string", "null"], "description": "For a subagent's own tool calls: the Agent tool_use event they ran under." },
      "tool": { "type": ["string", "null"] },
      "category": { "type": ["string", "null"], "enum": ["test", "lint", "build", "install", "git", "other", null], "description": "Bash only: the command classification from src/ir/commands.mjs." },
      "status": { "type": "string", "enum": ["ok", "error", "rejected", "interrupted", "unknown"], "description": "unknown when no result record arrived (interrupted session)." },
      "summary": { "type": "string", "maxLength": 200 },
      "started_at": { "type": ["string", "null"], "format": "date-time" },
      "ended_at": { "type": ["string", "null"], "format": "date-time" },
      "duration_ms": { "type": ["integer", "null"], "description": "Result timestamp minus tool_use timestamp: a latency that includes permission and hook wait, not the tool's own runtime." },
      "source": { "type": "string", "enum": ["transcript"] },
      "agent_id": { "type": "string", "description": "Set on subagent events and on events read from a subagent's transcript." },
      "agent_type": { "type": ["string", "null"] },
      "ended_source": { "type": ["string", "null"], "enum": ["result", "notification", "subagent_transcript", null] },
      "usage": { "type": ["object", "null"], "description": "Subagent events only: the subagent transcript's deduped token usage." }
    } } },
    "cost_states": { "type": "array", "description": "Claude Code's session-level cost-state records (written at session exit, so usually absent for a live session), one per joined session.", "items": { "type": "object", "properties": {
      "total_cost_usd": { "type": ["number", "null"] }, "total_api_duration_ms": { "type": ["integer", "null"] }, "total_tool_duration_ms": { "type": ["integer", "null"] },
      "model_usage": { "type": "object" }, "has_unknown_model_cost": { "type": "boolean" } } } }
  }
},
"environment": {
  "type": "object",
  "description": "Reproducibility facts read from the records themselves. Deliberately no hostname, user, home path or runtime of the extracting machine.",
  "properties": { "agent": { "type": "object", "properties": { "name": { "type": "string" }, "version": { "type": ["string", "null"] } } }, "models": { "type": "array", "items": { "type": "string" } } }
},
"metrics": {
  "type": "object",
  "description": "Deterministic session metrics from src/ir/metrics.mjs. Every leaf is a number or null; null means the transcript did not record it and is never written as 0. See that module for the retry, validation and reads definitions.",
  "required": ["execution", "code", "validation", "reads", "usage"],
  "properties": {
    "execution": { "type": "object", "properties": { "duration_ms": { "type": ["integer", "null"] }, "turns": { "type": "integer" }, "tool_calls": { "type": ["integer", "null"] }, "failed_tool_calls": { "type": ["integer", "null"] }, "rejected_tool_calls": { "type": ["integer", "null"] }, "commands": { "type": "integer" }, "failed_commands": { "type": "integer" }, "retries": { "type": "integer", "description": "Bash runs whose normalized text repeats the most recent earlier run of that text after it failed." } } },
    "code": { "type": "object", "properties": { "files_changed": { "type": ["integer", "null"] }, "lines_added": { "type": ["integer", "null"] }, "lines_removed": { "type": ["integer", "null"] }, "edits": { "type": ["integer", "null"] }, "files_edited_repeatedly": { "type": "array", "items": { "type": "object", "properties": { "rel": { "type": "string" }, "edits": { "type": "integer" } } } } } },
    "validation": { "type": "object", "properties": { "commands": { "type": "integer", "description": "Bash runs classified test, lint or build. Command count, not test-case count." }, "passed": { "type": "integer" }, "failed": { "type": "integer" }, "final_state": { "type": "string", "enum": ["passed", "failed", "none", "unknown"] }, "last_command": { "type": ["string", "null"] } } },
    "reads": { "type": "object", "properties": { "files_read": { "type": ["integer", "null"], "description": "Distinct files read with the Read tool (files read through Bash are not detected)." }, "tool_calls": { "type": ["integer", "null"], "description": "Read, Glob and Grep calls." } } },
    "usage": { "type": "object", "properties": { "input_tokens": { "type": ["integer", "null"] }, "output_tokens": { "type": ["integer", "null"] }, "cache_read_tokens": { "type": ["integer", "null"] }, "cache_creation_tokens": { "type": ["integer", "null"] }, "total_cost_usd": { "type": ["number", "null"], "description": "Only from a cost-state record; never computed from model names." }, "models": { "type": "array", "items": { "type": "string" } }, "source": { "type": "string", "enum": ["cost-state", "transcript", "none"] }, "complete": { "type": "boolean" } } }
  }
}
```

Also update the `description` of `report.outcome`'s neighbour `totals` with: "Header counts; unchanged by Phase 1 — see `metrics` for the observability counts."

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ir/validate.mjs schemas/story.schema.json test/validate.test.mjs test/template.test.mjs
git commit -m "feat(validate): optional trace/metrics checks; document Phase 1 blocks in the schema"
```

---

### Task 9: Inspect a real session (the spec's §29 gate) and record what was seen

**Files:**
- Modify: `docs/superpowers/specs/2026-10-08-transcript-record-audit.md` (append "Phase 1 inspection" section)
- Modify: `README.md` (one line in the Extract row of "How it works", and the test count in Development)

No new code. This task is the stop-and-inspect gate before any Phase 2 plan is written.

- [ ] **Step 1: Extract this very repository's latest session**

```bash
node bin/story.mjs extract --latest -o /tmp/metafyl-phase1/story.json --brief > /tmp/metafyl-phase1/brief.json
node -e 'const s=require("/tmp/metafyl-phase1/story.json"); console.log(JSON.stringify({events:s.trace.events.length, kinds:s.trace.events.reduce((a,e)=>(a[e.kind]=(a[e.kind]||0)+1,a),{}), statuses:s.trace.events.reduce((a,e)=>(a[e.status]=(a[e.status]||0)+1,a),{}), unknownDurations:s.turns.filter(t=>t.duration_source==="unknown").length, env:s.environment, metrics:s.metrics},null,2))'
```

Check, by hand: every turn in the brief has a plausible `duration_ms`; `tool_calls` per turn matches what the session did; subagent events (this planning session launched four) have `agent_type` and children; `metrics.usage.source` is `transcript` (live session, no cost-state) with `complete: true`; nothing shows `0` where the transcript was silent.

- [ ] **Step 2: Extract a finished session that has a `cost-state` record** (`grep -l '"cost-state"' ~/.claude/projects/-Users-nalaj-Development-AI-metafyl/*.jsonl | head -1`, pass its id with `--session`) and confirm `metrics.usage.source === "cost-state"` and `total_cost_usd` matches the record's `totalCostUSD`.

- [ ] **Step 3: Render both** with `node bin/story.mjs render <json> -o <html>` and open them: the page must look exactly as before (four tabs, same header numbers).

- [ ] **Step 4: Append a "Phase 1 inspection (date, session ids, what matched, what did not)" section** to the audit note. Anything that did not match becomes a bug fix in this task before commit, or an explicit limitation in the note.

- [ ] **Step 5: README** — in the "How it works" Extract row append: "…plus a chronological trace of every tool call with status and latency, per-turn durations, token usage, and deterministic metrics (the data behind the upcoming Trace view)". Update the test count in "Development" to the number `npm test` prints.

- [ ] **Step 6: Run the whole suite one last time and commit**

```bash
npm test
git add docs/superpowers/specs/2026-10-08-transcript-record-audit.md README.md
git commit -m "docs: Phase 1 inspection results and README extract note"
```

---

## Verification (end of Phase 1)

1. `npm test` passes; new test files: `test/trace.test.mjs`, `test/metrics.test.mjs`; extended: `adapter`, `validate`, `template`, `cli`, `locate`.
2. `node bin/story.mjs extract --latest -o story.json --brief` on this repo yields `trace.events` with `prompt`, `tool` and `subagent` kinds, every turn with `duration_ms`/`duration_source`, `environment.agent.version` set, `metrics.usage.source === 'transcript'`, and no `0` where the transcript was silent (spot-check `metrics.execution.duration_ms` is null only if `session.ended_at` is).
3. `node bin/story.mjs validate story.json` passes non-strict; `--strict` fails only on the Claude-written fields, as before.
4. `node bin/story.mjs render story.json -o story.html` renders the same four lenses; `test/template.test.mjs` pins that the HTML is byte-identical with and without the new blocks.
5. A pre-Phase-1 `story.json` (e.g. regenerate one from `test/fixtures/simple-session.jsonl` at commit `4f36f8f`) still validates and renders.
6. The audit note's "Phase 1 inspection" section is filled in. Only then is a Phase 2 plan written.

## Self-review notes

- Spec coverage for Phase 1 (§3, §4, §5, §6, §7, §16, §19 extraction/metrics tests, §20 Phase 1, §28, §29): every item maps to Tasks 0–9 above, with these deliberate deviations recorded in the critique: no `telemetry` block (→ `metrics`), no `runtime` fingerprint, no `rework` yet, `kind` instead of nine event types, snake_case names.
- Type consistency: `duration_source` is `transcript|derived|unknown` everywhere (trace.mjs, adapter, validate, schema, tests). `usage` key names (`cache_read_tokens`, `cache_creation_tokens`) are the same on turns, subagent events and metrics. Event `id` for a tool equals the edit/bash/error id.
- The `event` variable reused in Task 5's `pendingAgents` branch relies on both blocks being in one loop body; if the implementer extracts a helper, pass the event explicitly.
