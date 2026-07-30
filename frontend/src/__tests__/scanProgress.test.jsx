import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import ScanProgressIndicator from '../components/ScanProgressIndicator'
import { useScanProgress } from '../hooks/useScanProgress'
import {
  SCAN_PROGRESS_INTERVAL_MS,
  SCAN_PROGRESS_STAGES,
} from '../data/scanProgress'

describe('useScanProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts on the first stage and advances on the interval', () => {
    const { result } = renderHook(() => useScanProgress(true))

    expect(result.current).toBe(SCAN_PROGRESS_STAGES[0])

    act(() => {
      vi.advanceTimersByTime(SCAN_PROGRESS_INTERVAL_MS)
    })
    expect(result.current).toBe(SCAN_PROGRESS_STAGES[1])

    act(() => {
      vi.advanceTimersByTime(SCAN_PROGRESS_INTERVAL_MS)
    })
    expect(result.current).toBe(SCAN_PROGRESS_STAGES[2])
  })

  it('holds on the final stage instead of wrapping', () => {
    const { result } = renderHook(() => useScanProgress(true))

    act(() => {
      vi.advanceTimersByTime(SCAN_PROGRESS_INTERVAL_MS * SCAN_PROGRESS_STAGES.length)
    })

    expect(result.current).toBe(SCAN_PROGRESS_STAGES[SCAN_PROGRESS_STAGES.length - 1])

    act(() => {
      vi.advanceTimersByTime(SCAN_PROGRESS_INTERVAL_MS * 3)
    })
    expect(result.current).toBe(SCAN_PROGRESS_STAGES[SCAN_PROGRESS_STAGES.length - 1])
  })

  it('resets when deactivated', () => {
    const { result, rerender } = renderHook(
      ({ active }) => useScanProgress(active),
      { initialProps: { active: true } },
    )

    act(() => {
      vi.advanceTimersByTime(SCAN_PROGRESS_INTERVAL_MS)
    })
    expect(result.current).toBe(SCAN_PROGRESS_STAGES[1])

    rerender({ active: false })
    expect(result.current).toBe(SCAN_PROGRESS_STAGES[0])
  })
})

describe('ScanProgressIndicator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the target URL and the first progress stage', () => {
    render(<ScanProgressIndicator url="example.com" />)

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(/Scanning example.com, this can take up to a minute/)
    expect(screen.getByText(SCAN_PROGRESS_STAGES[0])).toBeInTheDocument()
    expect(screen.getByText(SCAN_PROGRESS_STAGES[0])).toHaveAttribute('aria-hidden', 'true')
  })

  it('keeps rotating stages out of the live status announcement', () => {
    render(<ScanProgressIndicator url="example.com" />)

    const status = screen.getByRole('status')
    const stage = screen.getByText(SCAN_PROGRESS_STAGES[0])
    expect(stage).toHaveAttribute('aria-hidden', 'true')
    // Status region still includes the fixed copy (visually hidden for AT).
    expect(status.textContent).toMatch(/this can take up to a minute/)
  })

  it('advances the visible stage while mounted', () => {
    render(<ScanProgressIndicator url="https://example.com" />)

    act(() => {
      vi.advanceTimersByTime(SCAN_PROGRESS_INTERVAL_MS)
    })

    expect(screen.getByText(SCAN_PROGRESS_STAGES[1])).toBeInTheDocument()
    expect(screen.getByText(SCAN_PROGRESS_STAGES[1])).toHaveAttribute('aria-hidden', 'true')
  })
})
