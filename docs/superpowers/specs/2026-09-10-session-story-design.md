# Session Story: shareable review artifact for Claude Code sessions

## Context

The user studied archify (tt-a1i/archify, 56.8k stars): an agent skill where the model writes a typed JSON spec and a zero-dependency Node CLI validates and compiles it into a polished, self-contained HTML file. The user wanted to build "something similar", first idea being a visual diff of Claude's changes in the current session.

Research showed that plain session diff viewers already exist in six forms, including the first-party `/diff` command (v2.1.260, per-turn tabs from FileEdit/FileWrite records), agent-diff-view, diffity, seendiff, the Claude Changes VS Code extension, and claude-code-viewer. All are live viewers for the person running the agent.

The open gap: nobody produces a **shareable, self-contained HTML record of a session** that links each prompt to the edits it caused. Git says what changed; this says what happened. The user approved this direction and the following decisions:

- Audience: all three (self-review, teammate code review, non-technical stakeholder), switchable lenses in one file.
- Trigger: slash command `/story` inside Claude Code, archify pattern.
- Data source: transcript Edit/Write tool records only (no git, no file-history).
- Harness scope v1: Claude Code only, parser behind an interface.
- Approach: skill + deterministic Node renderer; Claude only writes summaries.
- Summaries: Claude edits `story.json` directly; validate checks fields are filled.

This is a greenfield project. The working directory `/Users/nalaj/Development/AI/metafyl` is empty and not a git repo. The name "metafyl" is the folder name only; the project name is open.

## Verified facts about the data source

Verified against real transcripts on this machine (Claude Code 2.1.227 to 2.1.266):

- Session transcript: `~/.claude/projects/<cwd-slug>/<sessionId>.jsonl`. The slug is the cwd with `/` replaced by `-`.
- Every record carries `type`, `uuid`, `parentUuid`, `timestamp`, `sessionId`, `cwd`, `gitBranch`, `version`, `isSidechain`.
- **User prompt**: `type=="user"` and `message.content` is a string. Slash-command noise wraps text in `<local-command-caveat>`, `<command-name>`, `<local-command-stdout>`; skip these. The `last-prompt` record type holds the latest prompt text; `ai-title` holds a generated session title (may be absent).
- **Tool call**: `type=="assistant"`, `message.content[]` with `type=="tool_use"`, `id`, `name` in {`Edit`, `Write`, `NotebookEdit`}, `input.file_path`, `input.old_string`, `input.new_string`, `input.replace_all`, `input.content`.
- **Tool result**: `type=="user"`, `message.content[0].type=="tool_result"` with `tool_use_id`, plus top-level `toolUseResult`:
  - Edit: `{filePath, oldString, newString, originalFile, replaceAll, structuredPatch, userModified}`.
  - Write: `{type: "create"|"update", filePath, content, originalFile, structuredPatch, userModified}`. For `create`, `structuredPatch` is empty and `originalFile` is empty; synthesize a single all-added hunk from `content`.
  - `structuredPatch[]` items: `{oldStart, oldLines, newStart, newLines, lines[]}` where lines are prefixed with ` `, `-`, `+`.
- **Subagents**: `~/.claude/projects/<slug>/<sessionId>/subagents/agent-<agentId>.jsonl`, records have `isSidechain: true` and `agentId`. The main transcript's `Agent` tool result has `toolUseResult.agentId` linking them to the spawning turn.
- Other record types to ignore: `attachment`, `mode`, `permission-mode`, `atis-latch`, `file-history-snapshot`.

## Deliverable layout

```
metafyl/                        # repo root
  SKILL.md                     # skill contract for Claude Code
  bin/story.mjs                # CLI entry: extract | validate | render
  src/
    transcript/
      locate.mjs               # find session file from --session / --latest / cwd
      parse.mjs                # JSONL -> records, tolerant of unknown types
      claude-code.mjs          # harness adapter: records -> Story IR
      adapter.d.ts             # interface for future harnesses (Codex, OpenCode)
    ir/
      schema.json              # JSON Schema for story.json
      validate.mjs             # schema + completeness checks (summaries present)
      cross-index.mjs          # per-file history across turns, churn flags
    render/
      template.mjs             # HTML skeleton, inline CSS/JS, theme tokens
      diff.mjs                 # unified + side-by-side hunk rendering
      highlight.mjs            # small tokenizer: js/ts, json, md, css, html, py, java, sh; plain fallback
      lenses.mjs               # review / diff / story lens markup
  test/
    fixtures/*.jsonl           # simple, subagent, interrupted, create-then-edit, slash-noise
    extract.test.mjs
    validate.test.mjs
    render.test.mjs            # smoke: output parses, lens count, hunk count == IR
  examples/story.html          # generated from a fixture, committed for the README
  README.md
```

Zero npm runtime dependencies. Node built-in test runner (`node --test`). Headless-browser smoke test is optional dev dependency (playwright) behind `npm run test:browser`.

## Story IR (story.json)

