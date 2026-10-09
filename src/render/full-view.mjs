/**
 * Whole-file diff view: the same changes as the hunk view, but shown in
 * place inside the complete source file. Built by splicing each hunk into
 * the file's pre-edit text at the line it applies to, so no diff algorithm
 * is involved and the result is exact.
 */

import { spliceRows, fullTableHtml } from './hunk-html.mjs';

/**
 * Bounds on the full-file view, so opting into it cannot bloat a shareable
 * artifact without limit. A file is skipped when it is too long *or* too
 * heavy (minified or data files have few lines but huge ones), before or
 * after the edit, and the page as a whole spends a fixed budget of spliced
 * content (see planFullViews).
 */
export const FULL_VIEW_MAX_LINES = 2000;
export const FULL_VIEW_MAX_CHARS = 80000;
export const FULL_VIEW_BUDGET_CHARS = 2000000;

/**
 * @param {string|null} baseText - the file as it stood before the edit
 * @param {Array<object>} hunks - structuredPatch hunks for that edit
 * @returns {Array<{kind: string, oldNo: number|null, newNo: number|null, text: string}>|null}
 */
export function spliceFullFile(baseText, hunks) {
  if (typeof baseText !== 'string') return null;
  if (baseText.length > FULL_VIEW_MAX_CHARS) return null;
  if (baseText.split('\n').length - (baseText.endsWith('\n') ? 1 : 0) > FULL_VIEW_MAX_LINES) return null;
  const rows = spliceRows(baseText, hunks);

  // The base check alone lets a large new file through: it starts from ''.
  if (rows.length > FULL_VIEW_MAX_LINES) return null;
  if (rows.reduce((sum, row) => sum + row.text.length, 0) > FULL_VIEW_MAX_CHARS) return null;
  return rows;
}

/**
 * Render the spliced whole-file view, reusing the hunk table markup so it
 * inherits the same diff styling.
 * @returns {string} HTML, or '' when no full view can be produced
 */
export function renderFullFile(baseText, hunks) {
  const rows = spliceFullFile(baseText, hunks);
  if (!rows) return '';

  return fullTableHtml(rows);
}

/**
 * Decide which edits get a full-file view, building each one once. The
 * budget goes to the newest turns first, since those are the ones a reader
 * is most likely reviewing, and is charged by rendered HTML size. Review
 * carries these views; the Diff lens refers to them (see renderViews).
 *
 * Edits that never get a full view are left out of the map: files outside
 * the project, a diff shared across turns (`combined_into`), and edits that
 * failed or never finished.
 * @returns {Map<string, string|null>} edit id -> the view's HTML, '' when no
 *   pre-edit text is known or the file is too large, or null when the page
 *   budget ran out before this edit
 */
export function planFullViews(story, bases, budget = FULL_VIEW_BUDGET_CHARS) {
  const plan = new Map();
  let left = budget;
  for (const turn of [...story.turns].reverse()) {
    for (const edit of [...turn.edits].reverse()) {
      if (edit.outside_cwd || edit.combined_into) continue;
      if (edit.result === 'error' || edit.result === 'unknown') continue;
      const base = bases.get(edit.id);
      const html = renderFullFile(typeof base === 'string' ? base : null, edit.hunks || []);
      if (html.length > left) {
        plan.set(edit.id, null);
        continue;
      }
      left -= html.length;
      plan.set(edit.id, html);
    }
  }
  return plan;
}
