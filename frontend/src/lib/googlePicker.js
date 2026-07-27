/**
 * Google Picker — folder selection via the official drive-picker web component.
 *
 * Uses the session OAuth token (`drive.file`). We intentionally omit
 * `developer-key` by default: restricted API keys commonly produce a blank
 * Picker or “API developer key is invalid”. OAuth token + app id is enough.
 *
 * setAppId must be the Cloud **project number** (IAM & Admin → Settings).
 * OAuth web client must list the Vite origin under Authorized JavaScript origins.
 */

import '@googleworkspace/drive-picker-element'

/**
 * Resolve Cloud project number for PickerBuilder.setAppId.
 *
 * @param {string | null | undefined} projectNumber
 * @param {string} clientId
 * @returns {string}
 */
export function resolvePickerAppId(projectNumber, clientId) {
  const explicit = projectNumber != null ? String(projectNumber).trim() : ''
  if (explicit) return explicit
  const prefix = String(clientId).split('-')[0]
  if (!/^\d+$/.test(prefix)) {
    throw new Error(
      'GOOGLE_CLOUD_PROJECT_NUMBER is required (Cloud Console → IAM & Admin → Settings → Project number)',
    )
  }
  return prefix
}

/**
 * @param {unknown} detail
 * @returns {string}
 */
function pickerErrorMessage(detail) {
  if (!detail) return 'Google Picker failed'
  if (typeof detail === 'string') return detail
  if (typeof detail === 'object') {
    const obj = /** @type {Record<string, unknown>} */ (detail)
    if (typeof obj.message === 'string') return obj.message
    if (typeof obj.error === 'string') return obj.error
    if (typeof obj.error_description === 'string') return obj.error_description
  }
  return 'Google Picker failed'
}

/**
 * Open a folder-only Google Picker.
 *
 * @param {object} opts
 * @param {string} opts.clientId GOOGLE_CLIENT_ID
 * @param {string} opts.accessToken session access token with drive.file
 * @param {string} [opts.projectNumber] Cloud project number for setAppId
 * @param {string} [opts.apiKey] optional; only used if `useDeveloperKey` is true
 * @param {boolean} [opts.useDeveloperKey=false]
 * @param {string} [opts.title]
 * @returns {Promise<{ id: string, name: string, url: string | null } | null>}
 */
export async function openDriveFolderPicker({
  clientId,
  accessToken,
  projectNumber,
  apiKey,
  useDeveloperKey = false,
  title = 'Choose a Drive folder for Vizably',
}) {
  if (!clientId) {
    throw new Error('Google OAuth client id is not configured (GOOGLE_CLIENT_ID)')
  }
  if (!accessToken) {
    throw new Error('Google access token is required to open the Picker')
  }

  if (typeof document === 'undefined') {
    throw new Error('Google Picker requires a browser environment')
  }

  const appId = resolvePickerAppId(projectNumber, clientId)

  return new Promise((resolve, reject) => {
    const host = document.createElement('drive-picker')
    host.setAttribute('app-id', appId)
    host.setAttribute('client-id', clientId)
    host.setAttribute('oauth-token', accessToken)
    host.setAttribute('scope', 'https://www.googleapis.com/auth/drive.file')
    host.setAttribute('title', title)
    // Keep GIS from prompting when we already have a session token.
    host.setAttribute('prompt', 'none')

    if (useDeveloperKey && apiKey) {
      host.setAttribute('developer-key', apiKey)
    }

    const view = document.createElement('drive-picker-docs-view')
    view.setAttribute('view-id', 'FOLDERS')
    view.setAttribute('include-folders', 'true')
    view.setAttribute('select-folder-enabled', 'true')
    view.setAttribute('parent', 'root')
    host.appendChild(view)

    const cleanup = () => {
      host.remove()
    }

    host.addEventListener('picker-picked', (event) => {
      const detail = /** @type {CustomEvent} */ (event).detail
      const doc = detail?.docs?.[0]
      cleanup()
      if (!doc?.id) {
        resolve(null)
        return
      }
      resolve({
        id: doc.id,
        name: doc.name || 'Drive folder',
        url: doc.url || null,
      })
    })

    host.addEventListener('picker-canceled', () => {
      cleanup()
      resolve(null)
    })

    host.addEventListener('picker-error', (event) => {
      cleanup()
      reject(new Error(pickerErrorMessage(/** @type {CustomEvent} */ (event).detail)))
    })

    host.addEventListener('picker-oauth-error', (event) => {
      cleanup()
      reject(new Error(pickerErrorMessage(/** @type {CustomEvent} */ (event).detail)))
    })

    document.body.appendChild(host)
  })
}
