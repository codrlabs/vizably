import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useScan } from '../hooks/useScan'

describe('useScan', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns a missing-url error without calling the client', () => {
    const client = { getScanResults: vi.fn() }
    const { result } = renderHook(() => useScan(null, { client }))

    expect(result.current).toEqual({
      data: null,
      loading: false,
      error: 'No URL provided in query params',
    })
    expect(client.getScanResults).not.toHaveBeenCalled()
  })

  it('loads scan results for a URL', async () => {
    const payload = { problems: {}, whatsGood: [] }
    const client = {
      getScanResults: vi.fn().mockResolvedValue(payload),
    }
    const { result } = renderHook(() =>
      useScan('https://example.com', { client }),
    )

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual(payload)
    expect(result.current.error).toBeNull()
    expect(client.getScanResults).toHaveBeenCalledWith('https://example.com')
  })

  it('surfaces fetch errors', async () => {
    const client = {
      getScanResults: vi.fn().mockRejectedValue(new Error('offline')),
    }
    const { result } = renderHook(() =>
      useScan('https://example.com', { client }),
    )

    await waitFor(() => expect(result.current.error).toBe('offline'))
    expect(result.current.data).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it('ignores late responses after unmount', async () => {
    let resolve
    const client = {
      getScanResults: vi.fn(
        () => new Promise((r) => {
          resolve = r
        }),
      ),
    }
    const { result, unmount } = renderHook(() =>
      useScan('https://example.com', { client }),
    )

    expect(result.current.loading).toBe(true)
    unmount()
    resolve({ problems: {} })
    // No throw / state update after unmount — loading stays as last observed.
    expect(result.current.loading).toBe(true)
  })
})
