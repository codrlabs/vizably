import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ApiClient } from '../lib/apiClient'

function mockFetch(responseBody, { ok = true, status = 200, statusText = 'OK' } = {}) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    statusText,
    json: async () => responseBody,
  })
}

describe('ApiClient', () => {
  beforeEach(() => {
    vi.stubGlobal('location', { href: 'http://localhost:5173/' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends credentials: include on scan requests', async () => {
    const fetchImpl = mockFetch({ problems: {}, whatsGood: [] })
    const client = new ApiClient({ fetchImpl })

    await client.runScan('https://example.com')

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/scan',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('sends credentials: include on auth requests', async () => {
    const fetchImpl = mockFetch({ authenticated: false, user: null })
    const client = new ApiClient({ fetchImpl })

    await client.getAuthStatus()

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/auth/status',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('githubLogin redirects to the backend OAuth route', () => {
    const client = new ApiClient()
    client.githubLogin()
    expect(globalThis.location.href).toBe('/api/auth/github')
  })

  it('googleLogin throws until Phase 3', () => {
    const client = new ApiClient()
    expect(() => client.googleLogin()).toThrow(/Phase 3/)
  })

  it('getAuthStatus calls GET /api/auth/status', async () => {
    const fetchImpl = mockFetch({ authenticated: true, user: { id: '1' } })
    const client = new ApiClient({ fetchImpl })

    const result = await client.getAuthStatus()

    expect(fetchImpl).toHaveBeenCalledWith('/api/auth/status', expect.any(Object))
    expect(result.authenticated).toBe(true)
  })

  it('getUser calls GET /api/auth/user', async () => {
    const fetchImpl = mockFetch({ id: '1', username: 'sam' })
    const client = new ApiClient({ fetchImpl })

    const user = await client.getUser()

    expect(fetchImpl).toHaveBeenCalledWith('/api/auth/user', expect.any(Object))
    expect(user.username).toBe('sam')
  })

  it('logout calls POST /api/auth/logout', async () => {
    const fetchImpl = mockFetch({ success: true })
    const client = new ApiClient({ fetchImpl })

    const result = await client.logout()

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
    expect(result.success).toBe(true)
  })

  it('listStorages calls GET /api/auth/storages with provider', async () => {
    const fetchImpl = mockFetch({ provider: 'github', storages: [] })
    const client = new ApiClient({ fetchImpl })

    await client.listStorages('github')

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/auth/storages?provider=github',
      expect.any(Object),
    )
  })

  it('discoverStorages calls GET /api/auth/storage/discover', async () => {
    const fetchImpl = mockFetch({ provider: 'github', stores: [], source: 'list' })
    const client = new ApiClient({ fetchImpl })

    await client.discoverStorages('github')

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/auth/storage/discover?provider=github',
      expect.any(Object),
    )
  })

  it('createStorage omits name for the default store', async () => {
    const fetchImpl = mockFetch({ provider: 'github', storageRef: { name: 'viz_scans' } })
    const client = new ApiClient({ fetchImpl })

    await client.createStorage()

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/auth/storage/create',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ provider: 'github' }),
      }),
    )
  })

  it('validateStorage posts provider and storageRef', async () => {
    const fetchImpl = mockFetch({ status: 'loadable' })
    const client = new ApiClient({ fetchImpl })
    const storageRef = { id: 'R_x', full_name: 'sam/repo' }

    await client.validateStorage('github', storageRef)

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/auth/storage/validate',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ provider: 'github', storageRef }),
      }),
    )
  })

  it('setupStorage posts load or init action', async () => {
    const fetchImpl = mockFetch({ success: true })
    const client = new ApiClient({ fetchImpl })
    const storageRef = { id: 'R_x', full_name: 'sam/repo' }

    await client.setupStorage('github', storageRef, 'load')

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/auth/storage',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          provider: 'github',
          storageRef,
          action: 'load',
        }),
      }),
    )
  })

  it('surfaces API error messages from JSON bodies', async () => {
    const fetchImpl = mockFetch({ error: 'Not authenticated' }, {
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    })
    const client = new ApiClient({ fetchImpl })

    await expect(client.getUser()).rejects.toThrow('Not authenticated')
  })

  it('keeps existing scan and problem endpoints', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ problems: {}, whatsGood: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ problems: {}, whatsGood: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ id: 'contrast-1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          id: 'scan-1',
          url: 'https://example.com',
          scannedAt: '2026-07-10T12:00:00Z',
          result: { problems: {}, whatsGood: [] },
        }),
      })

    const client = new ApiClient({ fetchImpl })

    await client.runScan('https://example.com')
    await client.getScanResults('https://example.com')
    await client.getProblem('contrast-1')
    await client.getSavedScan('scan-1')

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      '/api/scan',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      '/api/scan-results?url=https%3A%2F%2Fexample.com',
      expect.any(Object),
    )
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      '/api/problems/contrast-1',
      expect.any(Object),
    )
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      '/api/scans/scan-1',
      expect.any(Object),
    )
  })

  it('lists saved scans from the user store', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ scanCount: 2, scans: [{ id: 'scan-1' }, { id: 'scan-2' }] }),
    })

    const client = new ApiClient({ fetchImpl })
    const result = await client.listScans()

    expect(fetchImpl).toHaveBeenCalledWith('/api/scans', expect.any(Object))
    expect(result.scanCount).toBe(2)
    expect(result.scans).toHaveLength(2)
  })

  it('deletes a saved scan by id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ scanCount: 1, scans: [{ id: 'scan-2' }] }),
    })

    const client = new ApiClient({ fetchImpl })
    const result = await client.deleteScan('scan-1')

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/scans/scan-1',
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(result.scanCount).toBe(1)
    expect(result.scans).toEqual([{ id: 'scan-2' }])
  })
})
