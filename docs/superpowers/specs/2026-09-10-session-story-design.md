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
- **User prompt**: `type=="user"` and `message.content` is a string, with the record-level flags `isMeta`, `isCompactSummary`, `isSidechain` falsy, `isVisibleInTranscript` not `false`, and no top-level `toolUseResult`. The harness also injects machine-authored text into user-role records, wrapped in balanced tags: `<local-command-caveat>`, `<command-message>`, `<command-name>`, `<command-args>`, `<local-command-stdout>`, `<local-command-stderr>`, `<system-reminder>`, `<task-notification>`, `<user-prompt-submit-hook>`. Strip every such block (they may appear before, after, or around the human text -- a `<task-notification>` for a finished background agent is a whole record of it); what remains, trimmed, is the prompt. If nothing remains, the record is not a turn. The `last-prompt` record type holds the latest prompt text; `ai-title` holds a generated session title (may be absent).
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
3. Write one sentence per `turns[].summary`, a short `session.title` and one or two sentences for `session.summary`, and (see "Report lens" below) `report.plan`/`report.decisions`/`report.outcome`/`report.outcome_note` and any `errors[].resolution` worth explaining, using Edit on story.json.
4. `node bin/story.mjs validate --strict story.json`; fix and repeat on failure.
5. `node bin/story.mjs render story.json -o <cwd>/session-story-<date>.html --open`
6. Report the output path and the header numbers.

Distribution: `npx skills add <owner>/<repo> -g`, matching archify. SKILL.md frontmatter must describe triggers: "session story", "what did Claude change", "session recap", "review this session", "changelog of this session".

## Page design

Self-contained HTML, inline CSS/JS, no CDN, no web fonts (local font stacks with fallbacks). Developer-tool aesthetic: layered surfaces, hairline borders, one indigo accent, monospace details. Dark/light from `prefers-color-scheme` with a three-state sun/moon/auto toggle whose choice persists in `localStorage` (guarded, restored in `<head>` before first paint so there is no flash). Active lens stored in URL hash (`#review`, `#diff`, `#story`). Inline SVG icons live in `render/icons.mjs` and are always decorative (`aria-hidden`) beside a text label.

- **Header** (all lenses): eyebrow, title, cwd/branch/duration+date with icons, Claude session summary, four **stat tiles** (turns, files, +added, −removed), a **session strip** (one segment per turn, width ∝ lines touched, split added/removed, empty turns dashed), blind-spot notes, and a decorative dot-grid + arcs SVG motif tinted by the accent token.
- **Review lens**: left timeline on a vertical rail with numbered nodes; each item shows the full prompt (accent-barred quote), intent sentence, a per-turn **activity bar** (added/removed segments scaled to the busiest turn, 2px gap, numeric label always shown), and file chips (churn marker when a later turn rewrote the same file). Right pane: the selected turn's edits with a panel head (edit/file counts, +/−). Keys: j/k turns, Enter/Space on a focused item, ←/→ on tabs.
- **Diff lens**: left file tree with per-file +/−; right pane per file, each hunk tagged with its turn number (hover shows the prompt). Hunks: line-number gutters, 3px add/del marker, tinted rows; code text keeps the normal text color for contrast.
- **Story lens**: one card per turn along the same rail, prompt + intent + activity bar + file count, code collapsed behind a native `<details>` toggle. Reads as release notes.
- Works with JS disabled (the `<head>` bootstrap adds `html.js`; without it all lenses and panels stack). Staggered page-load reveal, disabled under `prefers-reduced-motion`. Responsive to ~400px (grids collapse to one column). Print stylesheet expands everything and drops nav/motif for Save-as-PDF.

### Scope and view toggles

Two nav toggles, both persisted in `localStorage` and restored by the `<head>` bootstrap (no flash):

