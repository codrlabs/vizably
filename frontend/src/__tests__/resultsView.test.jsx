import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ResultsView from '../views/ResultsView'
import { toScanViewModel } from '../lib/scanAdapter'
import { scanResultFixture } from './fixtures/scanResult'

const vm = toScanViewModel(scanResultFixture, 'https://example.com')

describe('ResultsView', () => {
  it('renders the report header with the scanned URL and score', () => {
    render(<ResultsView data={vm} onOpenProblem={() => {}} />)

    expect(screen.getByText('Accessibility report')).toBeInTheDocument()
    expect(screen.getByText('https://example.com')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /score: 70 out of 100/i })).toBeInTheDocument()
  })

  it('renders a section per non-empty category', () => {
    render(<ResultsView data={vm} onOpenProblem={() => {}} />)

    expect(screen.getByText('Visual Accessibility')).toBeInTheDocument()
    expect(screen.getByText('Structure & Semantics')).toBeInTheDocument()
    expect(screen.queryByText('Multi-media')).not.toBeInTheDocument()
    expect(screen.getByText('3 issues total')).toBeInTheDocument()
  })

  it('renders the what’s good section', () => {
    render(<ResultsView data={vm} onOpenProblem={() => {}} />)

    expect(screen.getByText('What’s good')).toBeInTheDocument()
    expect(screen.getByText(/declares a language/)).toBeInTheDocument()
  })

  it('opens a problem when its row is clicked', () => {
    const onOpenProblem = vi.fn()
    render(<ResultsView data={vm} onOpenProblem={onOpenProblem} />)

    fireEvent.click(screen.getByText('Images must have alternate text'))
    expect(onOpenProblem).toHaveBeenCalledWith(expect.objectContaining({ id: 'image-alt' }))
  })

  it('hides delete when there is no saved scan id', () => {
    render(<ResultsView data={vm} onOpenProblem={() => {}} onDelete={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /delete scan/i })).not.toBeInTheDocument()
  })

  it('confirms before deleting a saved scan', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined)
    render(
      <ResultsView
        data={vm}
        onOpenProblem={() => {}}
        scanId="scan-1"
        onDelete={onDelete}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /delete scan/i }))
    expect(screen.getByText(/delete this saved scan/i)).toBeInTheDocument()
    expect(onDelete).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /yes, delete/i }))
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith({ id: 'scan-1' }))
  })
})
