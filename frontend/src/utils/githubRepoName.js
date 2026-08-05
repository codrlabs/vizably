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
