/**
 * Report lens: the story of the session itself, not just its diffs -
 * intent, commands, tests, errors, decisions, dependencies, git state, and
 * outcome. Everything here is either read straight off `turns[].bash` /
 * `turns[].errors` (deterministic) or off `report.*` (Claude's judgement,
 * seeded by the `--brief` hints - see SKILL.md).
 */

import { escapeHtml } from './diff.mjs';
import { icon } from './icons.mjs';
import { plural } from './lenses.mjs';

const OUTCOME_LABELS = { completed: 'Completed', partial: 'Partial', failed: 'Failed', blocked: 'Blocked' };
const VALIDATION_CATEGORIES = new Set(['test', 'lint', 'build']);

function emptyReport() {
  return {
    plan: '', decisions: [], outcome: null, outcome_note: null,
    dependencies: { manifests: [], installs: [], config_files: [] },
    git: null,
  };
}

function noneRecorded() {
  return `<p class="report-empty">None recorded.</p>`;
}

function section(iconName, title, body) {
  return (
    `<section class="report-block">` +
    `<h2>${icon(iconName)}<span>${title}</span></h2>` +
    body +
    `</section>`
  );
}

function statusDot(ok) {
  if (ok === true) return `<span class="cmd-status ok">${icon('check')}</span>`;
  if (ok === false) return `<span class="cmd-status fail">${icon('cross')}</span>`;
  return `<span class="cmd-status unknown">${icon('warning')}</span>`;
}

/** Every bash entry across every turn, tagged with its turn index. */
function allCommands(turns) {
  const out = [];
  for (const turn of turns) {
    for (const entry of turn.bash || []) out.push({ ...entry, turnIndex: turn.index });
  }
  return out;
}

/** Every recorded tool error/rejection across every turn. */
function allErrors(turns) {
  const out = [];
  for (const turn of turns) {
    for (const entry of turn.errors || []) out.push({ ...entry, turnIndex: turn.index });
  }
  return out;
}

function renderOutcome(report, story) {
  const outcome = report.outcome;
  const pill = outcome
    ? `<span class="outcome-pill outcome-${escapeHtml(outcome)}">${OUTCOME_LABELS[outcome] || escapeHtml(outcome)}</span>`
    : `<span class="outcome-pill outcome-unknown">Outcome not recorded</span>`;
  const note = report.outcome_note ? `<p class="outcome-note">${escapeHtml(report.outcome_note)}</p>` : '';
  const summary = story.session && story.session.summary
    ? `<p class="report-summary">${escapeHtml(story.session.summary)}</p>`
    : noneRecorded();
  return section('report', 'Outcome & summary', `${pill}${note}${summary}`);
}

function renderPlan(report, turns) {
  const planHtml = report.plan
    ? `<p class="report-plan-text">${escapeHtml(report.plan)}</p>`
    : noneRecorded();
  const turnPlans = turns.filter((t) => t.plan && t.plan.text);
  const detailsHtml = turnPlans
    .map((t) => {
      const status = t.plan.approved ? 'approved' : 'not approved';
      return (
        `<details class="report-turn-plan">` +
        `<summary>${icon('plan')}Plan proposed in turn ${t.index} (${status})</summary>` +
        `<pre>${escapeHtml(t.plan.text)}</pre>` +
        `</details>`
      );
    })
    .join('');
  return section('plan', 'Plan / intent', `${planHtml}${detailsHtml}`);
}

function renderDecisions(report) {
  const decisions = report.decisions || [];
  const body = decisions.length
    ? `<ul class="report-decisions">${decisions.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>`
    : noneRecorded();
  return section('decision', 'Decisions', body);
}

function commandRow(entry, { showOutcome = false } = {}) {
  const exit = entry.exit_code !== null && entry.exit_code !== undefined
    ? `<span class="cmd-exit">exit ${entry.exit_code}</span>`
    : '';
  const statusText = showOutcome
    ? `<span class="cmd-exit">${entry.ok === true ? 'passed' : entry.ok === false ? 'failed' : 'unknown'}</span>`
    : exit;
  const output = entry.ok === false && entry.output_tail
    ? `<details class="report-test-output"><summary>output</summary><pre>${escapeHtml(entry.output_tail)}</pre></details>`
    : '';
  return (
    `<div class="cmd-row">` +
    statusDot(entry.rejected ? false : entry.ok) +
    `<span class="cmd-turn">turn ${entry.turnIndex}</span>` +
    `<span class="badge cmd-category">${escapeHtml(entry.category || 'other')}</span>` +
    `<code class="cmd-text">${escapeHtml(entry.command)}</code>` +
    statusText +
    `</div>` +
    output
  );
}

function renderCommands(turns) {
  const commands = allCommands(turns);
  if (commands.length === 0) return section('terminal', 'Commands executed', noneRecorded());
  const failed = commands.filter((c) => c.ok === false).length;
  const rows = commands.map((c) => commandRow(c)).join('');
  const summary = `<p class="report-count">${commands.length} ${plural(commands.length, 'command')}, ${failed} failed</p>`;
  return section('terminal', 'Commands executed', `${summary}${rows}`);
}

