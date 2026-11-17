import { Button, Card, CodeBlock, SeverityBadge } from '../design-system'
import { Ico } from '../lib/icons'

/** Problem detail / fix view. */
export default function ProblemView({ problem, onBack }) {
  const p = problem
  return (
    <div style={{ width: '100%', maxWidth: 760, margin: '0 auto', padding: '28px 24px 64px' }}>
      <button onClick={onBack} style={{
        display: 'inline-flex', alignItems: 'center', gap: 7, background: 'none', border: 'none',
        color: 'var(--text-link)', font: 'var(--font-label)', cursor: 'pointer', padding: '4px 0', marginBottom: 18,
      }}>{Ico('ArrowLeft', 16, 'currentColor')} Back to results</button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
        <SeverityBadge level={p.level} />
        {p.wcag && (
          <span style={{ font: 'var(--font-code)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', background: 'var(--bg-inset)', padding: '3px 9px', borderRadius: 'var(--radius-sm)' }}>WCAG {p.wcag}</span>
        )}
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>{p.count} occurrence{p.count > 1 ? 's' : ''}</span>
      </div>
      <h1 style={{ fontSize: 'var(--text-2xl)', letterSpacing: '-0.02em', margin: '0 0 28px', lineHeight: 1.15 }}>{p.name}</h1>

      <section style={{ marginBottom: 26 }}>
        <h2 style={{ fontSize: 'var(--text-base)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', margin: '0 0 10px' }}>Root cause</h2>
        <p style={{ font: 'var(--font-body)', fontSize: 'var(--text-md)', color: 'var(--text-body)', lineHeight: 1.65, margin: '0 0 16px' }}>{p.rootCause}</p>
        {p.code && <CodeBlock caption="Offending code" language={p.lang} code={p.code} />}
      </section>

      <section>
        <h2 style={{ fontSize: 'var(--text-base)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', margin: '0 0 12px' }}>How to fix</h2>
        <Card style={{ background: 'var(--accent-subtle)', borderColor: 'var(--blue-100)' }}>
          <ol style={{ margin: 0, padding: 0, listStyle: 'none', counterReset: 'fix', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {p.solution.map((s, i) => (
              <li key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{ flexShrink: 0, width: 24, height: 24, borderRadius: '50%', background: 'var(--accent)', color: '#fff', font: 'var(--font-label)', fontSize: 'var(--text-xs)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
                <span style={{ font: 'var(--font-body)', color: 'var(--ink-800)', lineHeight: 1.55, paddingTop: 1, whiteSpace: 'pre-line' }}>{s}</span>
              </li>
            ))}
          </ol>
        </Card>
        <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
          <Button variant="primary" iconLeft={Ico('Check', 17, '#fff')}>Mark as fixed</Button>
          {p.helpUrl && (
            <Button variant="secondary" iconLeft={Ico('ExternalLink', 16)}
              onClick={() => window.open(p.helpUrl, '_blank', 'noopener')}>
              {p.wcag ? `WCAG ${p.wcag} reference` : 'Rule reference'}
            </Button>
          )}
        </div>
      </section>
    </div>
  )
}
