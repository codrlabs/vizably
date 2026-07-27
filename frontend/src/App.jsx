import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BrowserRouter, Navigate, Route, Routes,
  useLocation, useNavigate, useParams, useSearchParams,
} from 'react-router-dom'
import AppShell from './views/AppShell'
import LandingView from './views/LandingView'
import ResultsView from './views/ResultsView'
import ProblemView from './views/ProblemView'
import StoryView from './views/StoryView'
import DonateView from './views/DonateView'
import SignInView from './views/SignInView'
import ConnectView from './views/ConnectView'
import DashboardView from './views/DashboardView'
import AccountView from './views/AccountView'
import LegalView from './views/LegalView'
import NotFoundView from './views/NotFoundView'
import { apiClient } from './lib/apiClient'
import { useScan } from './hooks/useScan'
import { toScanViewModel } from './lib/scanAdapter'
import {
  hasAttachedStorage,
  mergeAccountUpdate,
  toSavedScans,
  toShellUser,
} from './lib/accountAdapter'

/** Route keys (as the UI kit named them) ↔ URL paths. */
const PATHS = {
  landing: '/',
  results: '/results',
  problem: '/problem',
  story: '/story',
  donate: '/donate',
  signin: '/signin',
  connect: '/connect',
  dashboard: '/dashboard',
  account: '/account',
  privacy: '/privacy',
  terms: '/terms',
}

function routeKeyFor(pathname) {
  if (pathname.startsWith('/problem')) return 'problem'
  const entry = Object.entries(PATHS).find(([, path]) => path === pathname)
  return entry ? entry[0] : null
}

/** Centered spinner used while a deep-linked scan is re-running. */
function ScanningIndicator({ url }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: '64px 24px' }}>
      <div className="ev-spin" style={{ width: 34, height: 34, borderRadius: '50%', border: '3px solid var(--blue-100)', borderTopColor: 'var(--accent)' }} />
      <div style={{ font: 'var(--font-label)', color: 'var(--text-body)' }}>Scanning {url}…</div>
    </div>
  )
}

function AuthLoadingIndicator() {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '64px 24px' }}>
      <div className="ev-spin" style={{ width: 34, height: 34, borderRadius: '50%', border: '3px solid var(--blue-100)', borderTopColor: 'var(--accent)' }} />
    </div>
  )
}

/**
 * /results — renders the in-memory scan; on a deep link / refresh it
 * reloads a saved report (?scanId=) or re-fetches by ?url=.
 */
function ResultsRoute({ scan, onOpenProblem }) {
  const [params] = useSearchParams()
  const scanId = params.get('scanId')
  const url = params.get('url')

  if (scan) return <ResultsView data={scan} onOpenProblem={onOpenProblem} />
  if (scanId) {
    return <SavedScanFetcher key={scanId} scanId={scanId} onOpenProblem={onOpenProblem} />
  }
  if (!url) return <Navigate to={PATHS.landing} replace />
  return <ResultsFetcher url={url} onOpenProblem={onOpenProblem} />
}

function SavedScanFetcher({ scanId, onOpenProblem }) {
  const navigate = useNavigate()
  const [viewModel, setViewModel] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    apiClient.getSavedScan(scanId)
      .then((payload) => {
        if (cancelled) return
        setViewModel(toScanViewModel(payload.result, payload.url))
      })
      .catch((err) => {
        if (cancelled) return
        setError(err?.message || 'Could not load that saved report.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [scanId])

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: '64px 24px' }}>
        <div className="ev-spin" style={{ width: 34, height: 34, borderRadius: '50%', border: '3px solid var(--blue-100)', borderTopColor: 'var(--accent)' }} />
        <div style={{ font: 'var(--font-label)', color: 'var(--text-body)' }}>Loading saved report…</div>
      </div>
    )
  }

  if (error || !viewModel) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '64px 24px', textAlign: 'center' }}>
        <h1 style={{ fontSize: 'var(--text-xl)', margin: 0 }}>We couldn’t open that report</h1>
        <p style={{ font: 'var(--font-body)', color: 'var(--text-muted)', maxWidth: 420, lineHeight: 1.6, margin: 0 }}>{error || 'The saved scan was not found in your storage.'}</p>
        <button onClick={() => navigate(PATHS.dashboard)} style={{
          marginTop: 8, padding: '10px 22px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--accent)',
          background: 'var(--accent)', color: '#fff', font: 'var(--font-label)', cursor: 'pointer',
        }}>Back to dashboard</button>
      </div>
    )
  }

  return <ResultsView data={viewModel} onOpenProblem={onOpenProblem} />
}

