/**
 * Unit tests for shared GitHub pagination helpers.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  collectAllGitHubPages,
  findInGitHubPages,
  DEFAULT_PER_PAGE,
} = require('../services/githubPagination');

test('collectAllGitHubPages returns a single page when under the page size', async () => {
  const calls = [];
  const items = await collectAllGitHubPages(async (page, perPage) => {
    calls.push({ page, perPage });
    return ['a', 'b', 'c'];
  });
  assert.deepEqual(items, ['a', 'b', 'c']);
  assert.deepEqual(calls, [{ page: 1, perPage: DEFAULT_PER_PAGE }]);
});

test('collectAllGitHubPages walks every full page then stops on a short page', async () => {
  const calls = [];
  const items = await collectAllGitHubPages(
    async (page, perPage) => {
      calls.push({ page, perPage });
      if (page === 1) return Array.from({ length: perPage }, (_, i) => `p1-${i}`);
      if (page === 2) return Array.from({ length: perPage }, (_, i) => `p2-${i}`);
      return ['last'];
    },
    { perPage: 3 },
  );
  assert.equal(items.length, 7);
  assert.deepEqual(calls, [
    { page: 1, perPage: 3 },
    { page: 2, perPage: 3 },
    { page: 3, perPage: 3 },
  ]);
  assert.equal(items[0], 'p1-0');
  assert.equal(items[6], 'last');
});

test('collectAllGitHubPages stops on an empty page', async () => {
  const calls = [];
  const items = await collectAllGitHubPages(
    async (page) => {
      calls.push(page);
      if (page === 1) return ['x', 'y'];
      return [];
    },
    { perPage: 2 },
  );
  assert.deepEqual(items, ['x', 'y']);
  assert.deepEqual(calls, [1, 2]);
});

test('collectAllGitHubPages respects maxPages', async () => {
  const calls = [];
  const items = await collectAllGitHubPages(
    async (page, perPage) => {
      calls.push(page);
      return Array.from({ length: perPage }, (_, i) => `${page}-${i}`);
    },
    { perPage: 2, maxPages: 2 },
  );
  assert.equal(items.length, 4);
  assert.deepEqual(calls, [1, 2]);
});

test('findInGitHubPages returns the first match and stops paginating', async () => {
  const calls = [];
  const hit = await findInGitHubPages(
    async (page, perPage) => {
      calls.push(page);
      if (page === 1) return Array.from({ length: perPage }, (_, i) => ({ id: i }));
      return [{ id: 99 }, { id: 100 }];
    },
    (item) => item.id === 99,
    { perPage: 2 },
  );
  assert.deepEqual(hit, { id: 99 });
  assert.deepEqual(calls, [1, 2]);
});

test('findInGitHubPages returns null when nothing matches', async () => {
  const hit = await findInGitHubPages(
    async (page, perPage) => {
      if (page === 1) return Array.from({ length: perPage }, (_, i) => ({ id: i }));
      return [{ id: 2 }];
    },
    (item) => item.id === 404,
    { perPage: 2 },
  );
  assert.equal(hit, null);
});
