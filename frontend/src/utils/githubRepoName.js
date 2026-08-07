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
