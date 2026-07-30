import { useState } from 'react'
import { Button, Input } from '../design-system'
import ScanProgressIndicator from '../components/ScanProgressIndicator'
import { Ico } from '../lib/icons'
import { normalizeUrl } from '../utils/urlValidator'

/**
 * Landing view — URL scan entry. Handles idle / scanning states.
 * `onScan(url)` is async: it runs the real backend scan and resolves
 * when results are ready (the App navigates away on success).
 */
export default function LandingView({ onScan }) {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState('idle')
  const [err, setErr] = useState('')

  const examples = ['codrlabs.com', 'stripe.com', 'wikipedia.org']

  const go = async () => {
    if (!url.trim() || status === 'scanning') return
    const normalized = normalizeUrl(url)
    if (!normalized) {
      setErr('That doesn’t look like a URL — try https://example.com')
      return
    }
    setErr('')
    setStatus('scanning')
    try {
      await onScan(normalized)
    } catch (e) {
      setStatus('idle')
      setErr(e.message || 'Scan failed — please try again.')
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', textAlign: 'center' }}>
      <div style={{ maxWidth: 680, width: '100%' }}>
        <div style={{ font: 'var(--font-label)', color: 'var(--accent)', letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: 'var(--text-xs)', marginBottom: 16 }}>
          WCAG accessibility scanner
        </div>
        <h1 style={{ fontSize: 'var(--text-3xl)', fontWeight: 'var(--weight-bold)', letterSpacing: '-0.025em', color: 'var(--text-strong)', lineHeight: 1.05, margin: '0 0 16px' }}>
          Accessibility,<br />made visible.
        </h1>
        <p style={{ fontSize: 'var(--text-md)', color: 'var(--text-body)', lineHeight: 1.6, maxWidth: 520, margin: '0 auto 36px', textWrap: 'balance' }}>
          Paste any URL for an instant, structured report of accessibility violations — mapped to WCAG, with clear guidance on how to fix each one.
        </p>

        {status === 'scanning' ? (
          <ScanProgressIndicator url={url} />
        ) : (
          <>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', justifyContent: 'center', maxWidth: 540, margin: '0 auto', flexWrap: 'wrap' }}>
              <Input size="lg" placeholder="Enter a website URL" aria-label="Website URL"
                iconLeft={Ico('Globe', 18)} value={url}
                onChange={(e) => { setUrl(e.target.value); setErr('') }}
                onKeyDown={(e) => e.key === 'Enter' && go()}
                error={err || undefined}
                containerStyle={{ flex: 1, minWidth: 280, textAlign: 'left' }} />
              <Button size="lg" pill onClick={go} iconRight={Ico('ArrowRight', 18, '#fff')}>Scan</Button>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: 22, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>Try</span>
              {examples.map((e) => (
                <button key={e} onClick={() => setUrl(e)} style={{
                  font: 'var(--font-code)', fontSize: 'var(--text-xs)', color: 'var(--text-body)',
                  background: 'var(--surface-card)', border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-pill)', padding: '5px 12px', cursor: 'pointer',
                }}>{e}</button>
              ))}
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 26, justifyContent: 'center', marginTop: 48, flexWrap: 'wrap' }}>
          {[['ShieldCheck', 'WCAG 2.2 mapped'], ['Zap', 'Results in seconds'], ['Gift', 'Free, no signup']].map(([ic, t]) => (
            <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)' }}>
              <span style={{ color: 'var(--green-600)' }}>{Ico(ic, 16, 'currentColor')}</span>{t}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
