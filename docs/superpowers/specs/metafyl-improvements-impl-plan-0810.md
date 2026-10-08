# Session Story — Agent Observability Implementation Plan

## Objective

Extend Session Story from a session reconstruction/reporting tool into a local-first coding-agent observability and debugging artifact.

The finished product must preserve the existing core architecture:

- runs locally
- no daemon
- no microservice
- no database
- no hosted dependency
- zero npm runtime dependencies
- works from Claude Code through `/story`
- CLI remains independently usable
- deterministic extraction and rendering
- Claude performs semantic analysis only where deterministic extraction is insufficient
- final output remains a standalone HTML artifact that works from `file://`
- uncertainty and unavailable telemetry must be explicitly represented rather than inferred

Do not turn Session Story into a SaaS observability platform.

The canonical artifacts remain:

```text
transcript + repository
        ↓
     extractor
        ↓
     story.json
        ↓
 semantic enrichment
        ↓
     validation
        ↓
      renderer
        ↓
     story.html
```

The existing four views remain:

- Review
- Diff
- Story
- Report

Add a fifth view:

- Trace

The first implementation should focus on making a single coding session inspectable. Cross-session evaluation and comparison come afterward.

---

# 1. Architectural Principles

## 1.1 Deterministic facts vs semantic analysis

Maintain a strict boundary.

### Deterministic extraction

Node code should calculate or extract:

- timestamps
- turn duration where timestamps permit it
- session duration
- tool calls
- tool call status
- tool call duration where timestamps permit it
- commands
- command duration where timestamps permit it
- files read
- files written
- files edited
- diff statistics
- tests executed
- test success/failure
- retries
- repeated commands
- errors
- git information
- dependencies
- model metadata when present
- token metadata when present
- usage/cost metadata when present
- subagent relationships when present
- code churn
- repeated edits
- rework
- validation coverage
- environment information available from the transcript/runtime

Never ask Claude to calculate facts that can be derived deterministically.

### Semantic enrichment

Claude may generate:

- turn intent
- session summary
- decision summaries
- error-resolution explanations
- outcome narrative
- suspected failure causes
- suspected loops/pathologies
- requirement observations
- recommendations

Semantic conclusions must be clearly distinguishable from extracted facts.

Do not present Claude-generated interpretation as deterministic telemetry.

---

# 2. Preserve Backward Compatibility

Existing story JSON files must continue rendering wherever practical.

New schema fields should therefore generally be optional.

When telemetry is unavailable:

```text
Tokens: unavailable
Cost: unavailable
Duration: unavailable
```

Do not display:

```text
Tokens: 0
Cost: $0
```

unless zero is actually known.

The renderer must tolerate partial traces.

A Claude Code transcript that does not contain model usage information must still produce a valid story.

---

# 3. Extend the Story IR

Inspect the existing schema and IR builders before modifying anything.

Extend `schemas/story.schema.json` rather than introducing a parallel trace format.

Add a session-level `telemetry` object.

Example conceptual structure:

```json
{
  "telemetry": {
    "durationMs": 258000,
    "turnCount": 23,
    "toolCalls": 47,
    "failedToolCalls": 3,
    "commands": 18,
    "failedCommands": 4,
    "filesRead": 29,
    "filesChanged": 7,
    "linesAdded": 184,
    "linesRemoved": 100,
    "testsRun": 8,
    "failedTestRuns": 3,
    "retries": 4
  }
}
```

Add optional usage:

```json
{
  "usage": {
    "inputTokens": null,
    "outputTokens": null,
    "cachedInputTokens": null,
    "totalTokens": null,
    "estimatedCostUsd": null,
    "source": "transcript"
  }
}
```

Only populate values supported by available data.

Do not fabricate cost from model names unless an explicit pricing mechanism is later introduced.

---

# 4. Introduce Trace Events

Add a normalized trace-event representation.

Example:

```json
{
  "trace": {
    "events": []
  }
}
```

Each event should have a stable ID.

Suggested event structure:

