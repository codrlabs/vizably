import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card } from '../design-system'
import { Ico, GoogleMark } from '../lib/icons'
import { apiClient } from '../lib/apiClient'
import { openDriveFolderPicker } from '../lib/googlePicker'
import { PROVIDERS } from '../data/placeholders'

const STATUS_UI = {
  loadable: {
    title: 'Vizably account found',
    detail: (v) => `${v?.manifestSummary?.scanCount ?? 0} saved scan${v?.manifestSummary?.scanCount === 1 ? '' : 's'}`,
    action: 'load',
    button: 'Load my account',
    tone: 'success',
  },
  initializable: {
    title: 'Ready to set up',
    detail: () => 'This storage is empty — we can initialize it for Vizably.',
    action: 'init',
    button: 'Set up & continue',
    tone: 'neutral',
  },
  unrelated: {
    title: 'Other files present',
    detail: () => 'No Vizably manifest yet. You can set this up; other files will stay as they are.',
    action: 'init',
    button: 'Set up & continue',
    tone: 'warn',
  },
  incompatible: {
    title: 'Update Vizably required',
    detail: () => 'This store was created by a newer Vizably version.',
    action: null,
    button: null,
    tone: 'error',
  },
  invalid: {
    title: "Can't use this storage",
    detail: (v) => reasonMessage(v?.reason),
    action: null,
    button: null,
    tone: 'error',
  },
}

function reasonMessage(reason) {
  switch (reason) {
    case 'malformed_manifest':
      return 'The manifest in this storage is malformed.'
    case 'too_new':
      return 'This store needs a newer Vizably version.'
    case 'access_denied':
      return 'Vizably does not have access to this storage.'
    case 'not_writable':
      return 'This storage is read-only.'
    case 'not_found':
      return 'Storage was not found.'
    case 'provider_not_available':
      return 'This provider is not available yet.'
    default:
      return reason ? `Validation failed (${reason}).` : 'Validation failed.'
  }
}

function storageRefFromRepo(repo) {
  return {
    id: repo.id,
    full_name: repo.full_name,
    html_url: repo.html_url,
  }
}

function storageRefFromFolder(folder) {
  return {
    id: folder.id,
    name: folder.name,
    url: folder.url || undefined,
  }
}

function findRepoByName(storages, name) {
  const trimmed = name.trim()
  if (!trimmed) return null
  return (
    storages.find((r) => r.name === trimmed) ||
    storages.find((r) => r.full_name === trimmed) ||
    storages.find((r) => r.full_name.endsWith(`/${trimmed}`)) ||
    null
  )
}

/**
 * Connect storage — pick a GitHub repo or Google Drive folder, run fit-check,
 * load or init account.
 *
 * @param {object} props
 * @param {'github' | 'google'} props.provider
 * @param {() => void} props.onDone
 * @param {() => void} props.onCancel
 * @param {string} [props.storageError]
 * @param {import('../lib/apiClient').ApiClient} [props.client]
 * @param {typeof openDriveFolderPicker} [props.openFolderPicker]
 */
