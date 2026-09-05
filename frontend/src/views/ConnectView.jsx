import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card } from '../design-system'
import { Ico, GoogleMark } from '../lib/icons'
import { apiClient } from '../lib/apiClient'
import { PROVIDERS } from '../data/placeholders'
import { normalizeGitHubRepoName } from '../utils/githubRepoName'

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

function isGitHubAccessLost(err) {
  return (
    err?.code === 'GITHUB_AUTH_REVOKED' ||
    err?.status === 401 ||
    /GitHub client is not available/i.test(err?.message || '')
  )
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

const NAME_CHECK_DEBOUNCE_MS = 400

/**
 * Stable option card — must live outside ConnectView so typing into nested
 * inputs does not remount this tree (and steal focus) on every keystroke.
 */
function ConnectOption({ active, onSelect, icon, title, desc, children }) {
  return (
    <div
      onClick={onSelect}
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

/**
 * Connect storage — pick a GitHub repo, run fit-check, load or init account.
 *
 * @param {object} props
 * @param {'github' | 'google'} props.provider
 * @param {() => void} props.onDone
 * @param {() => void} props.onCancel
 * @param {() => void | Promise<void>} [props.onReconnect]
 * @param {string} [props.storageError]
 * @param {import('../lib/apiClient').ApiClient} [props.client]
 */
export default function ConnectView({
  provider,
  onDone,
  onCancel,
  onReconnect,
  storageError = null,
  client = apiClient,
}) {
  const pv = PROVIDERS[provider] || PROVIDERS.github
  const isGitHub = provider === 'github'

  const [mode, setMode] = useState('existing')
  const [newRepoName, setNewRepoName] = useState(pv.dest)
  const [storages, setStorages] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [createdStorageRef, setCreatedStorageRef] = useState(null)
  const [needsInstall, setNeedsInstall] = useState(false)
  const [installUrl, setInstallUrl] = useState(null)
  const [validation, setValidation] = useState(null)
  const [loadingRepos, setLoadingRepos] = useState(false)
  const [creating, setCreating] = useState(false)
  const [validating, setValidating] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState(storageError)
  const [listError, setListError] = useState(null)
  const [needsReconnect, setNeedsReconnect] = useState(false)
  const [nameAvailability, setNameAvailability] = useState(null)
  const [checkingName, setCheckingName] = useState(false)

  const selectedRepo = useMemo(
    () => storages.find((r) => r.id === selectedId) ?? null,
    [storages, selectedId],
  )

  const activeStorageRef = useMemo(() => {
    if (!isGitHub) return null
    if (mode === 'existing') {
      return selectedRepo ? storageRefFromRepo(selectedRepo) : null
    }
    if (createdStorageRef) {
      return {
        id: createdStorageRef.id,
        full_name: createdStorageRef.full_name,
        html_url: createdStorageRef.html_url,
      }
    }
    const match = findRepoByName(storages, newRepoName)
    return match ? storageRefFromRepo(match) : null
  }, [isGitHub, mode, selectedRepo, storages, newRepoName, createdStorageRef])

  const loadStorages = useCallback(async () => {
    if (!isGitHub) return
    setLoadingRepos(true)
    setListError(null)
    setNeedsReconnect(false)
    try {
      const result = await client.listStorages('github')
      const list = result.storages ?? []
      setStorages(list)
      setSelectedId((prev) => prev || list[0]?.id || '')
      return list
    } catch (err) {
      const lost = isGitHubAccessLost(err)
      setNeedsReconnect(lost)
      setListError(
        lost
          ? 'GitHub access was revoked. Reconnect to authorize Vizably again.'
          : err.message || 'Failed to load repositories',
      )
      setStorages([])
      setSelectedId('')
      return []
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
    if (!isGitHub || mode !== 'new' || createdStorageRef) {
      setNameAvailability(null)
      setCheckingName(false)
      return undefined
    }

    const trimmed = newRepoName.trim()
    if (!trimmed) {
      setNameAvailability(null)
      setCheckingName(false)
      return undefined
    }

    // Instant feedback when the loaded repo list already contains this name.
    const localMatch = findRepoByName(storages, trimmed)
    if (localMatch) {
      setCheckingName(false)
      setNameAvailability({
        name: trimmed,
        normalizedName: localMatch.name,
        full_name: localMatch.full_name,
        status: 'taken',
        message: `A repository named "${localMatch.name}" already exists on your account.`,
      })
      return undefined
    }

    let cancelled = false
    setCheckingName(true)
    const timer = setTimeout(async () => {
      try {
        const result = await client.checkRepoNameAvailability(trimmed)
        if (!cancelled) {
          setNameAvailability(result)
        }
      } catch (err) {
        if (!cancelled) {
          setNameAvailability({
            name: trimmed,
            normalizedName: null,
            full_name: null,
            status: 'error',
            message: err.message || 'Could not check repository name availability.',
          })
        }
      } finally {
        if (!cancelled) {
          setCheckingName(false)
        }
      }
    }, NAME_CHECK_DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [isGitHub, mode, newRepoName, client, createdStorageRef, storages])

  const runValidation = useCallback(async (storageRef) => {
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
  }, [client])

  useEffect(() => {
    if (!isGitHub || !activeStorageRef) {
      setValidation(null)
      return
    }
    if (needsInstall && mode === 'new') {
      setValidation(null)
      return
    }
    runValidation(activeStorageRef)
  }, [isGitHub, activeStorageRef, runValidation, needsInstall, mode])

  const statusUi = validation ? STATUS_UI[validation.status] : null
  const proposedAction = statusUi?.action ?? null
  const canWrite = validation?.capabilities?.canWrite !== false
  const initBlocked = proposedAction === 'init' && validation && !canWrite
  const awaitingCreate =
    mode === 'new' && !activeStorageRef && Boolean(newRepoName.trim())
  const nameUnavailable =
    awaitingCreate &&
    (checkingName ||
      !nameAvailability ||
      nameAvailability.status === 'taken' ||
      nameAvailability.status === 'invalid')
  const confirmBlocked =
    !validation ||
    !proposedAction ||
    validation.status === 'incompatible' ||
    validation.status === 'invalid' ||
    initBlocked ||
    (mode === 'new' && needsInstall) ||
    (mode === 'new' && !activeStorageRef)

  const confirmLabel = useMemo(() => {
    if (needsReconnect) return 'Reconnect GitHub'
    if (awaitingCreate) return 'Create repository'
    if (statusUi?.button) return statusUi.button
    return 'Continue'
  }, [needsReconnect, awaitingCreate, statusUi])

  const primaryDisabled =
    creating ||
    confirming ||
    validating ||
    (needsReconnect ? false : (mode === 'new' && needsInstall) ||
      (awaitingCreate ? nameUnavailable : confirmBlocked))

  const handleCreateRepo = async () => {
    const name = normalizeGitHubRepoName(newRepoName)
    if (!name || creating || nameUnavailable) return

    // Reflect normalized name in the input so users see what will be created.
    if (name !== newRepoName) {
      setNewRepoName(name)
    }

    setCreating(true)
    setError(null)
    setNeedsInstall(false)
    setInstallUrl(null)
    try {
      const result = await client.createStorage(name)
      const ref = result.storageRef
      const asListItem = {
        id: ref.id,
        name: ref.name || ref.full_name?.split('/')[1],
        full_name: ref.full_name,
        private: ref.private ?? true,
        html_url: ref.html_url,
      }
      setCreatedStorageRef(asListItem)
      setStorages((prev) => {
        if (prev.some((r) => r.id === asListItem.id)) return prev
        return [asListItem, ...prev]
      })
      setSelectedId(asListItem.id)

      if (result.needsInstall) {
        setNeedsInstall(true)
        setInstallUrl(result.installUrl)
        setValidation(null)
      } else {
        setNeedsInstall(false)
        setInstallUrl(null)
        await runValidation({
          id: asListItem.id,
          full_name: asListItem.full_name,
          html_url: asListItem.html_url,
        })
      }
    } catch (err) {
      // Probe failures (rate limit / network) may still return storageRef — keep
      // the created repo selected without the "install App" CTA.
      if (err.storageRef) {
        const ref = err.storageRef
        const asListItem = {
          id: ref.id,
          name: ref.name || ref.full_name?.split('/')[1],
          full_name: ref.full_name,
          private: ref.private ?? true,
          html_url: ref.html_url,
        }
        setCreatedStorageRef(asListItem)
        setStorages((prev) => {
          if (prev.some((r) => r.id === asListItem.id)) return prev
          return [asListItem, ...prev]
        })
        setSelectedId(asListItem.id)
        setNeedsInstall(false)
        setInstallUrl(null)
      }
      setError(err.message || 'Failed to create repository')
    } finally {
      setCreating(false)
    }
  }

  const handleRefreshAfterInstall = async () => {
    setError(null)
    const list = await loadStorages()
    const match =
      (createdStorageRef && list.find((r) => r.id === createdStorageRef.id)) ||
      findRepoByName(list, newRepoName) ||
      createdStorageRef
    if (!match) {
      setError(
        'Repository not found yet. Add it to the Vizably GitHub App installation, then refresh again.',
      )
      return
    }
    const ref = storageRefFromRepo(match)
    setCreatedStorageRef({
      id: match.id,
      name: match.name,
      full_name: match.full_name,
      private: match.private,
      html_url: match.html_url,
    })
    setNeedsInstall(false)
    await runValidation(ref)
  }

  const handleReconnect = async () => {
    if (onReconnect) {
      await onReconnect()
      return
    }
    try {
      await client.logout()
    } catch {
      // Continue to GitHub even if logout fails (stale cookie).
    }
    client.githubLogin()
  }

  const handleConfirm = async () => {
    if (needsReconnect) {
      await handleReconnect()
      return
    }
    if (mode === 'new' && !activeStorageRef && newRepoName.trim()) {
      await handleCreateRepo()
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

  const nameCheckUi = (() => {
    if (checkingName) {
      return {
        tone: 'checking',
        label: 'Checking',
        icon: 'Loader2',
        color: 'var(--text-muted)',
        bg: 'var(--bg-inset)',
        border: 'var(--border-default)',
        inputBorder: 'var(--border-strong)',
        message: 'Checking availability…',
      }
    }
    switch (nameAvailability?.status) {
      case 'available':
        return {
          tone: 'available',
          label: 'Available',
          icon: 'CircleCheck',
          color: 'var(--green-700)',
          bg: 'var(--green-50)',
          border: 'var(--green-100)',
          inputBorder: 'var(--green-600)',
          message: nameAvailability.message,
        }
      case 'taken':
        return {
          tone: 'taken',
          label: 'Taken',
          icon: 'CircleX',
          color: 'var(--sev-serious-fg)',
          bg: 'var(--sev-serious-bg)',
          border: 'var(--sev-serious)',
          inputBorder: 'var(--sev-serious)',
          message: nameAvailability.message,
        }
      case 'invalid':
        return {
          tone: 'invalid',
          label: 'Invalid',
          icon: 'TriangleAlert',
          color: 'var(--sev-serious-fg)',
          bg: 'var(--sev-serious-bg)',
          border: 'var(--sev-serious)',
          inputBorder: 'var(--sev-serious)',
          message: nameAvailability.message,
        }
      case 'error':
        return {
          tone: 'error',
          label: 'Retry later',
          icon: 'TriangleAlert',
          color: 'var(--text-body)',
          bg: 'var(--sev-moderate-bg)',
          border: 'var(--sev-moderate)',
          inputBorder: 'var(--sev-moderate)',
          message: nameAvailability.message,
        }
      default:
        return null
    }
  })()

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
              {needsReconnect ? `${pv.name} access revoked` : `${pv.name} connected`}
            </span>
            <span style={{ color: needsReconnect ? 'var(--sev-serious-fg)' : 'var(--green-600)' }}>
              {Ico(needsReconnect ? 'TriangleAlert' : 'Check', 15, 'currentColor')}
            </span>
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
            <ConnectOption
              active={mode === 'new'}
              onSelect={() => setMode('new')}
              icon="Plus"
              title={`Create a new ${pv.unit}`}
              desc={`Create a fresh private ${pv.unitShort} under your GitHub account and set it up for Vizably.`}
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
                  border: `1.5px solid ${nameCheckUi?.inputBorder || 'var(--border-strong)'}`,
                  borderRadius: 'var(--radius-md)',
                  transition:
                    'border-color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard)',
                  boxShadow:
                    nameCheckUi?.tone === 'available'
                      ? '0 0 0 3px color-mix(in srgb, var(--green-600) 14%, transparent)'
                      : nameCheckUi?.tone === 'taken' || nameCheckUi?.tone === 'invalid'
                        ? '0 0 0 3px color-mix(in srgb, var(--sev-serious) 16%, transparent)'
                        : 'none',
                }}
              >
                <span style={{ color: 'var(--text-faint)' }}>{Ico(pv.destIcon, 16)}</span>
                <input
                  value={newRepoName}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    const next = e.target.value
                    setNewRepoName(next)
                    setNameAvailability(null)
                    // Only clear create/install state when the typed name no longer
                    // matches the repo we just created — avoids extra re-render churn.
                    if (
                      createdStorageRef &&
                      next.trim() !== createdStorageRef.name &&
                      next.trim() !== createdStorageRef.full_name
                    ) {
                      setCreatedStorageRef(null)
                      setNeedsInstall(false)
                      setInstallUrl(null)
                    }
                  }}
                  disabled={creating}
                  aria-describedby="repo-name-availability"
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
                {nameCheckUi && (
                  <span
                    className={nameCheckUi.tone === 'checking' ? 'ev-spin' : undefined}
                    style={{
                      display: 'inline-flex',
                      color: nameCheckUi.color,
                      transition: 'color var(--duration-fast) var(--ease-standard)',
                    }}
                    aria-hidden="true"
                  >
                    {Ico(nameCheckUi.icon, 16, 'currentColor')}
                  </span>
                )}
              </div>
              {nameCheckUi && mode === 'new' && (
                <div
                  id="repo-name-availability"
                  role="status"
                  aria-live="polite"
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    marginTop: 8,
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-md)',
                    background: nameCheckUi.bg,
                    border: `1px solid ${nameCheckUi.border}`,
                    animation: 'ev-fade-in 160ms var(--ease-standard)',
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      marginTop: 1,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '2px 7px',
                      borderRadius: 'var(--radius-pill)',
                      background: 'var(--surface-card)',
                      border: `1px solid ${nameCheckUi.border}`,
                      color: nameCheckUi.color,
                      font: 'var(--font-label)',
                      fontSize: 11,
                      letterSpacing: '0.02em',
                      textTransform: 'uppercase',
                    }}
                  >
                    <span
                      className={nameCheckUi.tone === 'checking' ? 'ev-spin' : undefined}
                      style={{ display: 'inline-flex' }}
                    >
                      {Ico(nameCheckUi.icon, 12, 'currentColor')}
                    </span>
                    {nameCheckUi.label}
                  </span>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 'var(--text-xs)',
                      color: nameCheckUi.color,
                      lineHeight: 1.45,
                    }}
                  >
                    {nameCheckUi.message}
                  </p>
                </div>
              )}
              <p
                style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--text-muted)',
                  margin: '8px 0 0',
                  lineHeight: 1.45,
                }}
              >
                Creating a repository requires Vizably&apos;s GitHub App{' '}
                <strong style={{ fontWeight: 600, color: 'var(--text-body)' }}>
                  Administration
                </strong>{' '}
                permission (create empty private repos). Contents stay limited to repos you
                install Vizably on.
              </p>
              {needsInstall && (
                <div
                  style={{
                    marginTop: 10,
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--sev-moderate-bg)',
                    border: '1px solid var(--sev-moderate)',
                    fontSize: 'var(--text-sm)',
                    color: 'var(--text-body)',
                    lineHeight: 1.45,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <p style={{ margin: 0 }}>
                    Repository created
                    {createdStorageRef?.full_name ? (
                      <>
                        {' '}
                        (<code style={{ font: 'var(--font-code)' }}>{createdStorageRef.full_name}</code>)
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
            </ConnectOption>

            <ConnectOption
              active={mode === 'existing'}
              onSelect={() => setMode('existing')}
              icon="FolderOpen"
              title={`Use an existing ${pv.unit}`}
              desc={`Pick ${pv.article} ${pv.unit} from your GitHub account.`}
            >
              {loadingRepos ? (
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
            </ConnectOption>
          </div>
        </Card>

        {validating && (
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 14 }}>
            Checking storage…
          </p>
        )}

        {validation && statusUi && !validating && (
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
            disabled={primaryDisabled}
            onClick={handleConfirm}
            iconRight={Ico(needsReconnect ? 'Github' : 'ArrowRight', 17, '#fff')}
          >
            {creating ? 'Creating…' : confirming ? 'Connecting…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
