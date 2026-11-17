import { describe, it, expect } from 'vitest'
import { toScanViewModel, wcagFromTags } from '../lib/scanAdapter'
import { scanResultFixture } from './fixtures/scanResult'

describe('wcagFromTags', () => {
  it('derives the success criterion from an axe wcag tag', () => {
    expect(wcagFromTags(['cat.color', 'wcag2aa', 'wcag143'])).toBe('1.4.3')
    expect(wcagFromTags(['wcag111'])).toBe('1.1.1')
    expect(wcagFromTags(['wcag2410'])).toBe('2.4.10')
  })

  it('returns undefined when no criterion tag exists', () => {
    expect(wcagFromTags(['cat.semantics', 'best-practice'])).toBeUndefined()
    expect(wcagFromTags()).toBeUndefined()
  })
})

describe('toScanViewModel', () => {
  const vm = toScanViewModel(scanResultFixture, 'https://example.com')

  it('echoes the scanned URL', () => {
    expect(vm.url).toBe('https://example.com')
  })

  it('maps non-empty buckets to titled categories and drops empty ones', () => {
    expect(vm.categories.map((c) => c.title)).toEqual([
      'Visual Accessibility',
      'Structure & Semantics',
    ])
  })

  it('counts findings by severity level', () => {
    expect(vm.counts).toEqual({ critical: 1, serious: 1, moderate: 1, minor: 0 })
  })

  it('scores by weighted deduction (critical 15, serious 10, moderate 5)', () => {
    expect(vm.score).toBe(100 - 15 - 10 - 5)
  })

  it('maps problem fields into the view shape', () => {
    const contrast = vm.categories[0].problems[0]
    expect(contrast).toMatchObject({
      id: 'color-contrast',
      level: 'serious',
      wcag: '1.4.3',
      count: 6,
      lang: 'html',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
    })
  })

  it('passes whatsGood through', () => {
    expect(vm.whatsGood).toHaveLength(2)
  })

  it('handles an empty result safely', () => {
    const empty = toScanViewModel(null, 'https://example.com')
    expect(empty.categories).toEqual([])
    expect(empty.score).toBe(100)
  })
})
