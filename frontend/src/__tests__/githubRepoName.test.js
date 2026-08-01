import { describe, it, expect } from 'vitest'
import { normalizeGitHubRepoName } from '../utils/githubRepoName'

describe('normalizeGitHubRepoName', () => {
  it('trims leading and trailing whitespace', () => {
    expect(normalizeGitHubRepoName('  vizably-scans  ')).toBe('vizably-scans')
  })

  it('collapses internal whitespace to a hyphen', () => {
    expect(normalizeGitHubRepoName('vizably   scans')).toBe('vizably-scans')
    expect(normalizeGitHubRepoName('my repo name')).toBe('my-repo-name')
  })

  it('collapses whitespace around hyphens', () => {
    expect(normalizeGitHubRepoName('my - repo')).toBe('my-repo')
  })

  it('returns empty for whitespace-only input', () => {
    expect(normalizeGitHubRepoName('   \t  ')).toBe('')
  })
})
