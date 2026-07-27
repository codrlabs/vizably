import { Card, Logo } from '../design-system'
import { Ico, GoogleMark } from '../lib/icons'

/**
 * Sign in — connect with GitHub or Google. We use the provider only to
 * identify you; saved scans live in YOUR own storage (a private repo or
 * your Drive), never on vizably's servers.
 *
 * `onAuth(provider)` starts the full-page OAuth redirect (GitHub or Google).
 */
export default function SignInView({ onNav, onAuth }) {
  const Provider = ({ id, icon, label, sub }) => (
    <button onClick={() => onAuth(id)} style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 14,
      padding: '14px 16px', borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border-strong)', background: 'var(--surface-card)', cursor: 'pointer',
      textAlign: 'left',
      transition: 'border-color var(--duration-fast) var(--ease-standard), background var(--duration-fast) var(--ease-standard)',
    }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.background = 'var(--bg-subtle)' }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-strong)'; e.currentTarget.style.background = 'var(--surface-card)' }}>
      <span style={{ flexShrink: 0, display: 'inline-flex' }}>{icon}</span>
      <span style={{ flex: 1 }}>
        <span style={{ display: 'block', font: 'var(--font-label)', color: 'var(--text-strong)' }}>{label}</span>
        <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 1 }}>{sub}</span>
      </span>
      <span style={{ color: 'var(--text-faint)' }}>{Ico('ArrowRight', 17)}</span>
    </button>
  )

  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '56px 24px 72px' }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ display: 'inline-flex', marginBottom: 16 }}><Logo size={30} /></div>
          <h1 style={{ fontSize: 'var(--text-xl)', margin: '0 0 6px' }}>Connect to save your scans</h1>
          <p style={{ font: 'var(--font-body)', color: 'var(--text-muted)', fontSize: 'var(--text-sm)', lineHeight: 1.5 }}>
            Sign in with an account you already have. No new password to remember.
          </p>
        </div>

        <Card padding="var(--space-6)">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Provider id="github" icon={Ico('Github', 22)} label="Continue with GitHub"
              sub="Scans saved to a private repo in your account" />
            <Provider id="google" icon={GoogleMark(22)} label="Continue with Google"
              sub="Scans saved to your Google Drive" />
          </div>
        </Card>

        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 20, padding: '14px 16px', background: 'var(--accent-subtle)', border: '1px solid var(--blue-100)', borderRadius: 'var(--radius-md)' }}>
          <span style={{ color: 'var(--accent)', marginTop: 1 }}>{Ico('ShieldCheck', 16, 'currentColor')}</span>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-800)', lineHeight: 1.5, margin: 0 }}>
            We only read your name and email to identify you. Your saved scans live in <strong style={{ color: 'var(--text-strong)' }}>your own storage</strong> — never on our servers, so there’s nothing for us to lose, sell, or charge you for.
          </p>
        </div>

        <p style={{ textAlign: 'center', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 18, lineHeight: 1.5 }}>
          By continuing you agree to our{' '}
          <button onClick={() => onNav('terms')} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--text-link)', cursor: 'pointer', font: 'inherit', textDecoration: 'underline' }}>Terms</button>{' '}and{' '}
          <button onClick={() => onNav('privacy')} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--text-link)', cursor: 'pointer', font: 'inherit', textDecoration: 'underline' }}>Privacy</button>.
        </p>
      </div>
    </div>
  )
}
