---
name: session-story
description: Generate a self-contained HTML "session story" that links each prompt in a Claude Code session to the file edits it caused, with a review timeline, a GitHub-style diff view, and a plain-language narrative. Use when the user asks for a session recap, changelog, review artifact, "what did Claude change", or wants to share a summary of a Claude Code session with a teammate or stakeholder.
license: MIT
metadata:
  version: "0.1.0"
---

# Session Story

Turn the current (or a named) Claude Code session transcript into one
shareable HTML file: git tells you what changed, this tells you what
happened. See `docs/superpowers/specs/2026-09-10-session-story-design.md`
for the full design and the verified transcript record shapes this relies
on.

## When to use

The user asks for a session recap, a changelog of what Claude did, a
review artifact for a teammate, or literally "make a story of this
session" / "/story".

## Steps

1. **Extract.** Run the CLI to pull the session transcript (and any
   subagent transcripts) into a Story IR JSON file:
   ```bash
   node bin/story.mjs extract -o <scratch>/story.json --brief
   ```
   Use `--session <id>` for a specific session or omit it (defaults to
   `--latest`) for the current one. Pass `--cwd <dir>` if the project
   differs from the current working directory. The `--brief` flag also
   prints a projection of `session` and `turns[].{prompt, edits[].rel,
   edits[].kind, edits[].stats}` to stdout — **read only this projection,
   never the full story.json's hunks.**

2. **Summarize.** Using the brief projection from step 1, write:
   - `session.summary`: one paragraph describing the session as a whole.
   - `turns[N].summary`: one sentence of intent per turn, in the same
     order as the brief output.

   Edit these two fields directly into `<scratch>/story.json` with the
   Edit tool. Do not touch anything else in the file.

3. **Validate.**
   ```bash
   node bin/story.mjs validate <scratch>/story.json --strict
   ```
   If this reports missing summaries, go back to step 2 and fill them in.

4. **Render.**
   ```bash
   node bin/story.mjs render <scratch>/story.json -o session-story.html --open
   ```
   This writes a self-contained HTML file (no server, no dependencies)
   with three switchable views — Review (timeline + diff, for you), Diff
   (file tree, GitHub-style, for a teammate), Story (narrative cards, for
   a stakeholder) — and opens it.

5. Report the output path and the header numbers (turns, files, lines
   added/removed) to the user.

## Limits

- Claude Code sessions only (v1). Codex/Cursor/OpenCode are out of scope.
- Only `Edit`, `Write`, and `NotebookEdit` tool calls are tracked. Changes
  made through `Bash` (e.g. `sed`, a script) are invisible to this tool —
  the generated page says so in its header.
- Requires Node.js 18.18+ and no other dependencies.
