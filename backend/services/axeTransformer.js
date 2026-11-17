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
    };
  }

  const violations = Array.isArray(axeResults.violations)
    ? axeResults.violations
    : [];
  const passes = Array.isArray(axeResults.passes) ? axeResults.passes : [];

  /** @type {ScanResult['problems']} */
  const problems = {
    visualAccessibility: [],
    structureAndSemantics: [],
    multimedia: [],
  };

  for (const v of violations) {
    const bucket = bucketFor(v.tags);
    problems[bucket].push({
      id: v.id,
      name: v.help || v.description || v.id,
      category: bucket,
      rootCause: v.description || '',
      codeSnippet: v.nodes?.[0]?.html || '',
      solution: v.nodes?.[0]?.failureSummary
        ? [v.nodes[0].failureSummary]
        : [],
      count: v.nodes?.length || 1,
      impact: v.impact || null,
      helpUrl: v.helpUrl || null,
      tags: v.tags || [],
    });
  }

  return {
    problems,
    whatsGood: passes.map((p) => p.help || p.description || p.id),
  };
}

module.exports = { transform, bucketFor };
