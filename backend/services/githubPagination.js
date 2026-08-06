/**
 * Shared GitHub list pagination helpers.
 *
 * GitHub caps each page at 100 items. Callers that previously fetched only
 * page 1 silently dropped everything after that — these helpers walk pages
 * until a short/empty page, keeping the common ≤100 case as a single request.
 */

const DEFAULT_PER_PAGE = 100;
const DEFAULT_MAX_PAGES = 50;

/**
 * Collect every item across paginated GitHub list responses.
 *
 * @template T
 * @param {(page: number, perPage: number) => Promise<T[]>} fetchPage
 * @param {{ perPage?: number, maxPages?: number }} [options]
 * @returns {Promise<T[]>}
 */
async function collectAllGitHubPages(fetchPage, options = {}) {
  const perPage = options.perPage ?? DEFAULT_PER_PAGE;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  /** @type {T[]} */
  const all = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const items = await fetchPage(page, perPage);
    if (!Array.isArray(items) || items.length === 0) {
      break;
    }
    all.push(...items);
    if (items.length < perPage) {
      break;
    }
  }

  return all;
}

/**
 * Scan paginated results until `predicate` matches, then stop.
 * Prefer this when looking for a single repo so large installations
 * do not force a full crawl after a hit.
 *
 * @template T
 * @param {(page: number, perPage: number) => Promise<T[]>} fetchPage
 * @param {(item: T) => boolean} predicate
 * @param {{ perPage?: number, maxPages?: number }} [options]
 * @returns {Promise<T | null>}
 */
async function findInGitHubPages(fetchPage, predicate, options = {}) {
  const perPage = options.perPage ?? DEFAULT_PER_PAGE;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;

  for (let page = 1; page <= maxPages; page += 1) {
    const items = await fetchPage(page, perPage);
    if (!Array.isArray(items) || items.length === 0) {
      return null;
    }
    const hit = items.find(predicate);
    if (hit) {
      return hit;
    }
    if (items.length < perPage) {
      return null;
    }
  }

  return null;
}

module.exports = {
  DEFAULT_PER_PAGE,
  DEFAULT_MAX_PAGES,
  collectAllGitHubPages,
  findInGitHubPages,
};
