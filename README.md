# Session Story

**Turn a Claude Code session transcript into one shareable, self-contained HTML file — directly in chat.**

Session Story is a zero-dependency Node.js extraction and rendering pipeline for Claude Code. It parses the session transcript into typed JSON IR, cross-indexes prompts to the edits they caused, and deterministically compiles that into one HTML file with inline CSS and JS.

- **Open it and review** — a GitHub-style diff, a turn-by-turn timeline, a plain-language narrative, and a report of what happened (commands, tests, errors, decisions, outcome), switchable in one page
- **Reconstruct intent, not just diffs** — every edit is linked back to the prompt and turn that produced it, in order
- **Honest about blind spots** — an interrupted tool call or a change made by a shell command is called out in the page header instead of silently omitted
- **One file, ready to share** — no server, no build step, works straight from `file://`

![License](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)
![Agent Skill](https://img.shields.io/badge/Agent-Skill-7C3AED?style=flat-square)
![Node](https://img.shields.io/badge/node-%3E%3D18.18-339933?style=flat-square)
![Version](https://img.shields.io/badge/version-0.1.0-0891b2?style=flat-square)

Git tells you what changed. This tells you what happened.

```bash
npx skills add <owner>/metafyl -g
```

An example is checked in at [`examples/story.html`](examples/story.html) — download it and open it in a browser (GitHub's preview won't run the page's JS).

## Quick start

### 1. Install

```bash
npx skills add <owner>/metafyl -g
```

Or clone this repo and use `bin/story.mjs` directly. Requires Node.js 18.18+; zero npm runtime dependencies.

### 2. Generate a story

Inside Claude Code, once installed as a skill:

```
/story
```

Claude extracts the current session, writes one-sentence summaries per turn, and opens the rendered page. See [`SKILL.md`](SKILL.md) for the exact flow.

### 3. Review, hand off, or share

Open the generated HTML file. Switch views depending on the audience — see below.

## Every session keeps its own page

Stories land in a `.session-stories/` library in the project, one file per
session, named by date, session id, and a slug of the title:

```
.session-stories/
  index.html                                   # the gallery
  index.json                                   # the manifest it is built from
  sessions.js                                  # the sidecar the switcher reads
  2026-09-14-eb076ea5-add-a-session-browser.html
  2026-09-12-a91c3f02-fix-the-diff-lens.html
```

`index.html` lists every session — date, title, outcome, summary, turns,
files, lines added and removed, input and output tokens, and cost when
Claude Code recorded it — with a filter box and time period filters (today,
last 7 or 30 days, this or last calendar month, all time); the totals line
adds up whichever sessions are shown. Every story page
gets an "All sessions" link and a session switcher in its nav. Re-rendering
a session overwrites its own file rather than piling up copies.

None of that costs the single-file property. The switcher is fed by
`sessions.js`, loaded with `<script src>` (which works over `file://`,
unlike `fetch`); a story mailed on its own simply has no sidecar, so the
link and switcher stay hidden and the page is exactly as self-contained as
before. Pass `--library <dir>` to put the library elsewhere, or `-o <file>`
/ `--no-library` for a single standalone page and nothing else.

## Choose the right view

| View       | Best for                         | Shows                                                                                         |
| ---------- | -------------------------------- | --------------------------------------------------------------------------------------------- |
| **Review** | Reviewing your own session       | A timeline of turns — prompt, one-sentence intent, number of files changed — with the turn's prompt and Claude's text output in its panel, and its code behind an “All changes” / per-file picker |
| **Diff**   | A teammate doing code review     | A GitHub-style file tree and diff, each hunk tagged with the turn that produced it            |
| **Story**  | A stakeholder who wants the gist | A narrative card per turn with Claude's text output, code collapsed by default |
| **Report** | Anyone who wants what happened, not just what changed | Plan/intent, commands run, tests & validation, errors and how they were resolved, decisions, dependencies, git state, and outcome |
| **Trace**  | Agent and tool developers | Execution timeline of prompts, tool calls and subagents with status and latency; filters; deterministic metrics, token usage, and cost when Claude Code recorded it |

The Trace tab appears for stories extracted by this version; an older `story.json` renders without it.

Two toggles in the nav apply across the views, and persist across visits:

- **Project files only** (on by default) — hides edits to files outside the session's project directory (scratch files, temp drafts). Every count in the header, timeline, and file tree switches with it; turn off to see what's hidden and why.
- **Full file** (off by default, Review and Diff) — shows each change spliced into the complete source file it came from, instead of just the changed hunk. File state is reconstructed from the transcript where possible; a note marks a view rebuilt from the file's current disk contents as approximate.

## Why Session Story

- **Reconstructs intent, not just diffs** — links every edit back to the prompt that caused it, in the order it happened.
- **Five views, one file** — Review for you, Diff for a teammate, Story for a stakeholder, Report for anyone asking "so what actually happened", Trace for whoever builds or debugs the agent; no server needed to view any of them.
- **Zero runtime dependencies** — pure Node.js, inline CSS/JS, works over `file://`.
- **Typed IR, validated before render** — `story.json` follows [`schemas/story.schema.json`](schemas/story.schema.json); `validate` checks its shape and, in `--strict` mode, that every turn and the session have a summary.
- **Honest about blind spots** — a tool call whose result never arrived is shown as "edit attempted, result unknown" instead of causing an error, and untracked shell edits are disclosed in the page header rather than silently dropped.

## How it works

| Step          | What happens                                                                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Extract**   | Locates the session transcript (and any subagent transcripts) under `~/.claude/projects/<slug>/`, parses it, and builds a typed IR (`story.json`) — including commands run, errors, git branch/commits, and dependency changes, all pulled straight from the transcript and git. It also records a chronological trace of every prompt, tool call and subagent with status and latency, per-turn durations, token usage (and cost, when Claude Code has written it), and deterministic metrics: the data behind the upcoming Trace view. Anything the transcript did not record stays `null`, never 0. |
| **Summarize** | Claude fills in the session summary, one-sentence turn intents, and the report narrative (plan, decisions, outcome), read from the `--brief` projection only — never the full transcript. |
| **Validate**  | Checks the IR's shape and, in `--strict` mode, that every turn, the session, and the report have their required fields filled in.                        |
| **Render**    | Compiles the IR into one self-contained HTML file with inline CSS and JS — no external requests, no template step left undone.                           |

Command-line equivalent of the full flow:

```bash
node bin/story.mjs extract [--session <id>|--latest] [--cwd <dir>] [--no-chain] -o story.json
node bin/story.mjs validate story.json [--strict]
node bin/story.mjs render story.json [--library <dir>|-o story.html|--no-library] [--open]
```

Run without any Claude-written summaries, `render` falls back to the first line of each prompt as the turn's label.

## Limits (v1)

- Claude Code sessions only — Codex, Cursor, and OpenCode transcripts are a different format and out of scope for now.
- `Edit`, `Write`, and `NotebookEdit` calls come from the transcript, which carries their diffs. `Bash` results do not, so shell-driven changes (`sed -i`, a heredoc script, `prettier --write`) are recovered from git: the tree is diffed from the commit the repo was on when the session started through to the working tree (so changes the session committed are included), files already dirty before the session are filtered out by mtime, and each change is credited to the turn whose commands account for it. These edits are marked "via shell" on the page. They inherit git's blind spots — a file edited again after the session shows both changes, and a commit made during the session by someone else is indistinguishable from the session's own — so the page states that too. `extract --no-git` skips the pass, and with it the Report lens's git state (its commands, tests, errors, and dependency sections still come from the transcript alone).
- `/clear` does not continue a session, it starts a new transcript file, so the work before it would otherwise be missing from the story. Sessions split that way are joined automatically: the predecessor is found by its file mtime, which Claude Code lands on the `/clear` record's timestamp, and the chain is followed back as far as it goes. `session.chain` lists the joined ids oldest first and the page header names them. `extract --no-chain` extracts the one session alone.
- A tool call whose result never arrived (an interrupted session) is shown as "edit attempted, result unknown" rather than causing an error; one whose result was an error is shown as "edit failed" with the error message.
- The Report lens's plan, decisions, outcome, and error resolutions are Claude's judgement calls, seeded by extracted hints — not something the extractor verifies on its own.

## Reference and scope

- [Skill definition](SKILL.md) · [Schema](schemas/story.schema.json) · [Example output](examples/story.html)
- Full design and the verified transcript record shapes this relies on: [`docs/superpowers/specs/2026-09-10-session-story-design.md`](docs/superpowers/specs/2026-09-10-session-story-design.md)

Automatic Codex/Cursor/OpenCode transcript support, a hosted viewer, and WYSIWYG editing are intentionally outside the current scope.

## Development

```bash
npm test
```

281 tests, `node --test`, no test framework dependency. TDD throughout: `src/transcript/` (parsing + the Claude Code adapter), `src/ir/` (cross-indexing, dependency and git-state extraction, validation), `src/render/` (HTML generation, including the Report lens), `test/cli.test.mjs` (end-to-end: extract → validate → render against fixture transcripts).

## License

MIT — free to use, modify, and distribute.