function renderTests(turns) {
  const validation = allCommands(turns).filter((c) => VALIDATION_CATEGORIES.has(c.category));
  if (validation.length === 0) return section('check', 'Tests & validation', noneRecorded());
  const last = validation[validation.length - 1];
  const lastLine = last.ok === true ? 'last run: passed' : last.ok === false ? 'last run: failed' : 'last run: unknown';
  const rows = validation.map((c) => commandRow(c, { showOutcome: true })).join('');
  return section('check', 'Tests & validation', `<p class="report-count">${lastLine}</p>${rows}`);
}

function renderErrors(turns) {
  const errors = allErrors(turns);
  if (errors.length === 0) return section('warning', 'Errors encountered', noneRecorded());
  const rows = errors
    .map((e) => (
      `<div class="error-row">` +
      `<span class="badge ${e.kind === 'rejected' ? 'badge-rejected' : 'badge-error'}">${e.kind === 'rejected' ? 'rejected' : 'error'}</span>` +
      `<span class="cmd-turn">turn ${e.turnIndex}</span>` +
      `<span class="error-tool">${escapeHtml(e.tool)}</span>` +
      (e.target ? `<code class="cmd-text">${escapeHtml(e.target)}</code>` : '') +
      `<p class="error-message">${escapeHtml(e.message)}</p>` +
      (e.resolution ? `<p class="error-resolution">${icon('check')}${escapeHtml(e.resolution)}</p>` : '') +
      `</div>`
    ))
    .join('');
  return section('warning', 'Errors encountered', rows);
}

function renderDependencies(report) {
  const deps = report.dependencies || { manifests: [], installs: [], config_files: [] };
  const hasAny = deps.manifests.length > 0 || deps.installs.length > 0 || deps.config_files.length > 0;
  if (!hasAny) return section('package', 'Dependencies', noneRecorded());

  const manifestsHtml = deps.manifests
    .map((m) => (
      `<div class="dep-manifest">` +
      `<span class="dep-rel">${escapeHtml(m.rel)}</span>` +
      (m.added.length ? `<span class="dep-added">+${m.added.map(escapeHtml).join(', ')}</span>` : '') +
      (m.removed.length ? `<span class="dep-removed">−${m.removed.map(escapeHtml).join(', ')}</span>` : '') +
      `</div>`
    ))
    .join('');
  const installsHtml = deps.installs.length
    ? `<ul class="dep-installs">${deps.installs.map((i) => `<li><code>${escapeHtml(i.command)}</code> <span class="cmd-turn">turn ${i.turn}</span></li>`).join('')}</ul>`
    : '';
  const configHtml = deps.config_files.length
    ? `<ul class="dep-config">${deps.config_files.map((c) => `<li>${escapeHtml(c.rel)}</li>`).join('')}</ul>`
    : '';
  return section('package', 'Dependencies', `${manifestsHtml}${installsHtml}${configHtml}`);
}

function shortSha(sha) {
  return sha ? sha.slice(0, 7) : '';
}

function renderGit(report) {
  const git = report.git;
  if (!git) return section('commit', 'Git state', noneRecorded());

  const branch = git.branch ? `<p class="git-branch">${icon('branch')}${escapeHtml(git.branch)}</p>` : '';
  const range = git.start_commit && git.end_commit
    ? `<p class="git-range">${icon('commit')}<code>${shortSha(git.start_commit.sha)}</code> → <code>${shortSha(git.end_commit.sha)}</code></p>`
    : '';
  const commitsHtml = git.commits && git.commits.length
    ? `<ul class="git-commits">${git.commits.map((c) => (
        `<li><code>${shortSha(c.sha)}</code> ${escapeHtml(c.subject)}` +
        (c.turn ? ` <span class="cmd-turn">turn ${c.turn}</span>` : '') +
        `</li>`
      )).join('')}</ul>`
    : '';
  const status = git.status || {};
  const statusLine = `<p class="git-status">${status.modified || 0} modified, ${status.added || 0} added, ` +
    `${status.deleted || 0} deleted, ${status.untracked || 0} untracked</p>`;

  return section('commit', 'Git state', `${branch}${range}${commitsHtml}${statusLine}`);
}

/**
 * @param {object} story - Story IR
 * @returns {string}
 */
export function renderReportLens(story) {
  const report = story.report || emptyReport();
  const turns = story.turns || [];
  return (
    `<div class="report-lens">` +
    renderOutcome(report, story) +
    renderPlan(report, turns) +
    renderDecisions(report) +
    renderCommands(turns) +
    renderTests(turns) +
    renderErrors(turns) +
    renderDependencies(report) +
    renderGit(report) +
    `</div>`
  );
}
