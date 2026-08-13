import { useState } from 'react'
import { Badge, Button, Card, ProblemRow, ScoreDial, SeverityBadge } from '../design-system'
import { Ico } from '../lib/icons'

/** Results view — score summary + category sections + what's good. */
export default function ResultsView({ data, onOpenProblem, scanId, onDelete }) {
  const total = data.categories.reduce((n, c) => n + c.problems.length, 0)
  const canDelete = Boolean(scanId && onDelete)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)

  const handleDelete = async () => {
    if (!canDelete || deleting) return
    setDeleteError(null)
    setDeleting(true)
    try {
      await onDelete({ id: scanId })
    } catch (err) {
      setDeleteError(err?.message || 'Failed to delete this scan')
      setDeleting(false)
    }
  }

  return (
    <div style={{ width: '100%', maxWidth: 880, margin: '0 auto', padding: '36px 24px 64px' }}>
      {/* Summary */}
      <div data-noprint style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
        <div style={{ font: 'var(--font-label)', color: 'var(--accent)', letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: 'var(--text-xs)' }}>Scan complete</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {canDelete && !confirming && (
            <Button
              variant="secondary"
              size="sm"
              iconLeft={Ico('Trash2', 15, 'currentColor')}
              onClick={() => {
                setDeleteError(null)
                setConfirming(true)
              }}
              style={{
                color: 'var(--sev-critical)',
                borderColor: 'color-mix(in srgb, var(--sev-critical) 40%, var(--border-strong))',
                background: 'color-mix(in srgb, var(--sev-critical) 8%, var(--surface-card))',
              }}
            >
              Delete scan
            </Button>
          )}
          <button onClick={() => window.print()} style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 14px',
            borderRadius: 'var(--radius-md)', border: '1px solid var(--border-strong)', background: 'var(--surface-card)',
            font: 'var(--font-label)', color: 'var(--text-strong)', cursor: 'pointer',
          }}>{Ico('Download', 16)} Download PDF</button>
        </div>
      </div>

      {canDelete && confirming && (
        <div
          data-noprint
          role="region"
          aria-label="Confirm delete scan"
          style={{
            marginBottom: 16,
            padding: '14px 16px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid color-mix(in srgb, var(--sev-critical) 35%, var(--border-subtle))',
            background: 'color-mix(in srgb, var(--sev-critical) 7%, var(--surface-card))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 14,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', minWidth: 0, flex: 1 }}>
            <span style={{
              flexShrink: 0, width: 34, height: 34, borderRadius: 'var(--radius-sm)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'color-mix(in srgb, var(--sev-critical) 14%, transparent)',
              color: 'var(--sev-critical)',
            }}>
              {Ico('Trash2', 16, 'currentColor')}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ font: 'var(--font-label)', color: 'var(--text-strong)', marginBottom: 3 }}>
                Delete this saved scan?
              </div>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', margin: 0, lineHeight: 1.45 }}>
                Removes it from your storage. Other scans stay. GitHub history may still retain it.
              </p>
              {deleteError && (
                <p role="alert" style={{ fontSize: 'var(--text-sm)', color: 'var(--sev-critical)', margin: '8px 0 0', lineHeight: 1.45 }}>
                  {deleteError}
                </p>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="ghost" size="sm" disabled={deleting} onClick={() => setConfirming(false)}>
              Keep scan
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={deleting}
              iconLeft={Ico('Trash2', 14, '#fff')}
              onClick={handleDelete}
            >
              {deleting ? 'Deleting…' : 'Yes, delete'}
            </Button>
          </div>
        </div>
      )}

      <Card style={{ display: 'flex', alignItems: 'center', gap: 28, marginBottom: 32, flexWrap: 'wrap' }}>
        <ScoreDial value={data.score} size={120} />
        <div style={{ flex: 1, minWidth: 260 }}>
          <h1 style={{ fontSize: 'var(--text-xl)', margin: '0 0 4px' }}>Accessibility report</h1>
          <div style={{ font: 'var(--font-code)', fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: 14 }}>{data.url}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {data.counts.critical > 0 && <SeverityBadge level="critical" size="sm" />}
            {data.counts.serious > 0 && <SeverityBadge level="serious" size="sm" />}
            {data.counts.moderate > 0 && <SeverityBadge level="moderate" size="sm" />}
            {data.counts.minor > 0 && <SeverityBadge level="minor" size="sm" />}
            <Badge tone="neutral">{total} issues total</Badge>
          </div>
        </div>
      </Card>

      {/* Category sections */}
      {data.categories.map((cat) => (
        <section key={cat.id} style={{ marginBottom: 26 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={{ color: 'var(--text-muted)' }}>{Ico(cat.icon, 18)}</span>
            <h2 style={{ fontSize: 'var(--text-lg)', margin: 0 }}>{cat.title}</h2>
            <span style={{ font: 'var(--font-label)', color: 'var(--text-muted)' }}>{cat.problems.length}</span>
          </div>
          <Card padding="0" style={{ overflow: 'hidden' }}>
            {cat.problems.map((p, i) => (
              <ProblemRow key={p.id} name={p.name} level={p.level} wcag={p.wcag} count={p.count}
                onClick={() => onOpenProblem(p)}
                style={i === cat.problems.length - 1 ? { borderBottom: 'none' } : {}} />
            ))}
          </Card>
        </section>
      ))}

      {/* What's good */}
      {data.whatsGood.length > 0 && (
        <section style={{ marginTop: 34 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={{ color: 'var(--green-600)' }}>{Ico('CircleCheck', 18, 'currentColor')}</span>
            <h2 style={{ fontSize: 'var(--text-lg)', margin: 0 }}>What’s good</h2>
          </div>
          <Card style={{ background: 'var(--green-50)', borderColor: 'var(--green-100)' }}>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {data.whatsGood.map((g, i) => (
                <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', font: 'var(--font-body)', color: 'var(--green-700)' }}>
                  <span style={{ marginTop: 1, flexShrink: 0 }}>{Ico('Check', 17, 'var(--green-600)')}</span>
                  <span style={{ color: 'var(--ink-800)' }}>{g}</span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  )
}
