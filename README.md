# Session Story

Turn a Claude Code session transcript into one shareable, self-contained
HTML file that links each prompt to the edits it caused.

Git tells you what changed. This tells you what happened.

An example is checked in at [`examples/story.html`](examples/story.html)
— download it and open it in a browser (GitHub's preview won't run the
page's JS).

## Why

After a long Claude Code session you have a pile of changed files. Git
shows *what* changed; it doesn't show *why*, in what order, or which
prompt caused which edit. Session Story reconstructs that link from the
session transcript and renders it as one file you can review yourself,
hand to a teammate, or send to a non-technical stakeholder — no server,
no dependencies, works with `file://`.

The page has three switchable views:

- **Review** — a timeline of turns (prompt, one-sentence intent, files
  touched) linked to that turn's diff. For reviewing your own session.
- **Diff** — a GitHub-style file tree and diff, each hunk tagged with the
  turn that produced it. For a teammate doing code review.
- **Story** — a narrative card per turn, code collapsed by default. For a
  stakeholder who wants the gist, not the diff.

## Install

```bash
npx skills add <owner>/metafyl -g
```

Or clone this repo and use `bin/story.mjs` directly. Requires
Node.js 18.18+; zero npm runtime dependencies.

## Use

Inside Claude Code, once installed as a skill:

```
/story
```

Claude extracts the current session, writes one-sentence summaries per
turn, and opens the rendered page. See [`SKILL.md`](SKILL.md) for the
exact flow.

From the command line:

```bash
node bin/story.mjs extract [--session <id>|--latest] [--cwd <dir>] -o story.json
node bin/story.mjs validate story.json [--strict]
node bin/story.mjs render story.json -o story.html [--open]
```

Run without any Claude-written summaries, `render` falls back to the
first line of each prompt as the turn's label.

## Limits (v1)

- Claude Code sessions only — Codex, Cursor, and OpenCode transcripts are
  a different format and out of scope for now.
- Only `Edit`, `Write`, and `NotebookEdit` tool calls are tracked. A file
  changed by a shell command (`sed`, a script Claude ran via `Bash`) will
  not appear — the generated page says so in its header.
- A tool call whose result never arrived (an interrupted session) is
  shown as "edit attempted, result unknown" rather than causing an error.

## How it works

`bin/story.mjs extract` locates the session transcript under
`~/.claude/projects/<slug>/<sessionId>.jsonl` (and any subagent
transcripts under `<sessionId>/subagents/`), parses it, and builds a
typed intermediate representation (`story.json`) — see
[`schemas/story.schema.json`](schemas/story.schema.json). `validate`
checks its shape and, in `--strict` mode, that every turn and the session
have a summary. `render` compiles the IR into the final HTML with inline
CSS and JS, no external requests.

Full design and the verified transcript record shapes this relies on:
[`docs/superpowers/specs/2026-09-10-session-story-design.md`](docs/superpowers/specs/2026-09-10-session-story-design.md).

## Development

```bash
npm test
```

39 tests, `node --test`, no test framework dependency. TDD throughout:
`src/transcript/` (parsing + the Claude Code adapter), `src/ir/`
(cross-indexing + validation), `src/render/` (HTML generation),
`test/cli.test.mjs` (end-to-end: extract → validate → render against a
fixture transcript).