function ResultsFetcher({ url, onOpenProblem }) {
  const navigate = useNavigate()
  const { data, loading, error } = useScan(url)
  const viewModel = useMemo(() => (data ? toScanViewModel(data, url) : null), [data, url])

  if (loading) return <ScanningIndicator url={url} />
  if (error || !viewModel) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '64px 24px', textAlign: 'center' }}>
        <h1 style={{ fontSize: 'var(--text-xl)', margin: 0 }}>We couldn’t scan that page</h1>
        <p style={{ font: 'var(--font-body)', color: 'var(--text-muted)', maxWidth: 420, lineHeight: 1.6, margin: 0 }}>{error || 'The scanner returned no results.'}</p>
        <button onClick={() => navigate(PATHS.landing)} style={{
          marginTop: 8, padding: '10px 22px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--accent)',
          background: 'var(--accent)', color: '#fff', font: 'var(--font-label)', cursor: 'pointer',
        }}>Try another URL</button>
      </div>
    )
  }
  return <ResultsView data={viewModel} onOpenProblem={onOpenProblem} />
}

/** /problem/:id — looks the problem up in the current scan. */
function ProblemRoute({ scan, problem, onBack }) {
  const { id } = useParams()
  const resolved = problem
    || scan?.categories.flatMap((c) => c.problems).find((p) => p.id === id)
  if (!resolved) return <Navigate to={PATHS.landing} replace />
  return <ProblemView problem={resolved} onBack={onBack} />
}

