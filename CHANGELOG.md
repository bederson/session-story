# Changelog

## 0.1.0 — first public release

- `session-story` skill: extract → summarize → validate → render a Claude Code session into one self-contained HTML page with Review, Diff, Story and Report views.
- Session library in `.session-stories/` with a gallery index, session switcher, hide and delete.
- Shell-driven edits recovered from git; `/clear`-split sessions joined automatically.
- Report metrics: per-turn duration and tokens, "Where it went", cost when Claude Code recorded it.
- `export` to a PR description or a handoff for a fresh session.
- Installable with `npx skills add nalaj/metafyl --skill session-story`.