```json
{
  "id": "event-001",
  "turnId": "turn-004",
  "parentId": null,
  "type": "tool",
  "name": "Bash",
  "startedAt": "...",
  "endedAt": "...",
  "durationMs": 18432,
  "status": "error",
  "summary": "npm test",
  "source": "transcript"
}
```

Supported event types initially:

```text
user_prompt
assistant
tool
command
edit
test
error
subagent
git
```

Do not force every transcript record into a trace event.

Trace events should represent meaningful observable operations.

---

# 5. Add Provenance

Every derived metric should be explainable.

Where useful, store provenance such as:

```json
{
  "source": "transcript"
}
```

or:

```json
{
  "source": "git"
}
```

or:

```json
{
  "source": "derived"
}
```

or:

```json
{
  "source": "claude"
}
```

Potential source values:

```text
transcript
git
filesystem
derived
claude
unknown
```

This should reinforce Session Story's existing principle of explicitly exposing blind spots.

---

# 6. Environment Fingerprint

Add an optional session environment section.

Capture only what is safely and deterministically available.

Possible fields:

```json
{
  "environment": {
    "agent": {
      "name": "Claude Code",
      "version": null
    },
    "model": {
      "id": null
    },
    "runtime": {
      "node": "...",
      "platform": "...",
      "arch": "..."
    },
    "repository": {
      "branch": "...",
      "startCommit": "...",
      "endCommit": "..."
    }
  }
}
```

Do not unnecessarily capture:

- usernames
- home directory names
- machine hostnames
- environment variable values
- credentials

The environment fingerprint is for reproducibility, not machine fingerprinting.

---

# 7. Implement Deterministic Metrics

Create a dedicated metrics module rather than mixing calculations into rendering.

Suggested location:

```text
src/ir/metrics.mjs
```

or the equivalent structure matching the current codebase.

Calculate:

## Session metrics

```text
turn count
session duration
tool calls
successful tool calls
failed tool calls
commands
failed commands
files read
files changed
lines added
lines removed
test runs
failed test runs
retries
```

## Editing metrics

Calculate:

```text
files edited repeatedly
number of edits per file
total intermediate change volume
final diff volume
```

Introduce a conservative `rework` metric.

Do not invent precision that cannot be reconstructed from transcript state.

Document exactly how rework is calculated.

If reliable intermediate file states are unavailable, mark the metric unavailable rather than approximating silently.

---

# 8. Add Pathology Detection

Create:

```text
src/ir/pathologies.mjs
```

Initial deterministic detectors:

### Repeated failing command

Same or normalized-equivalent command repeatedly fails.

### Repeated edit/test cycle

Pattern such as:

```text
edit
test failure
edit
test failure
edit
test failure
```

### High file churn

Same file repeatedly modified during the session.

### Validation missing

Code changes occurred but no identifiable test/build/lint validation occurred afterward.

### Failure after final validation

Final validation command failed but session still ended.

### Repeated context read

Same file repeatedly read with no intervening modification where the transcript provides enough evidence.

Every finding must contain:

```json
{
  "type": "repeated-failure",
  "severity": "warning",
  "confidence": "high",
  "turnIds": [],
  "evidence": [],
  "summary": "..."
}
```

Avoid declaring semantic failures from weak evidence.

Prefer:

```text
Possible repeated edit/test loop
```

over:

```text
Agent got stuck
```

unless the evidence is unambiguous.

---

# 9. Add Semantic Observations

Extend the existing Claude summarization step.

Claude should receive the existing brief projection plus deterministic metrics/pathologies.

Ask Claude to produce optional observations such as:

```json
{
  "observations": [
    {
      "type": "failure-cause",
      "confidence": "medium",
      "turnIds": ["..."],
      "summary": "..."
    }
  ]
}
```

Claude should not override deterministic findings.

The prompt must explicitly instruct Claude:

- don't invent missing telemetry
- don't claim causality without evidence
- distinguish observation from fact
- cite relevant turns internally
- don't recompute deterministic metrics
- don't claim tests passed unless extracted evidence says so

