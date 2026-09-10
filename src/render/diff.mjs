/**
 * Rendering for individual diff hunks: HTML escaping and a two-column
 * (old line / new line) table per hunk, one row per line.
 */

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
 * Render one edit: a file header (name, create/update badge, subagent
 * badge) followed by its hunks, or a note when the result never arrived.
 * @param {{rel: string, kind: string|null, by_subagent: string|null, result: string, hunks: object[], stats: {added:number, removed:number}}} edit
 * @returns {string}
 */
export function renderEdit(edit) {
  const badges = [];
  if (edit.kind === 'create') badges.push('<span class="badge create">new file</span>');
  if (edit.by_subagent) badges.push(`<span class="badge subagent">by subagent</span>`);

  const header =
    `<div class="edit-header">` +
    `<span class="edit-file">${escapeHtml(edit.rel)}</span>` +
    badges.join('') +
    `</div>`;

  if (edit.result === 'unknown') {
    return `${header}<p class="edit-unknown">Edit attempted, result unknown (session may have been interrupted).</p>`;
  }

  const hunksHtml = edit.hunks.map(renderHunk).join('');
  return `${header}${hunksHtml}`;
}