- **"Project files only"** (on by default). `edit.outside_cwd` (extract-time: true when the file's path climbs out of the session `cwd`, e.g. a scratchpad file) drives `data-outside="1"` on edits, chips, tree items, file panels, and strip segments, hidden by CSS while the toggle is on. Every scope-dependent number renders twice — `<span class="v-in">`/`<span class="v-all">`, CSS shows one — so counts never need client-side arithmetic: header stat tiles, the session strip (one strip per scope), per-turn activity bars, and panel meta. A turn or file list left empty by the filter says so (`.only-when-filtered`) instead of looking broken; the header shows a note naming how many files/edits are hidden.
- **"Full file"** (off by default, Review and Diff lenses only — the Story lens always shows just the hunks, so the toggle can never empty a card). Each edit renders both `.view-hunks` and `.view-full`; CSS shows one. The full view is built by `render/full-view.mjs`'s `spliceFullFile`: copy the pre-edit file's lines, and at each hunk's `oldStart` emit that hunk's own lines instead — no diff algorithm, so it is exact wherever a pre-edit text is known.
  - **Reconstructing that pre-edit text** (`ir/file-state.mjs`): a transcript sometimes carries a full snapshot (`originalFile` on an Edit, `content` on a Write/create). Where it doesn't, `old_string`/`new_string` on every Edit let the state be chained forward and backward from any one known snapshot in the file's edit history — each step is verified (the replaced text must occur exactly once, or the edit was `replace_all`) so a state that can't be derived exactly stays `null` rather than guessing.
  - **Disk fallback** (`ir/disk-base.mjs`, runs once at extract): a file the transcript never snapshotted at all can often still be read off disk; its current text is accepted as the end of the chain only if every edit reverses off it exactly. Views built this way are labelled `base_source: "disk"` and the page adds an "approximate — reconstructed from the file's current contents" note, since the file may have changed after the session in ways no edit mentions.
  - **Size caps**, so opting in cannot turn a shareable file into a multi-megabyte download: a file over `FULL_VIEW_MAX_LINES` (2000) or `FULL_VIEW_MAX_CHARS` (80,000) skips its full view; the page as a whole spends a fixed `FULL_VIEW_BUDGET_CHARS` (400,000) charged by rendered HTML size, reset once per `renderPage` call, so a session with many changed files still degrades to hunks-only rather than bloating the file.
  - **Out-of-project edits never attempt a splice** (`fullView: 'skip'` in `renderEdit`/`renderViews`): since they are hidden by default, spending the shared budget reconstructing files nobody will look at by default would starve the visible ones. They get a one-line placeholder instead — visible only if both toggles are on.

## Report lens

A fourth lens, added after v1 shipped, for the story of the session itself rather than only its diffs: what Claude set out to do, what ran, what broke, what was decided, what changed dependency-wise, and what git shows. Two kinds of material, both surfaced through the same `--brief` projection Claude already reads for summaries:

- **Extracted deterministically**, no judgement involved:
  - `turns[].bash[]` gains `description`, `at`, `category` (`test|lint|build|install|git|other`, from `ir/commands.mjs` classifying the command text, compound lines by priority), `ok`/`exit_code`/`rejected`/`interrupted`/`output_tail` (filled once the Bash tool_result arrives — `is_error` on the `tool_result` block, not present on success; a rejected command has `toolUseResult === 'User rejected tool use'`).
  - `turns[].errors[]`: every `is_error` tool result in the turn, any tool, main session or subagent — `{id, tool, at, kind: 'error'|'rejected', target, message, resolution}`. `resolution` starts `null`; Claude fills it in step 2 for errors that mattered.
  - `turns[].edits[].result` gains `'error'` (previously an errored Edit/Write silently looked like a successful no-op edit) with `edit.error` holding the message.
  - `turns[].plan`: captured from `ExitPlanMode`'s `input.plan` text and whether the result was approved (rejected, or any other `is_error`, counts as not approved).
  - `session.git_branch`: every transcript record carries `gitBranch`; previously read by nothing.
  - `report.dependencies` (`ir/dependencies.mjs`): manifest add/remove diffs (`package.json`, `requirements*.txt`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `Gemfile`, `composer.json` — JSON manifests diff parsed dependency keys before/after using `ir/file-state.mjs`'s chaining plus `applyReplacement` for Edit-only changes with no full snapshot; text manifests diff `+`/`-` hunk lines), `installs` (bash entries classified `install`), and `config_files` (edits to recognizable project config paths).
  - Shell edits (`ir/git-edits.mjs`) diff from the session's start commit (`sessionStartCommit`, shared with `ir/git-state.mjs`) rather than `HEAD`, so changes the session made and then committed are recovered; tracked paths come from `git diff --name-status <base>` and untracked ones from `git status`. Attribution matches a command's claimed paths to git's repo-relative ones exactly first, then by suffix (`cd api` makes a command name `tests/x.py` for `api/tests/x.py`), with absolute in-project paths normalized first. Git only has the net change per file, so when several turns wrote one file every one of them carries that same diff, with all but the last marked `combined_into: <turn>` and rendered under a note saying the diff is their combined work. Omitting the earlier turns made the page read "no file changes" for a prompt that rewrote a component; showing them an empty panel read the same way. `combined_into` edits are skipped by `countTotals` (`transcript/claude-code.mjs`) and contribute a turn but no lines to `crossIndexFiles` (`ir/cross-index.mjs`), so the lines are counted once.
  - Sessions split by `/clear` are joined (`transcript/locate.mjs`, `locateChain`, skipped by `extract --no-chain`): `/clear` starts a new transcript, and Claude Code flushes a final record into the old one as it clears, so the predecessor is the transcript whose mtime matches the `/clear` record's timestamp (±2s). The chain is followed back repeatedly; `session.chain` records the ids oldest first and a blind-spot note names them.
  - `report.git` (`ir/git-state.mjs`, skipped by `extract --no-git`): branch, the commit at session start (`git rev-list -1 --before=<started_at>`) and at extract time (`HEAD`), any commits made during the session (attributed to the turn whose `git commit` output printed that short sha), and working-tree dirty/status counts. Every step degrades to `null` rather than throwing (no repo, no commits yet, git missing).
- **Claude's judgement**, written in step 2 alongside the existing summaries, informed by hints the brief adds (`hints.outcome`: a guess from the last test/lint/build command's exit status; `hints.failed_validations`: output excerpts):
  - `report.plan` (2-4 sentences), `report.decisions` (notable technical calls), `report.outcome` (`completed|partial|failed|blocked`), `report.outcome_note` (optional), and `errors[].resolution` for errors worth explaining.

`session.summary` doubles as the page's "final summary" — no separate field — so its guidance tightens to one or two sentences (at most 240 characters) on what was actually done, not just the session's intent. `session.title`, at most 60 characters, is the heading Claude writes alongside it; strict validation requires both and enforces both limits, and without a title the header falls back to the transcript's `ai-title` (carried through as `session.ai_title`), then to the first *line* of the first prompt, both clamped to 60 characters.

Rendering (`render/report.mjs`, `renderReportLens`): eight sections in a fixed order — Outcome & summary, Plan / intent, Decisions, Commands executed, Tests & validation, Errors encountered, Dependencies, Git state — each showing "None recorded." when empty rather than being omitted, so the lens has a stable shape across sessions. It renders no hunk tables; diffs stay in Review/Diff/Story. The header gets an outcome pill next to the eyebrow and, when both a start and end commit are known, a `short_sha → short_sha` range in the meta line.

`validate --strict` additionally requires `report.plan` non-empty, `report.outcome` in the known set, and `report.decisions` to be an array; non-strict tolerates a `report` field that is missing altogether (an older `story.json`), and the renderer degrades the same way.

## Error handling

- Unknown record types ignored. Tool call without result: `result: "unknown"`, rendered as "edit attempted, result unknown". A tool result with `is_error: true`: `result: "error"` with the message, rendered as "edit failed" for edits and collected into `turns[].errors[]` for every tool.
- Missing expected field: validator warning naming the field and the Claude Code version, not a crash.
- Binary or huge files: summary line, no hunks.
- No transcript found for cwd: clear message listing available project slugs.

## Non-goals for v1

Other harnesses (Codex, Cursor, OpenCode — the IR stays agent-neutral so an adapter can be added later, but none ships here), live updating while a session runs, comment feedback back to the agent (agent-diff-view already does that), any hosted service. (Shell-made changes and git integration were originally out of scope too, but shipped post-v1 — see `ir/git-edits.mjs` and the Report lens section above.)

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
