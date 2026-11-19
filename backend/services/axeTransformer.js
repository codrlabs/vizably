/**
 * axeTransformer — pure module that maps a raw axe-core results object
 * into the API response shape the vizably frontend consumes.
 *
 * This is currently a stub: until Phase 2 of the project roadmap wires
 * Puppeteer + axe-core, the controller still serves the mock fixture
 * verbatim. The transformer is here so:
 *   1. The "right shape" is documented in code, not just in a markdown
 *      doc, and
 *   2. New code can be written against the interface today and have
 *      a real implementation dropped in tomorrow.
 *
 * See:
 *   - docs/plans/project-roadmap.md           (Phase 2)
 *   - docs/plans/axecore-integration-roadmap.md
 *   - docs/plans/architecture-map.md          §6.3
 *
 * Contract (when Phase 2 lands):
 *   transform(axeResults) -> ScanResult
 *
 * @typedef {import('../../shared/types.js').ScanResult} ScanResult
 */

/**
 * Map an axe `tags` array to one of vizably's UI buckets.
 * Pure helper — covered by unit tests in Phase 1.
 *
 * @param {string[]} tags
 * @returns {'visualAccessibility' | 'structureAndSemantics' | 'multimedia'}
 */
function bucketFor(tags = []) {
  const has = (t) => tags.includes(t);

  // Multi-media: alt text, captions, transcripts, audio/video rules.
  if (
    has('cat.text-alternatives') ||
    has('cat.media') ||
    has('cat.time-and-media')
  ) {
    return 'multimedia';
  }

  // Structure & semantics: headings, landmarks, lists, tables, parsing.
  if (
    has('cat.structure') ||
    has('cat.semantics') ||
    has('cat.tables') ||
    has('cat.parsing') ||
    has('cat.aria') ||
    has('cat.name-role-value')
  ) {
    return 'structureAndSemantics';
  }

  // Default to visual: contrast, color, sensory, focus.
  return 'visualAccessibility';
}

/**
 * Map one axe rule result (a violation or an incomplete check) to a Problem.
 *
 * @param {object} r  an entry of axe's `violations` or `incomplete`
 * @param {string} category
 * @returns {import('../../shared/types.js').Problem}
 */
function toProblem(r, category) {
  return {
    id: r.id,
    name: r.help || r.description || r.id,
    category,
    rootCause: r.description || '',
    codeSnippet: r.nodes?.[0]?.html || '',
    solution: r.nodes?.[0]?.failureSummary
      ? [r.nodes[0].failureSummary]
      : [],
    count: r.nodes?.length || 1,
    impact: r.impact || null,
    helpUrl: r.helpUrl || null,
    tags: r.tags || [],
  };
}

/**
 * Why axe couldn't decide, from `failureSummary` without its "Fix any of the
 * following:" headings. Those are written for violations; here the lines under
 * them are the reason, not something to fix.
 *
 * @param {object} r  an entry of axe's `incomplete`
 * @returns {string}
 */
function incompleteReason(r) {
  const reasons = (r.nodes?.[0]?.failureSummary || '')
    .replace(/Fix (any|all) of the following:/gi, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return reasons.join('; ') || 'The scanner could not get a result for this element.';
}

/**
 * What a person should look at to settle an incomplete check. axe only says why
 * it gave up, so this guidance is ours. Color contrast gets its own steps because
 * it is what axe most often can't decide (background images, overlapping elements).
 *
 * @param {object} r  an entry of axe's `incomplete`
 * @returns {string[]}
 */
function whatToCheck(r) {
  if (r.id === 'color-contrast') {
    return [
      'Compare the text with what is actually behind it on the live page, using a contrast checker or by eye. It needs at least 4.5:1, or 3:1 for large text.',
      'Check all of the text, especially where it crosses a lighter or darker part of the background.',
      'If it falls short anywhere, change the text color or put a solid backdrop behind it. If it passes, nothing needs to change.',
    ];
  }
  return [
    `Find this element on the live page and check it by hand against this rule: ${r.help || r.description || r.id}.`,
    'If it meets the rule, nothing needs to change. If it doesn’t, the rule reference below explains how to fix it.',
  ];
}

/**
 * Map one axe `incomplete` entry to a Problem for manual review.
 *
 * @param {object} r  an entry of axe's `incomplete`
 * @returns {import('../../shared/types.js').Problem}
 */
function toReviewItem(r) {
  return {
    ...toProblem(r, 'needsManualReview'),
    rootCause: incompleteReason(r),
    solution: whatToCheck(r),
  };
}

/**
 * Transform a raw axe-core run result into a ScanResult.
 *
 * NOTE: This is the *target* shape. Until the real scanner ships, the
 * controller may bypass this transformer and return the mock fixture
 * directly. Keep this function pure — no I/O, no globals.
 *
 * @param {object} axeResults  output of `axe.run(...)`
 * @returns {ScanResult}
 */
function transform(axeResults) {
  if (!axeResults || typeof axeResults !== 'object') {
    return {
      problems: {
        visualAccessibility: [],
        structureAndSemantics: [],
        multimedia: [],
      },
      whatsGood: [],
      needsManualReview: [],
    };
  }

  const violations = Array.isArray(axeResults.violations)
    ? axeResults.violations
    : [];
  const passes = Array.isArray(axeResults.passes) ? axeResults.passes : [];
  // Checks axe could not decide either way (e.g. contrast over a background
  // image). Not violations: a person has to look at them.
  const incomplete = Array.isArray(axeResults.incomplete)
    ? axeResults.incomplete
    : [];

  /** @type {ScanResult['problems']} */
  const problems = {
    visualAccessibility: [],
    structureAndSemantics: [],
    multimedia: [],
  };

  for (const v of violations) {
    const bucket = bucketFor(v.tags);
    problems[bucket].push(toProblem(v, bucket));
  }

  return {
    problems,
    whatsGood: passes.map((p) => p.help || p.description || p.id),
    needsManualReview: incomplete.map(toReviewItem),
  };
}

module.exports = { transform, bucketFor };
