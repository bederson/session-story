# Contributing

Issues and pull requests are welcome.

## Setup

```bash
git clone https://github.com/nalaj/metafyl && cd metafyl
npm test          # no install step; there are no dependencies
npm run smoke     # proves session-story/ works on its own, as installed
```

To try your working copy as a live skill, link it into Claude Code:

```bash
ln -sfn "$PWD/session-story" ~/.claude/skills/session-story
```

## Ground rules

- **Only `session-story/` ships.** Anything a user needs at runtime lives there; tests, scripts and the site stay outside it. Code in `session-story/` resolves paths from `import.meta.url`, never from the repo root.
- **Zero runtime dependencies**, Node.js 18.18+.
- **TDD**: add or adjust a test in `test/` with each change.
- **Never commit a real session.** Fixtures and examples are synthetic (see `scripts/demo-session.mjs`).
- The page must stay self-contained: no remote scripts, styles or fonts.

## Releasing

1. Bump the version in `session-story/package.json`, `session-story/SKILL.md` (`metadata.version`), the root `package.json`, the README badge and `site/index.html`'s footer; add a `CHANGELOG.md` entry.
2. `npm test && npm run smoke && npm run build:site`, then commit (including the refreshed `examples/story.html`).
3. `git tag -a vX.Y.Z -m "vX.Y.Z" && git push --follow-tags`. The Release workflow checks that the tag matches both versions and publishes a GitHub Release.

Users update by rerunning the install command; `npx skills add` always fetches the default branch.
