import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card } from '../design-system'
import { Ico, GoogleMark } from '../lib/icons'
import { apiClient } from '../lib/apiClient'
import { PROVIDERS } from '../data/placeholders'
import { VIZABLY_DEFAULT_STORE_NAME } from '../utils/githubRepoName'

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

function storageRefFromHit(hit) {
  const ref = hit.storageRef || hit
  return {
    id: ref.id,
    full_name: ref.full_name,
    html_url: ref.html_url,
    name: ref.name,
  }
}

/**
 * Connect storage — discover or create the Vizably store, then load or init.
 *
 * @param {object} props
 * @param {'github' | 'google'} props.provider
 * @param {() => void} props.onDone
 * @param {() => void} props.onCancel
 * @param {string} [props.storageError]
 * @param {import('../lib/apiClient').ApiClient} [props.client]
 */
export default function ConnectView({
  provider,
  onDone,
  onCancel,
  storageError = null,
  client = apiClient,
}) {
  const pv = PROVIDERS[provider] || PROVIDERS.github
  const isGitHub = provider === 'github'

  const [stores, setStores] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [createdRef, setCreatedRef] = useState(null)
  const [validation, setValidation] = useState(null)
  const [needsInstall, setNeedsInstall] = useState(false)
  const [installUrl, setInstallUrl] = useState(null)
  const [discovering, setDiscovering] = useState(false)
  const [creating, setCreating] = useState(false)
  const [validating, setValidating] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState(storageError)

  const selectedHit = useMemo(
    () => stores.find((hit) => hit.storageRef.id === selectedId) ?? null,
    [stores, selectedId],
  )

  const activeStorageRef = createdRef || (selectedHit ? storageRefFromHit(selectedHit) : null)
  const statusUi = validation ? STATUS_UI[validation.status] : null
  const proposedAction = statusUi?.action ?? null
  const canWrite = validation?.capabilities?.canWrite !== false
  const initBlocked = proposedAction === 'init' && validation && !canWrite
  const emptyAccount = stores.length === 0 && !createdRef
  const ambiguous = stores.length > 1 && !createdRef

  const confirmBlocked =
    needsInstall ||
    (!emptyAccount &&
      (!validation ||
        !proposedAction ||
        validation.status === 'incompatible' ||
        validation.status === 'invalid' ||
        initBlocked ||
        !activeStorageRef))

  const confirmLabel = useMemo(() => {
    if (emptyAccount) return 'Set up Vizably storage'
    if (statusUi?.button) return statusUi.button
    return 'Continue'
  }, [emptyAccount, statusUi])

  const runValidation = useCallback(
    async (storageRef) => {
      if (!storageRef) {
        setValidation(null)
        return
      }
      setValidating(true)
      setError(null)
      try {
        const result = await client.validateStorage('github', storageRef)
        setValidation(result)
        if (result?.capabilities?.canWrite) {
          setNeedsInstall(false)
        }
      } catch (err) {
        setValidation(null)
        setError(err.message || 'Failed to validate storage')
      } finally {
        setValidating(false)
      }
    },
    [client],
  )

  const loadDiscovery = useCallback(async () => {
    if (!isGitHub) return []
    setDiscovering(true)
    setError(null)
    try {
      const result = await client.discoverStorages('github')
      const list = result.stores ?? []
      setStores(list)
      setSelectedId((prev) => {
        if (prev && list.some((hit) => hit.storageRef.id === prev)) return prev
        return list[0]?.storageRef.id || ''
      })
      return list
    } catch (err) {
      setError(err.message || 'Failed to look up Vizably storage')
      setStores([])
      setSelectedId('')
      return []
    } finally {
      setDiscovering(false)
    }
  }, [client, isGitHub])

  useEffect(() => {
    loadDiscovery()
  }, [loadDiscovery])

  useEffect(() => {
    setError(storageError)
  }, [storageError])

  useEffect(() => {
    if (!isGitHub) return
    if (needsInstall) {
      setValidation(null)
      return
    }
    if (createdRef) {
      runValidation(createdRef)
      return
    }
    if (selectedHit) {
      setValidation(selectedHit.validation)
    } else {
      setValidation(null)
    }
  }, [isGitHub, createdRef, selectedHit, needsInstall, runValidation])

  const handleCreateDefault = async () => {
    if (creating) return
    setCreating(true)
    setError(null)
    setNeedsInstall(false)
    setInstallUrl(null)
    try {
      const result = await client.createStorage()
      const ref = storageRefFromHit({ storageRef: result.storageRef })
      setCreatedRef(ref)
      if (result.needsInstall) {
        setNeedsInstall(true)
        setInstallUrl(result.installUrl)
        setValidation(null)
      } else {
        setNeedsInstall(false)
        setInstallUrl(null)
        setConfirming(true)
        try {
          await client.setupStorage('github', ref, 'init')
          onDone()
        } catch (initErr) {
          setError(initErr.message || 'Failed to connect storage')
          await runValidation(ref)
        } finally {
          setConfirming(false)
        }
      }
    } catch (err) {
      if (err.storageRef) {
        setCreatedRef(storageRefFromHit({ storageRef: err.storageRef }))
        setNeedsInstall(false)
        setInstallUrl(null)
      }
      setError(err.message || 'Failed to create storage')
    } finally {
      setCreating(false)
    }
  }

  const handleRefreshAfterInstall = async () => {
    setError(null)
    const list = await loadDiscovery()
    const match =
      (createdRef && list.find((hit) => hit.storageRef.id === createdRef.id)) ||
      createdRef
    if (!match) {
      setError(
        'Repository not found yet. Add it to the Vizably GitHub App installation, then refresh again.',
      )
      return
    }
    const ref = storageRefFromHit(match.storageRef ? match : { storageRef: match })
    setCreatedRef(ref)
    setNeedsInstall(false)
    await runValidation(ref)
  }

  const handleConfirm = async () => {
    if (emptyAccount) {
      await handleCreateDefault()
      return
    }
    if (confirmBlocked || !activeStorageRef || !proposedAction) return

    setConfirming(true)
    setError(null)
    try {
      await client.setupStorage('github', activeStorageRef, proposedAction)
      onDone()
    } catch (err) {
      setError(err.message || 'Failed to connect storage')
    } finally {
      setConfirming(false)
    }
  }

  const providerIcon = provider === 'google' ? GoogleMark(20) : Ico('Github', 20)

  if (!isGitHub) {
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
        <div style={{ width: '100%', maxWidth: 460, textAlign: 'center' }}>
          <h1 style={{ fontSize: 'var(--text-xl)', margin: '0 0 8px' }}>
            Google sign-in coming in Phase 3
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', lineHeight: 1.5 }}>
            Google Drive storage uses the Google Picker and is not wired yet. Use GitHub for now.
          </p>
          <Button variant="secondary" size="lg" onClick={onCancel} style={{ marginTop: 20 }}>
            Back
          </Button>
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
            Connect your Vizably storage
          </h1>
          <p
            style={{
              font: 'var(--font-body)',
              color: 'var(--text-muted)',
              fontSize: 'var(--text-sm)',
              lineHeight: 1.5,
            }}
          >
            Vizably finds or creates a private {pv.unit} for your scans. You stay in control of it.
          </p>
        </div>

        {error && (
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
            {error}
          </div>
        )}

        <Card padding="var(--space-5)">
          {discovering ? (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', margin: 0 }}>
              Looking for Vizably storage…
            </p>
          ) : emptyAccount ? (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-body)', margin: 0, lineHeight: 1.5 }}>
              No Vizably account store yet. We&apos;ll create{' '}
              <code style={{ font: 'var(--font-code)' }}>{VIZABLY_DEFAULT_STORE_NAME}</code>
              {' '}(or the next free name) as a private repository under your GitHub account.
            </p>
          ) : ambiguous ? (
            <div>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-body)', margin: '0 0 10px', lineHeight: 1.5 }}>
                More than one Vizably store was found. Pick which one to use on this device.
              </p>
              <div style={{ position: 'relative' }}>
                <select
                  value={selectedId}
                  onChange={(e) => setSelectedId(e.target.value)}
                  aria-label="Choose Vizably storage"
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
                  {stores.map((hit) => (
                    <option key={hit.storageRef.id} value={hit.storageRef.id}>
                      {hit.storageRef.full_name}
                      {hit.validation?.manifestSummary?.scanCount != null
                        ? ` — ${hit.validation.manifestSummary.scanCount} scans`
                        : ''}
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
            </div>
          ) : (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-body)', margin: 0, lineHeight: 1.5 }}>
              Using{' '}
              <code style={{ font: 'var(--font-code)' }}>
                {activeStorageRef?.full_name || VIZABLY_DEFAULT_STORE_NAME}
              </code>
              .
            </p>
          )}

          {needsInstall && (
            <div
              style={{
                marginTop: 12,
                padding: '10px 12px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--sev-moderate-bg)',
                border: '1px solid var(--sev-moderate)',
                fontSize: 'var(--text-sm)',
                color: 'var(--text-body)',
                lineHeight: 1.45,
              }}
            >
              <p style={{ margin: 0 }}>
                Repository created
                {createdRef?.full_name ? (
                  <>
                    {' '}
                    (<code style={{ font: 'var(--font-code)' }}>{createdRef.full_name}</code>)
                  </>
                ) : null}
                . Add it to your Vizably GitHub App installation, then continue.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
                {installUrl && (
                  <a
                    href={installUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--text-link)' }}
                  >
                    Open GitHub App install
                  </a>
                )}
                <button
                  type="button"
                  onClick={handleRefreshAfterInstall}
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
                  I&apos;ve added it — refresh
                </button>
              </div>
            </div>
          )}
        </Card>

        {validating && (
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 14 }}>
            Checking storage…
          </p>
        )}

        {validation && statusUi && !validating && !needsInstall && (
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
            disabled={
              discovering ||
              creating ||
              confirming ||
              validating ||
              (emptyAccount ? false : confirmBlocked)
            }
            onClick={handleConfirm}
            iconRight={Ico('ArrowRight', 17, '#fff')}
          >
            {creating ? 'Creating…' : confirming ? 'Connecting…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
