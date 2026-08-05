/**
 * Normalize a GitHub repository name before validation / creation.
 * Dependency-free — safe for both backend (CJS) and frontend (ESM).
 *
 * - Trims leading/trailing whitespace
 * - Collapses internal whitespace runs to a single hyphen (GitHub disallows spaces)
 * - Collapses accidental repeated hyphens from that substitution
 * - Strips leading/trailing hyphens left by whitespace cleanup
 *
 * Does not enforce the GitHub charset; callers validate after normalizing.
 *
 * @param {unknown} name
 * @returns {string}
 */
function normalizeGitHubRepoName(name) {
  return String(name ?? '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = { normalizeGitHubRepoName };