---

# 10. Add the Trace View

Add a fifth top-level view:

```text
Review
Diff
Story
Report
Trace
```

Trace is primarily for coding-agent developers.

## Header

Display a compact session scorecard.

Example:

```text
Duration        4m 18s
Turns           23
Tool calls      47
Failures         3
Files changed    7
Tests            8
Retries          4
```

If token information exists:

```text
Input tokens
Output tokens
Cached tokens
```

If cost exists:

```text
Estimated cost
```

Do not reserve empty UI space for unavailable data.

---

# 11. Trace Timeline

Render events chronologically.

Example:

```text
Task: Add OAuth login

00:00  User prompt

00:08  Read repository
       ├ auth.ts
       ├ package.json
       └ auth.test.ts

00:22  Edit auth.ts

00:25  npm test
       FAIL
       OAuth callback test failed

00:51  Edit auth.ts

00:54  npm test
       PASS
```

Events should be expandable.

A user should be able to inspect:

- originating turn
- command
- result
- affected files
- associated diff
- errors
- timing
- provenance

Reuse existing diff rendering rather than creating another diff implementation.

---

# 12. Trace Filtering

Implement client-side filters.

Potential filters:

```text
All
Prompts
Tools
Commands
Edits
Tests
Errors
Subagents
```

Also allow:

```text
Failures only
```

No server-side filtering.

Everything operates against data embedded in the HTML.

---

# 13. Metrics Panel

Add a metrics section inside Trace.

Group metrics into:

### Execution

```text
duration
turns
tool calls
commands
retries
```

### Code

```text
files changed
lines added
lines removed
repeatedly edited files
rework, if available
```

### Validation

```text
tests/build/lint commands
passes
failures
final validation state
```

### Usage

Only when available:

```text
input tokens
output tokens
cached tokens
cost
```

---

# 14. Findings Panel

Show deterministic and semantic findings separately.

Example:

```text
Findings

DETECTED

⚠ Repeated failing test
  Turns 12–16

⚠ auth.ts edited 7 times

⚠ No successful validation after final edit

INTERPRETATION

◌ Possible root cause
  The first implementation appears to have misunderstood...
  Medium confidence
```

The UI must make the difference between detection and interpretation obvious.

---

# 15. `/story` Claude Code UX

Keep `/story` as the primary interface.

Default:

```text
/story
```

should generate the complete artifact including Trace.

Avoid requiring:

```text
/story --trace
```

just to get the new view.

Trace should become part of normal output.

Support useful optional arguments where the existing skill mechanism permits them.

Examples:

```text
/story
/story --no-open
/story --redact
```

Also allow natural-language focus instructions where compatible with the skill:

```text
/story focus on why tests kept failing
```

```text
/story focus on wasted work
```

```text
/story focus on agent efficiency
```

These instructions should affect semantic analysis, not deterministic extraction.

---

# 16. CLI

Preserve the existing CLI architecture.

Existing conceptual flow remains:

```bash
node bin/story.mjs extract ...
node bin/story.mjs validate ...
node bin/story.mjs render ...
```

Extend extraction so metrics and trace events are generated automatically.

Do not require a separate command to produce normal telemetry.

Optionally introduce:

```bash
node bin/story.mjs analyze story.json
```

only if there is a strong architectural reason.

Prefer keeping deterministic analysis part of extraction/IR construction.

---

# 17. Redaction

Add a deterministic redaction layer before sharing.

Implement:

```bash
story render story.json --redact
```

and Claude Code:

```text
/story --redact
```

Initial redaction targets:

- obvious API keys
- bearer tokens
- common secret formats
- absolute home-directory paths
- environment variable values where captured
- credentials embedded in URLs

Redaction must happen before HTML generation.

Never rely on hiding sensitive values with CSS or JavaScript.

The sensitive value must not exist in the generated HTML.

Produce a summary such as:

```text
Redacted:
3 potential secrets
7 absolute paths
```

