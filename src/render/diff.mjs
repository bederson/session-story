/**
 * Rendering for individual diff hunks: HTML escaping and a two-column
 * (old line / new line) table per hunk, one row per line.
 */

import { icon } from './icons.mjs';
import { renderFullFile } from './full-view.mjs';

const ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
}

function lineKind(line) {
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  return 'ctx';
}

/**
 * Render one structuredPatch hunk as an HTML <table> of lines, tracking
 * old/new line numbers as it walks the hunk.
 * @param {{oldStart: number, oldLines: number, newStart: number, newLines: number, lines: string[]}} hunk
 * @returns {string}
 */
export function renderHunk(hunk) {
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;
  const rows = hunk.lines.map((line) => {
    const kind = lineKind(line);
    const code = escapeHtml(line.slice(1));
    let oldCell = '';
    let newCell = '';
    if (kind === 'ctx') {
      oldCell = String(oldLine);
      newCell = String(newLine);
      oldLine++;
      newLine++;
    } else if (kind === 'del') {
      oldCell = String(oldLine);
      oldLine++;
    } else {
      newCell = String(newLine);
      newLine++;
    }
    return (
      `<tr class="hunk-line ${kind}">` +
      `<td class="ln old">${oldCell}</td>` +
      `<td class="ln new">${newCell}</td>` +
      `<td class="code">${code}</td>` +
      `</tr>`
    );
  });

  return `<table class="hunk">${rows.join('')}</table>`;
}

/**
 * The two ways of showing one edit's changes: just the hunks, or the whole
 * file with those same changes spliced in. Both are rendered; the page's
 * "Full file" toggle decides which is visible.
 * @param {Array<object>} hunks
 * @param {string|null} base - the file as it stood before this edit
 * @param {boolean} [approximate] - base came from the file's current disk
 *   contents rather than the transcript, so it may include later changes
 * @param {boolean|'skip'} [withFull] - render the full-file view (true),
 *   omit it entirely (false, used by the Story lens), or show a
 *   placeholder without attempting to splice one (`'skip'`, used for
 *   out-of-project edits so the shared page budget goes to project files)
 * @returns {string}
 */
const SKIP_REASONS = {
  skip: 'Full file view is not shown for files outside the project.',
  combined: 'Full file view is shown on the turn this diff is counted under.',
};

export function renderViews(hunks, base, approximate = false, withFull = true) {
  const hunksHtml = (hunks || []).map(renderHunk).join('');
  if (withFull === false) return `<div class="view view-hunks">${hunksHtml}</div>`;
  // Two reasons not to build a full-file view while still keeping the pane,
  // so the hunks/full toggle behaves the same on every edit.
  const skipped = SKIP_REASONS[withFull];
  if (skipped) {
    return (
      `<div class="view view-hunks">${hunksHtml}</div>` +
      `<div class="view view-full"><p class="edit-unknown">${icon('filter')}${skipped}</p></div>`
    );
  }
  const fullHtml = renderFullFile(typeof base === 'string' ? base : null, hunks || []);
  const full = fullHtml ||
    `<p class="edit-unknown">${icon('warning')}The full file is not available for this edit ` +
    `(the transcript did not record its contents).</p>`;

  const note = fullHtml && approximate
    ? `<p class="approx-note">${icon('warning')}Reconstructed from the file's current contents; ` +
      `lines changed after the session may appear.</p>`
    : '';

  return (
    `<div class="view view-hunks">${hunksHtml}</div>` +
    `<div class="view view-full">${note}${full}</div>`
  );
}

/**
 * Render one edit: a file header (name, create/update badge, subagent
 * badge, line counts) followed by its changes, or a note when the result
 * never arrived. Edits to files outside the project are marked so the
 * page's scope filter can hide them.
 * @param {object} edit
 * @param {{base?: string|null, fullView?: boolean|'skip'}} [opts] - reconstructed
 *   pre-edit file text, and whether to include the full-file view
 * @returns {string}
 */
