/**
 * Unit tests for shared GitHub repository name helpers.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeGitHubRepoName,
  applyVizablyRepoPrefix,
  VIZABLY_REPO_PREFIX,
} = require('../../shared/githubRepoName');

test('normalizeGitHubRepoName trims leading and trailing whitespace', () => {
  assert.equal(normalizeGitHubRepoName('  vizably-scans  '), 'vizably-scans');
});

test('normalizeGitHubRepoName collapses internal whitespace to a hyphen', () => {
  assert.equal(normalizeGitHubRepoName('vizably   scans'), 'vizably-scans');
  assert.equal(normalizeGitHubRepoName('my repo name'), 'my-repo-name');
});

test('normalizeGitHubRepoName collapses whitespace around hyphens', () => {
  assert.equal(normalizeGitHubRepoName('my - repo'), 'my-repo');
});

test('normalizeGitHubRepoName returns empty for whitespace-only input', () => {
  assert.equal(normalizeGitHubRepoName('   \t  '), '');
  assert.equal(normalizeGitHubRepoName(null), '');
  assert.equal(normalizeGitHubRepoName(undefined), '');
});

test('applyVizablyRepoPrefix prepends viz_ after normalizing', () => {
  assert.equal(applyVizablyRepoPrefix('scans'), 'viz_scans');
  assert.equal(applyVizablyRepoPrefix('  accessibility results  '), 'viz_accessibility-results');
  assert.equal(applyVizablyRepoPrefix('reports'), `${VIZABLY_REPO_PREFIX}reports`);
});

test('applyVizablyRepoPrefix is idempotent when the prefix is already present', () => {
  assert.equal(applyVizablyRepoPrefix('viz_scans'), 'viz_scans');
  assert.equal(applyVizablyRepoPrefix('VIZ_reports'), 'viz_reports');
  assert.equal(applyVizablyRepoPrefix('  viz_my-repo  '), 'viz_my-repo');
});

test('applyVizablyRepoPrefix returns empty for blank input', () => {
  assert.equal(applyVizablyRepoPrefix('   '), '');
  assert.equal(applyVizablyRepoPrefix(null), '');
});

test('nextVizablyStoreName starts at viz_scans then increments', () => {
  const {
    nextVizablyStoreName,
    VIZABLY_DEFAULT_STORE_NAME,
  } = require('../../shared/githubRepoName');
  assert.equal(nextVizablyStoreName([]), VIZABLY_DEFAULT_STORE_NAME);
  assert.equal(nextVizablyStoreName(['viz_scans']), 'viz_scans-2');
  assert.equal(nextVizablyStoreName(['viz_scans', 'viz_scans-2']), 'viz_scans-3');
});