```jsonc
{
  "schema_version": 1,
  "generator": { "name": "session-story", "version": "0.1.0", "claude_code_version": "2.1.266" },
  "session": {
    "id": "...", "cwd": "...", "git_branch": "...", "title": "...|null",
    "started_at": "...", "ended_at": "...", "duration_ms": 0,
    "summary": "",                      // Claude fills; validate requires non-empty
    "blind_spots": ["shell-made changes not tracked"]
  },
  "turns": [{
    "index": 1, "id": "<user uuid>", "at": "...",
    "prompt": "full text", "summary": "",   // Claude fills one sentence
    "edits": [{
      "id": "<tool_use id>", "tool": "Edit|Write|NotebookEdit",
      "file": "/abs/path", "rel": "relative/to/cwd",
      "kind": "create|update|delete?", "by_subagent": "agentId|null",
      "user_modified_before": false, "result": "ok|unknown",
      "hunks": [{ "old_start": 1, "old_lines": 14, "new_start": 1, "new_lines": 32, "lines": ["-...", "+..."] }],
      "stats": { "added": 0, "removed": 0 }
    }]
  }],
  "files": [{ "rel": "...", "language": "ts", "turns": [1, 4], "churn": true, "stats": {...} }],
  "totals": { "turns": 0, "files": 0, "added": 0, "removed": 0, "edits": 0 }
}
```

Hunks are stored once, under turns. `files[]` is an index only. `originalFile` is not stored in the IR (size); the renderer works from hunks alone.

## CLI

```
node bin/story.mjs extract [--session <id> | --latest] [--cwd <dir>] [-o story.json]
node bin/story.mjs validate story.json [--strict]     # --strict: summaries required
node bin/story.mjs render story.json [-o story.html] [--open] [--lens review|diff|story]
```

- `extract` with no flags: newest transcript for the current cwd slug. Includes subagent files. Exits 0 with warnings on unknown record shapes; records `claude_code_version`.
- `validate` without `--strict` allows empty summaries (standalone CLI use). With `--strict` (used by the skill) they are required.
- `render` on empty summaries falls back to first line of prompt as the turn label and omits the session summary paragraph.

## Skill flow (SKILL.md)

When the user runs `/story` or asks for a session story/recap/changelog:

1. `node bin/story.mjs extract -o <scratch>/story.json`
2. Read back only `session` and `turns[].{index,prompt,edits[].rel,edits[].kind,edits[].stats}` (use `jq` or a `--brief` flag on extract that prints this projection). Never read hunks.
3. Write one sentence per `turns[].summary` and one paragraph for `session.summary` using Edit on story.json.
4. `node bin/story.mjs validate --strict story.json`; fix and repeat on failure.
5. `node bin/story.mjs render story.json -o <cwd>/session-story-<date>.html --open`
6. Report the output path and the header numbers.

Distribution: `npx skills add <owner>/<repo> -g`, matching archify. SKILL.md frontmatter must describe triggers: "session story", "what did Claude change", "session recap", "review this session", "changelog of this session".

## Page design

Self-contained HTML, inline CSS/JS, no CDN. Dark/light from `prefers-color-scheme` with toggle. Active lens stored in URL hash (`#review`, `#diff`, `#story`).

- **Header** (all lenses): title, cwd, branch, date/duration, counts (turns, files, +/- lines), Claude session summary, blind-spot note.
- **Review lens**: left timeline of turns (prompt excerpt, intent sentence, file chips, churn marker when a later turn rewrote the same file); right pane unified hunks for selected turn. Keys: j/k turns, n/p hunks.
- **Diff lens**: left file tree; right side-by-side or unified toggle; each hunk tagged with its turn number, hover shows the prompt.
- **Story lens**: one card per turn, prompt + intent + file counts, code collapsed behind a toggle. Reads as release notes.
- Print stylesheet for Save-as-PDF. Files above a size threshold render collapsed by default.

## Error handling

- Unknown record types ignored. Tool call without result: `result: "unknown"`, rendered as "edit attempted, result unknown".
- Missing expected field: validator warning naming the field and the Claude Code version, not a crash.
- Binary or huge files: summary line, no hunks.
- No transcript found for cwd: clear message listing available project slugs.

## Non-goals for v1

Shell-made changes, git integration, other harnesses, live updating while a session runs, comment feedback back to the agent (agent-diff-view already does that), any hosted service.

## Implementation order

1. `parse.mjs` + `locate.mjs` with fixtures and tests.
2. `claude-code.mjs` adapter: turns, edits, hunks, subagents, noise filtering. Tests per fixture.
3. `schema.json` + `validate.mjs` + `cross-index.mjs`.
4. `render/` starting with header + review lens in unified view; then diff lens; then story lens; then highlight and print CSS.
5. `bin/story.mjs` wiring, `--open`, `--brief`.
6. SKILL.md, README, example output, `npx skills add` layout check.

Follow TDD per step. Spec lives in this plan file because plan mode restricts writes; copy to `docs/superpowers/specs/2026-09-10-session-story-design.md` as the first commit once the repo exists.

## Verification

- `node --test` passes on all fixtures.
- `node bin/story.mjs extract --latest && validate && render --open` on this very session (`7a6c7162-6e4d-46ea-b320-3f6cbe265456`) yields a page with the plan-file Write as a turn edit.
- Run against the largest local transcript (ai-harlequins session `5dc010c4...`, 19 Edits, 1 Write, one Agent call) and confirm the subagent edits appear attributed to the spawning turn and the file tree lists `Panel.tsx` with churn across turns.
- Open the HTML in a browser with no network: all three lenses switch, themes toggle, hunk count equals `totals.edits` hunks in the JSON.
- Install via `npx skills add` from a local path and run `/story` in a fresh Claude Code session.

## Open items for the user

- Repository and package name (folder is `metafyl`; "session-story" used as placeholder).
- Whether to `git init` in `/Users/nalaj/Development/AI/metafyl` or a new folder.
