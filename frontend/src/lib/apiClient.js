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

const GOOGLE_LOGIN_UNAVAILABLE = 'Google sign-in is not available until Phase 3'

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
      let code
      let storageRef
      try {
        const body = await res.json()
        if (body?.error) {
          message = body.error
        }
        if (body?.code) {
          code = body.code
        }
        if (body?.storageRef) {
          storageRef = body.storageRef
        }
      } catch {
        // Non-JSON error bodies fall back to status text.
      }
      const err = new Error(message)
      err.status = res.status
      if (code) err.code = code
      if (storageRef) err.storageRef = storageRef
      throw err
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

  /** Phase 3 stub — Google sign-in is not wired in Phase 2. */
  googleLogin() {
    throw new Error(GOOGLE_LOGIN_UNAVAILABLE)
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
   * Wipe Vizably files (manifest + scans/) from the attached store.
   * @returns {Promise<{
   *   success: boolean,
   *   wiped: boolean,
   *   pathsRemoved: string[],
   *   storageRef: object,
   * }>}
   */
  wipeAccount() {
    return this._request('/api/auth/account/wipe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
  }

  /**
   * Delete the GitHub repository that holds the account store.
   * Uses the session-attached storage only (no client-supplied storageRef).
   * @returns {Promise<{ success: boolean, deleted: boolean, full_name: string }>}
   */
  deleteAccountRepository() {
    return this._request('/api/auth/account/delete-repository', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    })
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
   * Check whether a GitHub repository name is available for the signed-in user.
   * @param {string} name
   * @returns {Promise<{
   *   provider: string,
   *   name: string,
   *   normalizedName: string | null,
   *   full_name: string | null,
   *   status: 'available' | 'taken' | 'invalid' | 'error',
   *   message: string,
   * }>}
   */
  checkRepoNameAvailability(name) {
    return this._request(
      `/api/auth/storage/name-availability?provider=github&name=${encodeURIComponent(name)}`,
    )
  }

  /**
   * Create a private empty GitHub repository for storage onboarding.
   * @param {string} name repository name (not owner/name)
   * @returns {Promise<{
   *   provider: string,
   *   storageRef: object,
   *   needsInstall: boolean,
   *   installUrl: string | null,
   * }>}
   */
  createStorage(name) {
    return this._request('/api/auth/storage/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'github', name }),
    })
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
   * List the saved scans held in the user's attached storage.
   *
   * The list is not carried on the session — it grows with every scan and
   * the session has to fit in a cookie — so it is fetched on demand.
   * @returns {Promise<{ scanCount: number, scans: object[] }>}
   */
  listScans() {
    return this._request('/api/scans')
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
    return this._request(`/api/problems/${encodeURIComponent(id)}`)
  }
}

// Default singleton — pages and hooks should import this rather than
// constructing their own instance.
export const apiClient = new ApiClient({ baseUrl: '' })