export default function ConnectView({
  provider,
  onDone,
  onCancel,
  storageError = null,
  client = apiClient,
  openFolderPicker = openDriveFolderPicker,
}) {
  const pv = PROVIDERS[provider] || PROVIDERS.github
  const isGitHub = provider === 'github'
  const isGoogle = provider === 'google'

  const [mode, setMode] = useState('existing')
  const [newRepoName, setNewRepoName] = useState(pv.dest)
  const [storages, setStorages] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [pickedFolder, setPickedFolder] = useState(null)
  const [pickingFolder, setPickingFolder] = useState(false)
  const [validation, setValidation] = useState(null)
  const [loadingRepos, setLoadingRepos] = useState(false)
  const [validating, setValidating] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState(storageError)
  const [listError, setListError] = useState(null)

  const selectedRepo = useMemo(
    () => storages.find((r) => r.id === selectedId) ?? null,
    [storages, selectedId],
  )

  const activeStorageRef = useMemo(() => {
    if (isGoogle) {
      if (mode === 'existing') {
        return pickedFolder ? storageRefFromFolder(pickedFolder) : null
      }
      const name = newRepoName.trim()
      return name ? { name } : null
    }
    if (!isGitHub) return null
    if (mode === 'existing') {
      return selectedRepo ? storageRefFromRepo(selectedRepo) : null
    }
    const match = findRepoByName(storages, newRepoName)
    return match ? storageRefFromRepo(match) : null
  }, [isGoogle, isGitHub, mode, pickedFolder, selectedRepo, storages, newRepoName])

  const loadStorages = useCallback(async () => {
    if (!isGitHub) return
    setLoadingRepos(true)
    setListError(null)
    try {
      const result = await client.listStorages('github')
      const list = result.storages ?? []
      setStorages(list)
      setSelectedId((prev) => prev || list[0]?.id || '')
    } catch (err) {
      setListError(err.message || 'Failed to load repositories')
      setStorages([])
      setSelectedId('')
    } finally {
      setLoadingRepos(false)
    }
  }, [client, isGitHub])

  useEffect(() => {
    loadStorages()
  }, [loadStorages])

  useEffect(() => {
    setError(storageError)
  }, [storageError])

  useEffect(() => {
    setPickedFolder(null)
    setValidation(null)
    setNewRepoName(pv.dest)
    setMode('existing')
  }, [provider, pv.dest])

  const runValidation = useCallback(async (storageRef) => {
    if (!storageRef?.id) {
      setValidation(null)
      return
    }
    setValidating(true)
    setError(null)
    try {
      const result = await client.validateStorage(provider, storageRef)
      setValidation(result)
    } catch (err) {
      setValidation(null)
      setError(err.message || 'Failed to validate storage')
    } finally {
      setValidating(false)
    }
  }, [client, provider])

  useEffect(() => {
    // New Google folders are created on init — no fit-check until they exist.
    if (isGoogle && mode === 'new') {
      setValidation(null)
      return
    }
    if (!activeStorageRef?.id) {
      setValidation(null)
      return
    }
    runValidation(activeStorageRef)
  }, [isGoogle, mode, activeStorageRef, runValidation])

  const statusUi = validation ? STATUS_UI[validation.status] : null
  const proposedAction =
    isGoogle && mode === 'new' && activeStorageRef
      ? 'init'
      : (statusUi?.action ?? null)
  const canWrite = validation?.capabilities?.canWrite !== false
  const initBlocked = proposedAction === 'init' && validation && !canWrite

  const confirmBlocked = isGoogle && mode === 'new'
    ? !activeStorageRef || confirming
    : (
      !validation ||
      !proposedAction ||
      validation.status === 'incompatible' ||
      validation.status === 'invalid' ||
      initBlocked ||
      (mode === 'new' && !activeStorageRef)
    )

  const confirmLabel = useMemo(() => {
    if (isGoogle && mode === 'new') {
      return activeStorageRef ? 'Create folder & continue' : 'Enter a folder name'
    }
    if (isGitHub && mode === 'new' && !activeStorageRef) {
      return 'Create repo on GitHub first'
    }
    if (statusUi?.button) return statusUi.button
    return 'Continue'
  }, [isGoogle, isGitHub, mode, activeStorageRef, statusUi])

  const handlePickFolder = async () => {
    setPickingFolder(true)
    setError(null)
    try {
      const [config, tokenPayload] = await Promise.all([
        client.getAuthConfig(),
        client.getGoogleAccessToken(),
      ])
      if (!config.googleClientId) {
        throw new Error('Google OAuth client id is not configured on the server')
      }
      if (!tokenPayload.accessToken) {
        throw new Error('Google access token unavailable — sign out and sign in again')
      }
      const folder = await openFolderPicker({
        clientId: config.googleClientId,
        accessToken: tokenPayload.accessToken,
        projectNumber: config.googleCloudProjectNumber,
      })
      if (folder) {
        setPickedFolder(folder)
        setMode('existing')
      }
    } catch (err) {
      setError(err.message || 'Failed to open Google Picker')
    } finally {
      setPickingFolder(false)
    }
  }

  const handleConfirm = async () => {
    if (confirmBlocked || !activeStorageRef || !proposedAction) return

    if (isGitHub && mode === 'new' && !activeStorageRef) {
      setError(
        `Create "${newRepoName.trim()}" on GitHub, install the Vizably app on it, then refresh the list.`,
      )
      return
    }

    setConfirming(true)
    setError(null)
    try {
      await client.setupStorage(provider, activeStorageRef, proposedAction)
      onDone()
    } catch (err) {
      setError(err.message || 'Failed to connect storage')
    } finally {
      setConfirming(false)
    }
  }

  const providerIcon = isGoogle ? GoogleMark(20) : Ico('Github', 20)

  const Option = ({ id, icon, title, desc, children }) => {
    const active = mode === id
    return (
      <div
        onClick={() => setMode(id)}
        style={{
          border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border-default)'}`,
          background: active ? 'var(--accent-subtle)' : 'var(--surface-card)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-4)',
          cursor: 'pointer',
          transition:
            'border-color var(--duration-fast) var(--ease-standard), background var(--duration-fast) var(--ease-standard)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <span
            style={{
              flexShrink: 0,
              width: 22,
              height: 22,
              marginTop: 1,
              borderRadius: '50%',
              border: `2px solid ${active ? 'var(--accent)' : 'var(--border-strong)'}`,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {active && (
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: 'var(--accent)',
                }}
              />
            )}
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: active ? 'var(--accent)' : 'var(--text-muted)' }}>
                {Ico(icon, 17, 'currentColor')}
              </span>
              <span style={{ font: 'var(--font-label)', color: 'var(--text-strong)' }}>
                {title}
              </span>
            </div>
            <p
              style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--text-muted)',
                margin: '4px 0 0',
                lineHeight: 1.45,
              }}
            >
              {desc}
            </p>
            {active && children && <div style={{ marginTop: 12 }}>{children}</div>}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '52px 24px 72px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 460 }}>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '5px 12px',
              borderRadius: 'var(--radius-pill)',
              background: 'var(--surface-card)',
              border: '1px solid var(--border-default)',
              marginBottom: 16,
            }}
          >
            {providerIcon}
            <span style={{ font: 'var(--font-label)', color: 'var(--text-strong)' }}>
              {pv.name} connected
            </span>
            <span style={{ color: 'var(--green-600)' }}>{Ico('Check', 15, 'currentColor')}</span>
          </div>
          <h1 style={{ fontSize: 'var(--text-xl)', margin: '0 0 6px' }}>
            Where should we save your scans?
          </h1>
          <p
            style={{
              font: 'var(--font-body)',
              color: 'var(--text-muted)',
              fontSize: 'var(--text-sm)',
              lineHeight: 1.5,
            }}
          >
            Vizably writes each report to {pv.article} {pv.unit} in your {pv.name} — you stay in
            control of it.
          </p>
        </div>

        {(error || listError) && (
          <div
            role="alert"
            style={{
              marginBottom: 14,
              padding: '10px 12px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--sev-serious-bg)',
              border: '1px solid var(--sev-serious)',
              color: 'var(--sev-serious-fg)',
              fontSize: 'var(--text-sm)',
              lineHeight: 1.45,
            }}
          >
            {error || listError}
          </div>
        )}

        <Card padding="var(--space-5)">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Option
              id="new"
              icon="Plus"
              title={`Create a new ${pv.unit}`}
              desc={
                isGoogle
                  ? 'Create a new Drive folder and initialize it for Vizably.'
                  : `Initialize a fresh private ${pv.unitShort} for Vizably (must exist on GitHub first).`
              }
            >
              <label
                style={{
                  display: 'block',
                  font: 'var(--font-label)',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--text-muted)',
                  marginBottom: 5,
                }}
              >
                {pv.unit.charAt(0).toUpperCase() + pv.unit.slice(1)} name
              </label>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  height: 42,
                  padding: '0 12px',
                  background: 'var(--surface-card)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <span style={{ color: 'var(--text-faint)' }}>{Ico(pv.destIcon, 16)}</span>
                <input
                  value={newRepoName}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setNewRepoName(e.target.value)}
                  style={{
                    flex: 1,
                    border: 'none',
                    outline: 'none',
                    font: 'var(--font-code)',
                    fontSize: 'var(--text-sm)',
                    color: 'var(--text-strong)',
                    background: 'transparent',
                  }}
                />
              </div>
              {isGitHub && mode === 'new' && !activeStorageRef && newRepoName.trim() && (
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', margin: '8px 0 0' }}>
                  Create this repository on GitHub, install the Vizably app on it, then{' '}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      loadStorages()
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      color: 'var(--text-link)',
                      cursor: 'pointer',
                      font: 'inherit',
                      textDecoration: 'underline',
                    }}
                  >
                    refresh the list
                  </button>
                  .
                </p>
              )}
            </Option>

            <Option
              id="existing"
              icon="FolderOpen"
              title={`Use an existing ${pv.unit}`}
              desc={
                isGoogle
                  ? 'Open Google Picker and choose a Drive folder.'
                  : `Pick ${pv.article} ${pv.unit} from your GitHub account.`
              }
            >
              {isGoogle ? (
                <>
                  {pickedFolder ? (
                    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-strong)', margin: '0 0 8px' }}>
                      Selected: <strong>{pickedFolder.name}</strong>
                    </p>
                  ) : (
                    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', margin: '0 0 8px' }}>
                      No folder selected yet.
                    </p>
                  )}
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={(e) => {
                      e.stopPropagation()
                      handlePickFolder()
                    }}
                    disabled={pickingFolder}
                  >
                    {pickingFolder
                      ? 'Opening Picker…'
                      : pickedFolder
                        ? 'Choose a different folder'
                        : 'Choose folder in Google Drive'}
                  </Button>
                </>
              ) : loadingRepos ? (
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', margin: 0 }}>
                  Loading repositories…
                </p>
              ) : storages.length === 0 ? (
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', margin: 0 }}>
                  No repositories found. Create one on GitHub or check app installation.
                </p>
              ) : (
                <div style={{ position: 'relative' }}>
                  <select
                    value={selectedId}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setSelectedId(e.target.value)}
                    style={{
                      width: '100%',
                      height: 42,
                      padding: '0 12px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-strong)',
                      font: 'var(--font-sans)',
                      fontSize: 'var(--text-sm)',
                      color: 'var(--text-strong)',
                      background: 'var(--surface-card)',
                      appearance: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    {storages.map((repo) => (
                      <option key={repo.id} value={repo.id}>
                        {repo.full_name}
                        {repo.private ? ' (private)' : ''}
                      </option>
                    ))}
                  </select>
                  <span
                    style={{
                      position: 'absolute',
                      right: 12,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      pointerEvents: 'none',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {Ico('ChevronDown', 16)}
                  </span>
                </div>
              )}
              {isGitHub && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    loadStorages()
                  }}
                  style={{
                    marginTop: 8,
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    color: 'var(--text-link)',
                    cursor: 'pointer',
                    fontSize: 'var(--text-xs)',
                    textDecoration: 'underline',
                  }}
                >
                  Refresh repository list
                </button>
              )}
            </Option>
          </div>
        </Card>

        {validating && (
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 14 }}>
            Checking storage…
          </p>
        )}

        {isGoogle && mode === 'new' && activeStorageRef && (
          <div
            style={{
              marginTop: 14,
              padding: '12px 14px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-inset)',
              border: '1px solid var(--border-default)',
            }}
          >
            <div style={{ font: 'var(--font-label)', color: 'var(--text-strong)' }}>
              Ready to create
            </div>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-body)', margin: '6px 0 0', lineHeight: 1.45 }}>
              We&apos;ll create &ldquo;{activeStorageRef.name}&rdquo; in your Drive and set it up for Vizably.
            </p>
          </div>
        )}

        {validation && statusUi && !validating && !(isGoogle && mode === 'new') && (
          <div
            style={{
              marginTop: 14,
              padding: '12px 14px',
              borderRadius: 'var(--radius-md)',
              background:
                statusUi.tone === 'success'
                  ? 'var(--green-50)'
                  : statusUi.tone === 'warn'
                    ? 'var(--sev-moderate-bg)'
                    : statusUi.tone === 'error'
                      ? 'var(--sev-serious-bg)'
                      : 'var(--bg-inset)',
              border: `1px solid ${
                statusUi.tone === 'success'
                  ? 'var(--green-200)'
                  : statusUi.tone === 'warn'
                    ? 'var(--sev-moderate)'
                    : statusUi.tone === 'error'
                      ? 'var(--sev-serious)'
                      : 'var(--border-default)'
              }`,
            }}
          >
            <div style={{ font: 'var(--font-label)', color: 'var(--text-strong)' }}>
              {statusUi.title}
            </div>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-body)', margin: '6px 0 0', lineHeight: 1.45 }}>
              {statusUi.detail(validation)}
            </p>
            {validation.reason === 'repairable' && (
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', margin: '6px 0 0' }}>
                The scan index will be rebuilt when you load this account.
              </p>
            )}
            {initBlocked && (
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--sev-serious-fg)', margin: '8px 0 0' }}>
                This storage is read-only — you can load saved scans but cannot set up or save new ones.
              </p>
            )}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
            marginTop: 16,
            padding: '12px 16px',
            background: 'var(--bg-inset)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <span style={{ color: 'var(--text-muted)', marginTop: 1 }}>
            {Ico('ShieldCheck', 16, 'currentColor')}
          </span>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-body)', lineHeight: 1.5, margin: 0 }}>
            Scope: <code style={{ font: 'var(--font-code)', color: 'var(--text-strong)' }}>{pv.scope}</code> —{' '}
            {pv.scopeNote.toLowerCase()}.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <Button variant="secondary" size="lg" onClick={onCancel}>
            Back
          </Button>
          <Button
            variant="primary"
            size="lg"
            style={{ flex: 1 }}
            disabled={confirmBlocked || confirming || validating || pickingFolder}
            onClick={handleConfirm}
            iconRight={Ico('ArrowRight', 17, '#fff')}
          >
            {confirming ? 'Connecting…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
