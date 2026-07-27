/**
 * The single place the frontend imports `fetch`. Pages and hooks
 * receive the singleton instance and call typed methods on it; tests
 * substitute a fake.
 *
 * Session cookies — not Bearer tokens. All API calls use
 * `credentials: 'include'`.
 *
 * @typedef {import('../../../shared/types.js').ScanResult} ScanResult
 * @typedef {import('../../../shared/types.js').Problem} Problem
 */

export class ApiClient {
  /**
   * @param {object} [opts]
   * @param {string} [opts.baseUrl]
   * @param {typeof fetch} [opts.fetchImpl]
   */
  constructor({ baseUrl = '', fetchImpl } = {}) {
    this.baseUrl = baseUrl
    // `window.fetch` must be invoked with `window` as its receiver, otherwise
    // browsers throw "Illegal invocation". Binding here keeps callers free to
    // do `this.fetchImpl(...)` without worrying about the receiver.
    this.fetchImpl = fetchImpl ?? globalThis.fetch.bind(globalThis)
  }

  /**
   * @param {string} path
   * @param {RequestInit} [init]
   */
  async _request(path, init = {}) {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      credentials: 'include',
      ...init,
      headers: {
        ...(init.headers || {}),
      },
    })

    if (!res.ok) {
      let message = `HTTP ${res.status}: ${res.statusText}`
      try {
        const body = await res.json()
        if (body?.error) {
          message = body.error
        }
      } catch {
        // Non-JSON error bodies fall back to status text.
      }
      throw new Error(message)
    }

    return res.json()
  }

  /** Full-page redirect to GitHub OAuth. */
  githubLogin() {
    if (typeof globalThis.location === 'undefined') {
      return
    }
    globalThis.location.href = `${this.baseUrl}/api/auth/github`
  }

  /** Full-page redirect to Google OAuth. */
  googleLogin() {
    if (typeof globalThis.location === 'undefined') {
      return
    }
    globalThis.location.href = `${this.baseUrl}/api/auth/google`
  }

  /**
   * Public Google Picker config (client id + browser API key + project number).
   * @returns {Promise<{
   *   googleClientId: string | null,
   *   googlePickerApiKey: string | null,
   *   googleCloudProjectNumber: string | null,
   * }>}
   */
  getAuthConfig() {
    return this._request('/api/auth/config')
  }

  /**
   * Session-bound Google access token for the Picker.
   * @returns {Promise<{ accessToken: string }>}
   */
  getGoogleAccessToken() {
    return this._request('/api/auth/google/token')
  }

  /** @returns {Promise<{ authenticated: boolean, user: object | null }>} */
  getAuthStatus() {
    return this._request('/api/auth/status')
  }

  /** @returns {Promise<object>} */
  getUser() {
    return this._request('/api/auth/user')
  }

  /** @returns {Promise<{ success: boolean }>} */
  logout() {
    return this._request('/api/auth/logout', { method: 'POST' })
  }

  /**
   * @param {'github' | 'google'} provider
   * @returns {Promise<{ provider: string, storages: object[] }>}
   */
  listStorages(provider) {
    return this._request(
      `/api/auth/storages?provider=${encodeURIComponent(provider)}`,
    )
  }

  /**
   * @param {'github' | 'google'} provider
   * @param {object} storageRef
   * @returns {Promise<object>}
   */
  validateStorage(provider, storageRef) {
    return this._request('/api/auth/storage/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, storageRef }),
    })
  }

  /**
   * @param {'github' | 'google'} provider
   * @param {object} storageRef
   * @param {'load' | 'init'} action
   * @returns {Promise<object>}
   */
  setupStorage(provider, storageRef, action) {
    return this._request('/api/auth/storage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, storageRef, action }),
    })
  }

  /**
   * Kick off a scan against `url`.
   * @param {string} url
   * @returns {Promise<ScanResult & { account?: { scanCount: number, scans: object[] } }>}
   */
  runScan(url) {
    return this._request('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
  }

  /**
   * Get already-computed scan results for `url`.
   * @param {string} url
   * @returns {Promise<ScanResult>}
   */
  getScanResults(url) {
    return this._request(`/api/scan-results?url=${encodeURIComponent(url)}`)
  }

  /**
   * Load a saved historical report by scan id from attached storage.
   * @param {string} scanId
   * @returns {Promise<{ id: string, url: string, scannedAt: string | null, result: ScanResult }>}
   */
  getSavedScan(scanId) {
    return this._request(`/api/scans/${encodeURIComponent(scanId)}`)
  }

  /**
   * Look up a single problem by id.
   * @param {string} id
   * @returns {Promise<Problem>}
   */
  getProblem(id) {
    return this._request(`/problems/${encodeURIComponent(id)}`)
  }
}

// Default singleton — pages and hooks should import this rather than
// constructing their own instance.
export const apiClient = new ApiClient({ baseUrl: '' })
