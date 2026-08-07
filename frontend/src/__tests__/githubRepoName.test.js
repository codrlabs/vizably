import { describe, expect, it } from 'vitest'
import {
  applyVizablyRepoPrefix,
  normalizeGitHubRepoName,
  VIZABLY_REPO_PREFIX,
} from '../utils/githubRepoName'

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

describe('applyVizablyRepoPrefix', () => {
  it('prepends viz_ after normalizing', () => {
    expect(applyVizablyRepoPrefix('scans')).toBe('viz_scans')
    expect(applyVizablyRepoPrefix('  accessibility results  ')).toBe(
      'viz_accessibility-results',
    )
    expect(applyVizablyRepoPrefix('reports')).toBe(`${VIZABLY_REPO_PREFIX}reports`)
  })

  it('does not double-prefix when viz_ is already present', () => {
    expect(applyVizablyRepoPrefix('viz_scans')).toBe('viz_scans')
    expect(applyVizablyRepoPrefix('VIZ_reports')).toBe('viz_reports')
  })
})
