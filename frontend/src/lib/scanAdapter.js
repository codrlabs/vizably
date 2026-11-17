/**
 * scanAdapter — maps the backend ScanResult (bucketed axe-core
 * violations, see shared/types.js) into the view model the results UI
 * renders: scored summary + icon-tagged categories + per-problem
 * severity/WCAG metadata.
 *
 * @typedef {import('../../../shared/types.js').ScanResult} ScanResult
 * @typedef {import('../../../shared/types.js').Problem} Problem
 */

const CATEGORY_META = {
  visualAccessibility: { id: 'visual', title: 'Visual Accessibility', icon: 'Eye' },
  structureAndSemantics: { id: 'structure', title: 'Structure & Semantics', icon: 'ListTree' },
  multimedia: { id: 'multimedia', title: 'Multi-media', icon: 'Captions' },
}

/** Deduction per finding, by axe-core impact level. */
const SCORE_WEIGHTS = { critical: 15, serious: 10, moderate: 5, minor: 2 }

/**
 * Derive a WCAG success-criterion string ("1.4.3") from axe tags
 * ("wcag143"). Returns undefined when no criterion tag is present.
 * @param {string[]} [tags]
 */
export function wcagFromTags(tags = []) {
  for (const tag of tags) {
    const m = /^wcag(\d)(\d)(\d+)$/.exec(tag)
    if (m) return `${m[1]}.${m[2]}.${m[3]}`
  }
  return undefined
}

/** Crude snippet language sniff for the CodeBlock caption. */
function languageOf(snippet = '') {
  const s = snippet.trim()
  if (s.startsWith('<')) return 'html'
  if (/[{}]/.test(s) && /:/.test(s)) return 'css'
  return 'html'
}

/**
 * @param {Problem} p
 */
function toProblemViewModel(p) {
  return {
    id: p.id,
    name: p.name,
    level: p.impact || 'moderate',
    wcag: wcagFromTags(p.tags),
    count: p.count ?? 1,
    rootCause: p.rootCause,
    code: p.codeSnippet,
    lang: languageOf(p.codeSnippet),
    solution: p.solution && p.solution.length ? p.solution : ['See the WCAG reference for remediation guidance.'],
    helpUrl: p.helpUrl || null,
  }
}

/**
 * Build the results view model from a backend ScanResult.
 *
 * @param {ScanResult} result
 * @param {string} url  the scanned URL (echoed into the report header)
 */
export function toScanViewModel(result, url) {
  const buckets = result?.problems || {}
  const categories = Object.entries(CATEGORY_META)
    .map(([key, meta]) => ({ ...meta, problems: (buckets[key] || []).map(toProblemViewModel) }))
    .filter((c) => c.problems.length > 0)

  const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 }
  let deduction = 0
  for (const cat of categories) {
    for (const p of cat.problems) {
      counts[p.level] = (counts[p.level] || 0) + 1
      deduction += SCORE_WEIGHTS[p.level] || SCORE_WEIGHTS.moderate
    }
  }

  return {
    url,
    score: Math.max(0, 100 - deduction),
    counts,
    categories,
    whatsGood: result?.whatsGood || [],
  }
}