/**
 * Say where a shell-driven edit came from. These are reconstructed from git
 * rather than read out of the transcript, and the link to this particular
 * prompt is an inference from the commands it ran - both worth stating on
 * the page rather than only in the story's blind spots.
 */
function provenanceNote(edit) {
  if (edit.tool !== 'Bash') return '';
  if (edit.binary) {
    return `<p class="approx-note">${icon('warning')}Binary file changed by a shell command; ` +
      `no diff is shown.</p>`;
  }
  // Several turns wrote this file through the shell. Git has one net change
  // for all of them, so the same diff appears on each - say so, or the page
  // reads as though this turn alone made every line of it.
  if (edit.combined_into) {
    return `<p class="approx-note">${icon('terminal')}A shell command in this turn changed this ` +
      `file, and so did turn ${edit.combined_into}. Git keeps only the net change across the ` +
      `session, so the diff below is their combined work, shown on both turns and counted once ` +
      `(in turn ${edit.combined_into}'s totals).</p>`;
  }
  const how = edit.attribution === 'command'
    ? 'a shell command in this turn named this file'
    : edit.attribution === 'bulk'
      ? 'this turn ran a tool that rewrites files it does not name (a formatter or installer)'
      : 'this turn only referred to this file; no command here clearly wrote it';
  return `<p class="approx-note">${icon('terminal')}Changed by a shell command, so the diff comes ` +
    `from git (working tree vs HEAD) rather than the transcript - ${how}.</p>`;
}

/**
 * Whether to build a full-file view for this edit. A shared diff has no
 * before/after of its own, so it gets the pane with a reason rather than a
 * file - but only where the caller wanted the pane at all.
 */
function fullViewMode(edit, opts) {
  const wanted = 'fullView' in opts ? opts.fullView : true;
  if (wanted === false) return false;
  return edit.combined_into ? 'combined' : wanted;
}

export function renderEdit(edit, opts = {}) {
  const badges = [];
  if (edit.kind === 'create') badges.push(`<span class="badge create">${icon('sparkle')}new file</span>`);
  if (edit.kind === 'delete') badges.push(`<span class="badge delete">${icon('minus')}deleted</span>`);
  if (edit.tool === 'Bash') {
    // The command is the evidence for this edit, so keep it on the badge.
    const title = edit.command ? ` title="${escapeHtml(edit.command)}"` : '';
    badges.push(`<span class="badge shell"${title}>${icon('terminal')}via shell</span>`);
  }
  if (edit.by_subagent) badges.push(`<span class="badge subagent">${icon('robot')}by subagent</span>`);

  const stats = edit.stats || { added: 0, removed: 0 };
  const outside = edit.outside_cwd ? ' data-outside="1"' : '';
  // The file key lets a review-lens file chip find this block and scroll to it.
  const fileAttr = ` data-file="${escapeHtml(edit.rel)}"`;
  const header =
    `<div class="edit-header">` +
    `${icon('code')}` +
    `<span class="edit-file">${escapeHtml(edit.rel)}</span>` +
    badges.join('') +
    `<span class="edit-stats"><span class="add">+${stats.added}</span><span class="del">\u2212${stats.removed}</span></span>` +
    `</div>`;

  if (edit.result === 'unknown') {
    return (
      `<div class="edit"${fileAttr}${outside}>${header}` +
      `<p class="edit-unknown">${icon('warning')}Edit attempted, result unknown (session may have been interrupted).</p>` +
      `</div>`
    );
  }

  if (edit.result === 'error') {
    return (
      `<div class="edit"${fileAttr}${outside}>${header}` +
      `<p class="edit-unknown">${icon('warning')}Edit failed: ${escapeHtml(edit.error || 'unknown error')}</p>` +
      `</div>`
    );
  }

  return (
    `<div class="edit"${fileAttr}${outside}>${header}` +
    provenanceNote(edit) +
    renderViews(edit.hunks, opts.base, edit.base_source === 'disk', fullViewMode(edit, opts)) +
    `</div>`
  );
}
