import { Button, Logo } from '../design-system'
import { Ico } from '../lib/icons'

const REPO = 'https://github.com/codrlabs/vizably'
const BMC = 'https://ko-fi.com/devolabode'

/** Top app bar with logo + nav, global footer. Donate lives in the footer. */
export default function AppShell({ children, route, onNav, authed, user, theme, onToggleTheme }) {
  // Show New scan when signed in (stable header order), and also on results /
  // problem for guests or signed-in users who have not connected storage yet —
  // App passes authed={authed && storageReady}, and those routes have no guard.
  const showNewScan =
    (authed || route === 'results' || route === 'problem') &&
    route !== 'signin' &&
    route !== 'connect'

  const NavLink = ({ to, children }) => (
    <button onClick={() => onNav(to)} style={{
      background: 'none', border: 'none', cursor: 'pointer', padding: '6px 2px',
      font: 'var(--font-label)', color: route === to ? 'var(--text-strong)' : 'var(--text-body)',
      borderBottom: route === to ? '2px solid var(--accent)' : '2px solid transparent',
    }}>{children}</button>
  )

  const initials = (user && user.name ? user.name : 'V').slice(0, 1).toUpperCase()

  const FootCol = ({ title, children }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 11, minWidth: 132 }}>
      <div style={{ font: 'var(--font-label)', fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)' }}>{title}</div>
      {children}
    </div>
  )
  const FootLink = ({ to, href, icon, accent, children }) => (
    <button onClick={() => href ? window.open(href, '_blank') : onNav(to)} style={{
      display: 'inline-flex', alignItems: 'center', gap: 7,
      background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer',
      font: 'var(--font-body)', fontSize: 'var(--text-sm)',
      fontWeight: accent ? 'var(--weight-semibold)' : 'var(--weight-regular)',
      color: accent ? 'var(--accent)' : 'var(--text-body)',
    }}>{icon && Ico(icon, 15, 'currentColor')}{children}</button>
  )

  return (
    <div style={{ minHeight: '100%', background: 'var(--bg-subtle)', display: 'flex', flexDirection: 'column' }}>
      <header style={{
        height: 64, flexShrink: 0, background: 'var(--surface-card)',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 28px', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <button onClick={() => onNav('landing')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} aria-label="Vizably home">
          <Logo size={28} />
        </button>
        <nav aria-label="Primary" style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <button onClick={onToggleTheme} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title={theme === 'dark' ? 'Light mode' : 'Dark mode'} style={{
            width: 34, height: 34, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid var(--border-default)', background: 'var(--surface-card)', color: 'var(--text-body)', cursor: 'pointer',
          }}>{Ico(theme === 'dark' ? 'Sun' : 'Moon', 17, 'currentColor')}</button>
          {showNewScan && (
            <Button size="sm" variant="secondary" onClick={() => onNav('landing')} iconLeft={Ico('Plus', 16)}>New scan</Button>
          )}
          {authed ? (
            <NavLink to="dashboard">My scans</NavLink>
          ) : (
            <NavLink to="signin">Sign in</NavLink>
          )}
          {authed && (
            <button onClick={() => onNav('account')} aria-label="Account settings" style={{
              width: 34, height: 34, borderRadius: '50%',
              border: route === 'account' ? '2px solid var(--accent)' : '1px solid var(--border-default)',
              background: 'var(--accent-subtle)', color: 'var(--accent)', cursor: 'pointer',
              font: 'var(--font-sans)', fontWeight: 'var(--weight-bold)', fontSize: 'var(--text-sm)',
            }}>{initials}</button>
          )}
        </nav>
      </header>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>{children}</main>

      {/* Global footer */}
      <footer style={{ flexShrink: 0, background: 'var(--surface-card)', borderTop: '1px solid var(--border-subtle)', padding: '48px 28px 36px' }}>
        <div style={{ maxWidth: 1040, margin: '0 auto', display: 'flex', flexWrap: 'wrap', gap: 48, justifyContent: 'space-between' }}>
          <div style={{ maxWidth: 300 }}>
            <Logo tone="mono" size={26} />
            <p style={{ font: 'var(--font-body)', fontSize: 'var(--text-sm)', color: 'var(--text-muted)', margin: '14px 0 14px', lineHeight: 1.6 }}>
              A free, open-source accessibility scanner — built so the web works for everyone.
            </p>
            <p style={{ font: 'var(--font-label)', fontSize: 'var(--text-xs)', color: 'var(--text-faint)', margin: 0 }}>
              Built by <a href="https://github.com/DevOlabode" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-body)', fontWeight: 'var(--weight-semibold)', textDecoration: 'none' }}>@devolabode</a>
            </p>
            <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: '3px 0 0', letterSpacing: '0.01em' }}>
              under the guidance of <a href="https://github.com/codrlabs/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-faint)', textDecoration: 'none' }}>Codrlabs Open</a>
            </p>
          </div>
          <div style={{ display: 'flex', gap: 52, flexWrap: 'wrap' }}>
            <FootCol title="Product">
              <FootLink to="landing">Scan a site</FootLink>
              <FootLink to="story">Why Vizably</FootLink>
              <FootLink to={authed ? 'dashboard' : 'signin'}>My scans</FootLink>
            </FootCol>
            <FootCol title="Support">
              <FootLink to="donate" icon="Coffee" accent>Buy me a coffee</FootLink>
              <FootLink href={REPO} icon="Github">GitHub</FootLink>
            </FootCol>
            <FootCol title="Legal">
              <FootLink to="privacy">Privacy</FootLink>
              <FootLink to="terms">Terms</FootLink>
            </FootCol>
          </div>
        </div>
        <div style={{ maxWidth: 1040, margin: '32px auto 0', paddingTop: 22, borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, fontSize: 'var(--text-xs)', color: 'var(--text-faint)' }}>
          <span>© 2026 Vizably · Open source under MPL-2.0</span>
          <span>Accessibility, made visible.</span>
        </div>
      </footer>
    </div>
  )
}

export { BMC }