Avoid storing the original values in the redaction report.

---

# 18. Standalone HTML Constraint

The generated story must continue to:

- work through `file://`
- require no HTTP server
- require no API calls
- require no CDN
- require no external JS
- require no external CSS
- require no database

Embed the required trace data into the document.

Keep the existing library/sidecar behavior compatible.

A story copied by itself must remain functional.

---

# 19. Tests

Follow the repository's existing Node test/TDD approach.

Add fixture-based tests for each capability.

## Trace extraction

Test:

- successful tool
- failed tool
- interrupted tool
- shell command
- edit
- test command
- subagent where supported
- missing timestamps
- malformed/partial records

## Metrics

Test exact expected values for:

- turns
- tools
- failures
- commands
- files
- line counts
- retries
- validation state

## Pathologies

Fixtures for:

- repeated command failure
- edit/test loop
- high churn
- missing validation
- final validation failure

Include negative tests to prevent false positives.

## Renderer

Verify:

- Trace navigation exists
- metrics render
- timeline renders
- unavailable telemetry is omitted or marked unavailable correctly
- findings render
- embedded data does not require network access

## Redaction

Test known secret patterns.

Verify secrets do not occur anywhere in the final HTML.

---

# 20. Implementation Order

Do not attempt everything simultaneously.

Implement in this sequence.

## Phase 1 — Trace foundation

1. inspect current transcript adapter and IR
2. extend schema
3. introduce trace events
4. extract timestamps/status relationships
5. add deterministic telemetry
6. add tests
7. maintain backwards compatibility

Stop and run full tests.

---

## Phase 2 — Trace UI

1. add Trace navigation
2. add scorecard
3. add chronological timeline
4. connect events to turns
5. connect edit events to existing diff rendering
6. add filters
7. test standalone `file://` behavior

Stop and run full tests.

---

## Phase 3 — Agent diagnostics

1. metrics module
2. repeated failure detection
3. edit/test loop detection
4. churn detection
5. validation detection
6. findings UI
7. provenance/confidence UI

Stop and run full tests.

---

## Phase 4 — Semantic diagnostics

1. extend brief projection
2. expose deterministic findings to Claude
3. update SKILL.md
4. add structured semantic observations
5. validate semantic output
6. render interpretations separately from deterministic findings

Stop and run full tests.

---

## Phase 5 — Privacy

1. implement redaction
2. add `--redact`
3. expose through `/story --redact`
4. add redaction summary
5. add adversarial redaction fixtures

Stop and run full tests.

---

# 21. Phase 6 — Session Comparison

Do this only after single-session Trace is stable.

Introduce:

```bash
story compare <story-a.json> <story-b.json> -o comparison.html
```

Generate a standalone comparison HTML.

Compare:

```text
outcome
duration
turns
tool calls
failed tool calls
commands
test failures
files changed
diff size
retries
rework
tokens
cost
pathologies
```

Only compare metrics available in both sessions.

Show trajectory divergence where possible.

Do not require a server.

---

# 22. Phase 7 — Evals

After comparison works, allow sessions to become regression fixtures.

Potential interface:

```bash
story eval create story.json -o eval.json
```

An eval fixture should capture:

```text
task
baseline metadata
deterministic assertions
optional thresholds
```

Potential assertions:

```text
tests pass
build passes
lint passes
allowed files
forbidden files
maximum cost
maximum duration
maximum turns
```

Do not use final-diff equality as the default definition of success.

Different implementations can be equally correct.

---

# 23. Phase 8 — Adapter Architecture

Only after the Claude Code implementation is stable, formalize the transcript adapter boundary.

Target architecture:

```text
Claude Code ─┐
Codex ───────┤
Cursor ──────┤
OpenCode ────┼──> Story IR
Custom ──────┘
```

Do not implement all adapters immediately.

Instead:

1. document adapter interface
2. isolate Claude-specific parsing
3. create fixture contract
4. document required/optional capabilities
5. allow adapters to report unsupported telemetry

The IR should not assume every coding agent exposes Claude Code's exact record types.