function AppRoutes() {
  const navigate = useNavigate()
  const location = useLocation()

  const [scan, setScan] = useState(null)
  const [problem, setProblem] = useState(null)
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)

  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('ev-theme') || 'light' } catch { return 'light' }
  })
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { localStorage.setItem('ev-theme', theme) } catch { /* private mode */ }
  }, [theme])
  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

  useEffect(() => { window.scrollTo(0, 0) }, [location.pathname])

  const refreshUser = useCallback(async () => {
    const profile = await apiClient.getUser()
    setUser(profile)
    return profile
  }, [])

  useEffect(() => {
    let cancelled = false

    async function bootstrapAuth() {
      try {
        const status = await apiClient.getAuthStatus()
        if (status.authenticated) {
          const profile = await apiClient.getUser()
          if (!cancelled) setUser(profile)
        } else if (!cancelled) {
          setUser(null)
        }
      } catch {
        if (!cancelled) setUser(null)
      } finally {
        if (!cancelled) setAuthLoading(false)
      }
    }

    bootstrapAuth()
    return () => { cancelled = true }
  }, [])

  const shellUser = useMemo(() => toShellUser(user), [user])
  const savedScans = useMemo(() => toSavedScans(user?.account), [user])
  const provider = user?.provider || 'github'
  const authed = Boolean(user)
  const storageReady = hasAttachedStorage(user)

  const nav = (routeKey) => {
    if (routeKey !== 'problem') setProblem(null)
    navigate(PATHS[routeKey] || PATHS.landing)
  }

  /** Landing submit — run the real scan, then show results. */
  const handleScan = async (url) => {
    const result = await apiClient.runScan(url)
    if (!result) throw new Error('The scanner returned no results — the site may have blocked it.')
    setScan(toScanViewModel(result, url))
    setProblem(null)

    if (result.account) {
      setUser((prev) => mergeAccountUpdate(prev, result.account))
    } else if (user?.storage) {
      try {
        await refreshUser()
      } catch {
        // Scan succeeded; dashboard will refresh on next visit.
      }
    }

    navigate(`${PATHS.results}?url=${encodeURIComponent(url)}`)
  }

  const openProblem = (p) => {
    setProblem(p)
    navigate({
      pathname: `${PATHS.problem}/${encodeURIComponent(p.id)}`,
      search: location.search,
    })
  }

  const backToResults = () => {
    setProblem(null)
    if (location.search.includes('scanId=') || location.search.includes('url=')) {
      navigate({ pathname: PATHS.results, search: location.search })
      return
    }
    const url = scan?.url
    navigate(url ? `${PATHS.results}?url=${encodeURIComponent(url)}` : PATHS.results)
  }

  /** Re-open a saved historical report from storage (by scan id). */
  const openSaved = async (s) => {
    if (!s?.id) return
    setProblem(null)
    try {
      const payload = await apiClient.getSavedScan(s.id)
      setScan(toScanViewModel(payload.result, payload.url))
    } catch {
      setScan(null)
    }
    navigate(`${PATHS.results}?scanId=${encodeURIComponent(s.id)}`)
  }

  const auth = (p) => {
    if (p === 'google') {
      apiClient.googleLogin()
      return
    }
    apiClient.githubLogin()
  }

  const connectDone = async () => {
    await refreshUser()
    navigate(PATHS.dashboard)
  }

  const signOut = async () => {
    try {
      await apiClient.logout()
    } catch {
      // Clear local state even if the network call fails.
    }
    setUser(null)
    navigate(PATHS.landing)
  }

  const route = routeKeyFor(location.pathname)

  useEffect(() => {
    if (route !== 'dashboard' || !storageReady) return
    refreshUser().catch(() => {})
  }, [route, storageReady, refreshUser])

  function ConnectRoute() {
    const [params] = useSearchParams()
    const connectProvider = params.get('provider') || provider
    const storageError = params.get('error') === 'auth_failed'
      ? `${connectProvider === 'google' ? 'Google' : 'GitHub'} sign-in failed. Try again.`
      : null

    if (authLoading) return <AuthLoadingIndicator />
    if (!authed) return <Navigate to={PATHS.signin} replace />

    return (
      <ConnectView
        provider={connectProvider}
        onDone={connectDone}
        onCancel={() => navigate(PATHS.signin)}
        storageError={storageError}
      />
    )
  }

  function RequireStorage({ children }) {
    if (authLoading) return <AuthLoadingIndicator />
    if (!authed) return <Navigate to={PATHS.signin} replace />
    if (!storageReady) return <Navigate to={PATHS.connect} replace />
    return children
  }

  if (authLoading && (route === 'dashboard' || route === 'account' || route === 'connect')) {
    return (
      <AppShell route={route} onNav={nav} authed={false} user={null} theme={theme} onToggleTheme={toggleTheme}>
        <AuthLoadingIndicator />
      </AppShell>
    )
  }

  return (
    <AppShell route={route} onNav={nav} authed={authed && storageReady} user={shellUser} theme={theme} onToggleTheme={toggleTheme}>
      <Routes>
        <Route path={PATHS.landing} element={<LandingView onScan={handleScan} />} />
        <Route path={PATHS.results} element={<ResultsRoute scan={scan} onOpenProblem={openProblem} />} />
        <Route path={`${PATHS.problem}/:id`} element={<ProblemRoute scan={scan} problem={problem} onBack={backToResults} />} />
        <Route path={PATHS.story} element={<StoryView onNav={nav} />} />
        <Route path={PATHS.donate} element={<DonateView onNav={nav} />} />
        <Route
          path={PATHS.signin}
          element={
            authed && storageReady
              ? <Navigate to={PATHS.dashboard} replace />
              : authed
                ? <Navigate to={PATHS.connect} replace />
                : <SignInView onNav={nav} onAuth={auth} />
          }
        />
        <Route path={PATHS.connect} element={<ConnectRoute />} />
        <Route
          path={PATHS.dashboard}
          element={(
            <RequireStorage>
              <DashboardView
                onNav={nav}
                onOpen={openSaved}
                saved={savedScans}
                provider={provider}
                user={shellUser}
                storage={user?.storage}
              />
            </RequireStorage>
          )}
        />
        <Route
          path={PATHS.account}
          element={(
            <RequireStorage>
              <AccountView
                onSignOut={signOut}
                user={user}
                shellUser={shellUser}
                provider={provider}
              />
            </RequireStorage>
          )}
        />
        <Route path={PATHS.privacy} element={<LegalView doc="privacy" onNav={nav} />} />
        <Route path={PATHS.terms} element={<LegalView doc="terms" onNav={nav} />} />
        <Route path="*" element={<NotFoundView onNav={nav} />} />
      </Routes>
    </AppShell>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
