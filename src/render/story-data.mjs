/**
 * The code a story page shows, carried once as inert JSON instead of as
 * tables in every lens. The lenses emit empty `.view` placeholders that name
 * an entry here (`data-diff`, `data-base`); the page script renders a
 * placeholder the first time it is shown, with the functions in
 * hunk-html.mjs.
 *
 * Both maps are keyed by content, not by edit: a shell edit marked
 * `combined_into` repeats another turn's whole git diff, so a long session
 * holds the same hunks many times over.
 */

import { createHash } from 'node:crypto';
import { spliceFullFile, FULL_VIEW_BUDGET_CHARS } from './full-view.mjs';

/** Short content key: hex, so it needs no escaping in an attribute. */
export function contentKey(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return createHash('sha1').update(text).digest('hex').slice(0, 12);
}

/**
 * Which edits get a full-file view, and the pre-edit text each one needs.
 * The budget is spent on the newest turns first, since those are the ones a
 * reader is most likely reviewing, and is charged by the base text the page
 * carries (once per distinct text). The size caps in spliceFullFile still
 * decide whether a file is small enough to show whole.
 *
 * Edits that never get a full view are left out of the map: files outside
 * the project, a diff shared across turns (`combined_into`), and edits that
 * failed or never finished.
 * @returns {{plan: Map<string, string|null>, texts: Object<string, string>}}
 *   plan: edit id -> the base's content key, '' when no pre-edit text is
 *   known or the file is too large, or null when the budget ran out first
 */
export function planFullBases(story, bases, budget = FULL_VIEW_BUDGET_CHARS) {
  const plan = new Map();
  const texts = {};
  let left = budget;
  for (const turn of [...story.turns].reverse()) {
    for (const edit of [...turn.edits].reverse()) {
      if (edit.outside_cwd || edit.combined_into) continue;
      if (edit.result === 'error' || edit.result === 'unknown') continue;
      const base = bases.get(edit.id);
      if (typeof base !== 'string' || !spliceFullFile(base, edit.hunks || [])) {
        plan.set(edit.id, '');
        continue;
      }
      const key = contentKey(base);
      if (!(key in texts)) {
        if (base.length > left) {
          plan.set(edit.id, null);
          continue;
        }
        left -= base.length;
        texts[key] = base;
      }
      plan.set(edit.id, key);
    }
  }
  return { plan, texts };
}

/**
 * Everything the page needs to render code on demand.
 * @returns {{diffKeyOf: Map<string, string>, fullOf: Map<string, string|null>,
 *   data: {diffs: Object<string, Array>, bases: Object<string, string>}}}
 */
export function buildStoryData(story, bases, budget) {
  const diffKeyOf = new Map();
  const diffs = {};
  for (const turn of story.turns) {
    for (const edit of turn.edits) {
      if (!edit.hunks || edit.hunks.length === 0) continue;
      const key = contentKey(edit.hunks);
      diffKeyOf.set(edit.id, key);
      if (!(key in diffs)) diffs[key] = edit.hunks.map(({ oldStart, oldLines, newStart, lines }) => ({ oldStart, oldLines, newStart, lines }));
    }
  }
  const { plan, texts } = planFullBases(story, bases, budget);
  return { diffKeyOf, fullOf: plan, data: { diffs, bases: texts } };
}

/**
 * JSON that is safe as the text of a <script> element. Script text is never
 * entity-decoded, so it must not be HTML-escaped; the only hazards are `</`
 * (which can close the element) and `<!--` (which, followed by `<script`,
 * stops the next `</script>` from closing it). Both get JSON escapes that
 * JSON.parse reads back unchanged. JSON.stringify already escapes `\r`,
 * which the HTML parser would otherwise turn into `\n`.
 */
export function inertJson(value) {
  return JSON.stringify(value)
    .replace(/<\//g, '<\\/')
    .replace(/<!--/g, '\\u003c!--')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function renderStoryData(data) {
  return `<script type="application/json" id="story-data">${inertJson(data)}</script>`;
}
