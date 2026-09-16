/**
 * Structural + completeness validation for the Story IR (story.json).
 * Hand-written on purpose: the project has zero npm runtime dependencies,
 * so this does not pull in a JSON Schema engine. schemas/story.schema.json
 * documents the same shape for humans and external tooling.
 */

const REQUIRED_EDIT_FIELDS = ['id', 'tool', 'file', 'rel', 'hunks', 'stats'];
const REQUIRED_TURN_FIELDS = ['index', 'id', 'prompt', 'edits'];
const OUTCOME_VALUES = ['completed', 'partial', 'failed', 'blocked'];
/** The header is a heading and one tight paragraph; keep both readable there. */
const TITLE_MAX = 60;
const SUMMARY_MAX = 240;

function pushIfMissing(errors, obj, field, prefix) {
  if (obj[field] === undefined) {
    errors.push(`${prefix}.${field} is required but missing`);
  }
}

export function validateStory(story, { strict = false } = {}) {
  const errors = [];

  if (!story || typeof story !== 'object') {
    return { valid: false, errors: ['story must be an object'] };
  }

  if (story.schema_version === undefined) errors.push('schema_version is required but missing');
  if (!story.session) errors.push('session is required but missing');
  if (!Array.isArray(story.turns)) errors.push('turns is required and must be an array');
  if (!Array.isArray(story.files)) errors.push('files is required and must be an array');
  if (!story.totals) errors.push('totals is required but missing');

  if (Array.isArray(story.turns)) {
    story.turns.forEach((turn, ti) => {
      const turnPrefix = `turns[${ti}]`;
      for (const field of REQUIRED_TURN_FIELDS) {
        pushIfMissing(errors, turn, field, turnPrefix);
      }
      if (Array.isArray(turn.edits)) {
        turn.edits.forEach((edit, ei) => {
          const editPrefix = `${turnPrefix}.edits[${ei}]`;
          for (const field of REQUIRED_EDIT_FIELDS) {
            pushIfMissing(errors, edit, field, editPrefix);
          }
        });
      }
      if (strict && !turn.summary) {
        errors.push(`${turnPrefix}.summary is required in strict mode but is empty`);
      }
    });
  }

  if (strict && story.session) {
    const { title, summary } = story.session;
    if (!title) {
      errors.push('session.title is required in strict mode but is empty');
    } else if (title.length > TITLE_MAX) {
      errors.push(`session.title must be at most ${TITLE_MAX} characters but is ${title.length}`);
    }
    if (!summary) {
      errors.push('session.summary is required in strict mode but is empty');
    } else if (summary.length > SUMMARY_MAX) {
      errors.push(`session.summary must be at most ${SUMMARY_MAX} characters but is ${summary.length}`);
    }
  }

  if (strict) {
    const report = story.report;
    if (!report || !report.plan) {
      errors.push('report.plan is required in strict mode but is empty');
    }
    if (!report || !OUTCOME_VALUES.includes(report.outcome)) {
      errors.push(`report.outcome is required in strict mode and must be one of: ${OUTCOME_VALUES.join(', ')}`);
    }
    if (!report || !Array.isArray(report.decisions)) {
      errors.push('report.decisions is required in strict mode and must be an array');
    }
  }

  return { valid: errors.length === 0, errors };
}
