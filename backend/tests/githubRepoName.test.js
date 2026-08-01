/**
 * Unit tests for shared GitHub repo name normalization (#85).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeGitHubRepoName } = require('../../shared/githubRepoName');

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
