import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ProblemView from '../views/ProblemView'
import { toScanViewModel } from '../lib/scanAdapter'
import { scanResultFixture } from './fixtures/scanResult'

const vm = toScanViewModel(scanResultFixture, 'https://example.com')
const contrast = vm.categories[0].problems[0]

describe('ProblemView', () => {
  it('renders name, severity, WCAG criterion and occurrence count', () => {
    render(<ProblemView problem={contrast} onBack={() => {}} />)

    expect(screen.getByText('Elements must meet minimum color contrast ratio thresholds')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /serious severity/i })).toBeInTheDocument()
    expect(screen.getByText('WCAG 1.4.3')).toBeInTheDocument()
    expect(screen.getByText('6 occurrences')).toBeInTheDocument()
  })

  it('renders the root cause and offending code', () => {
    render(<ProblemView problem={contrast} onBack={() => {}} />)

    expect(screen.getByText('Root cause')).toBeInTheDocument()
    expect(screen.getByText(contrast.rootCause)).toBeInTheDocument()
    expect(screen.getByText(contrast.code)).toBeInTheDocument()
  })

  it('renders numbered fix steps', () => {
    render(<ProblemView problem={contrast} onBack={() => {}} />)

    expect(screen.getByText('How to fix')).toBeInTheDocument()
    expect(screen.getByText(contrast.solution[0])).toBeInTheDocument()
  })

  it('calls onBack from the back link', () => {
    const onBack = vi.fn()
    render(<ProblemView problem={contrast} onBack={onBack} />)

    fireEvent.click(screen.getByText('Back to results'))
    expect(onBack).toHaveBeenCalled()
  })
})
