/**
 * Normalize a GitHub repository name before validation / creation.
 * Keep in sync with shared/githubRepoName.js (same algorithm).
 *
 * @param {unknown} name
 * @returns {string}
 */
export function normalizeGitHubRepoName(name) {
  return String(name ?? '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Prefix applied to every repository Vizably creates. */
export const VIZABLY_REPO_PREFIX = 'viz_'

/** First-choice store name for a new account (`viz_scans`, then `viz_scans-2`, …). */
export const VIZABLY_DEFAULT_STORE_NAME = `${VIZABLY_REPO_PREFIX}scans`

/**
 * Normalize then ensure the Vizably create-path prefix.
 * Idempotent: names that already start with `viz_` (any casing) keep a single prefix.
 *
 * @param {unknown} name
 * @returns {string}
 */
export function applyVizablyRepoPrefix(name) {
  const normalized = normalizeGitHubRepoName(name)
  if (!normalized) {
    return ''
  }
  if (normalized.toLowerCase().startsWith(VIZABLY_REPO_PREFIX)) {
    return `${VIZABLY_REPO_PREFIX}${normalized.slice(VIZABLY_REPO_PREFIX.length)}`
  }
  return `${VIZABLY_REPO_PREFIX}${normalized}`
}

/**
 * Next unused create-path name. Tries `viz_scans`, then `viz_scans-2`, …
 *
 * @param {Iterable<unknown>} [takenNames]
 * @returns {string}
 */
export function nextVizablyStoreName(takenNames = []) {
  const taken = new Set(
    [...takenNames].map((name) => String(name ?? '').toLowerCase()).filter(Boolean),
  )
  if (!taken.has(VIZABLY_DEFAULT_STORE_NAME)) {
    return VIZABLY_DEFAULT_STORE_NAME
  }
  for (let n = 2; n <= 999; n += 1) {
    const candidate = `${VIZABLY_DEFAULT_STORE_NAME}-${n}`
    if (!taken.has(candidate)) {
      return candidate
    }
  }
  throw new Error('Could not find an available Vizably repository name')
}