---

# 24. Phase 9 — Optional OpenTelemetry Export

Treat this as export interoperability, not as a runtime requirement.

Potential future command:

```bash
story export story.json --format otlp
```

Map Session Story concepts onto appropriate GenAI/agent spans where possible.

Do not introduce an OpenTelemetry runtime dependency into normal story generation.

Normal `/story` must remain completely standalone.

---

# 25. Explicitly Out of Scope for This Implementation

Do not build:

- hosted dashboard
- cloud account system
- authentication
- team management
- central database
- telemetry collector
- live monitoring daemon
- remote session storage
- billing
- hosted story viewer
- WYSIWYG editor
- real-time collaborative viewing
- eval execution farm
- Cursor/Codex/OpenCode parsers yet

Do not introduce React/Vue/Svelte or another frontend runtime.

Preserve the current lightweight HTML/CSS/JS renderer.

---

# 26. README Updates

After implementation, update the README so the primary value proposition evolves from:

```text
Git tells you what changed.
This tells you what happened.
```

without removing that line.

Explain that Session Story now captures:

```text
intent
actions
edits
tests
failures
retries
validation
outcome
```

Add Trace to the view table:

```text
Trace | Agent/tool developers | Execution timeline, tools, failures, retries, metrics and diagnostics
```

Clearly state:

```text
No server.
No daemon.
No database.
No telemetry backend.

One coding session becomes one portable HTML debugging artifact.
```

Do not claim support for tokens, cost, timing, or context information that Claude Code does not actually expose.

Document unavailable telemetry honestly.

---

# 27. Definition of Done for the First Major Milestone

The first milestone is complete when this works:

```text
> /story
```

and produces a standalone HTML file containing:

```text
Review
Diff
Story
Report
Trace
```

Trace must show, where available:

- chronological session execution
- prompts
- tool calls
- commands
- edits
- tests
- errors
- retries
- affected files
- timing
- deterministic session metrics
- detected failure patterns
- semantic observations
- provenance
- uncertainty

The resulting HTML must work after being copied to another machine and opened directly with:

```text
file://
```

No Session Story process should need to remain running.

---

# 28. Claude Code Execution Instructions

Before changing code:

1. Read `README.md`.
2. Read `SKILL.md`.
3. Read `schemas/story.schema.json`.
4. Inspect `src/transcript/`.
5. Inspect `src/ir/`.
6. Inspect `src/render/`.
7. Inspect existing fixtures and tests.
8. Read the design document referenced by the README.
9. Understand existing transcript record shapes before changing the schema.

Do not assume telemetry exists merely because this plan describes it.

Verify every proposed field against actual Claude Code transcript records and existing extraction data.

If a proposed capability cannot be reliably extracted:

1. make the field optional;
2. document the limitation;
3. do not fabricate it;
4. continue with the remainder of the implementation.

Implement incrementally using the repository's existing TDD approach.

For every phase:

```text
write failing fixture/test
        ↓
implement smallest change
        ↓
run focused tests
        ↓
run full suite
        ↓
review generated example HTML
        ↓
commit logical unit
```

Do not perform a large renderer rewrite.

Reuse existing abstractions whenever possible.

Preserve existing generated Story behavior unless a change is explicitly required.

---

# 29. First Task

Start with **Phase 1 only**.

Before writing code, produce a short implementation note containing:

1. current IR structure;
2. relevant Claude Code transcript records actually available;
3. timestamps available and their semantics;
4. model/token/usage metadata actually available;
5. existing tool/edit/test representations;
6. proposed schema changes;
7. fields from this plan that cannot currently be supported;
8. files that will be changed.

Then implement Phase 1 with tests.

Do **not** proceed automatically into Phase 2 until Phase 1 passes the complete existing test suite and the resulting `story.json` has been manually inspected for at least one representative fixture.

The architectural rule throughout the project is:

> **Extract facts. Derive what can be proven. Ask Claude to interpret what cannot. Never hide uncertainty.**
