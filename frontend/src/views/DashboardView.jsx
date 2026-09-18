import { useState } from 'react'
import { Button, Card, SeverityBadge } from '../design-system'
import { Ico } from '../lib/icons'
import { PROVIDERS } from '../data/placeholders'

/** Dashboard — signed-in saved scans from the loaded account index. */
export default function DashboardView({ onNav, onOpen, onDeleteMany, saved, provider, user, storage }) {
  const pv = PROVIDERS[provider] || PROVIDERS.github
  const storageLabel = storage?.full_name || pv.dest
  const [selected, setSelected] = useState(() => new Set())
  const [bulkConfirm, setBulkConfirm] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkError, setBulkError] = useState(null)

  const band = (v) => v >= 90 ? { c: 'var(--green-600)', g: 'Good' }
    : v >= 70 ? { c: 'var(--sev-moderate)', g: 'Fair' }
    : v >= 50 ? { c: 'var(--sev-serious)', g: 'Poor' }
    : { c: 'var(--sev-critical)', g: 'Critical' }

  const toggleSelected = (id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    setSelected((prev) => (prev.size === saved.length ? new Set() : new Set(saved.map((s) => s.id))))
  }

  const handleBulkDelete = async () => {
    if (!onDeleteMany || selected.size === 0) return
    setBulkError(null)
    setBulkBusy(true)
    try {
      await onDeleteMany(Array.from(selected))
      setSelected(new Set())
      setBulkConfirm(false)
    } catch (err) {
      setBulkError(err?.message || 'Failed to delete the selected scans')
    } finally {
      setBulkBusy(false)
    }
  }

  const Row = ({ s, last }) => {
    const [hover, setHover] = useState(false)
    const b = band(s.score)
    const checked = selected.has(s.id)

    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(s)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen(s)
          }
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '16px 18px',
          background: hover ? 'var(--bg-subtle)' : 'var(--surface-card)',
          borderBottom: last ? 'none' : '1px solid var(--border-subtle)',
          cursor: 'pointer',
          transition: 'background var(--duration-fast) var(--ease-standard)',
        }}
      >
        {onDeleteMany && (
          <input
            type="checkbox"
            aria-label={`Select scan ${s.url}`}
            checked={checked}
            disabled={bulkBusy}
            onClick={(e) => e.stopPropagation()}
            onChange={() => toggleSelected(s.id)}
            style={{ flexShrink: 0, width: 16, height: 16, cursor: 'pointer' }}
          />
        )}
        <span style={{
          flexShrink: 0, width: 38, height: 38, borderRadius: 'var(--radius-sm)',
          background: 'var(--bg-inset)', color: 'var(--text-muted)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          font: 'var(--font-sans)', fontWeight: 'var(--weight-bold)', fontSize: 'var(--text-md)',
        }}>
          {s.url[0].toUpperCase()}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            font: 'var(--font-body)', fontWeight: 'var(--weight-semibold)',
            color: 'var(--text-strong)', whiteSpace: 'nowrap', overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {s.url}
          </div>
          <div style={{
            fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
            display: 'flex', alignItems: 'center', gap: 6, marginTop: 2,
          }}>
            {Ico('Clock', 12)} Scanned {s.when}
          </div>
        </div>
        <SeverityBadge level={s.top} size="sm" />
        <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', minWidth: 52 }}>
          <span style={{
            font: 'var(--font-sans)', fontWeight: 'var(--weight-bold)',
            fontSize: 'var(--text-lg)', color: b.c, lineHeight: 1,
          }}>
            {s.score}
          </span>
          <span style={{ fontSize: '10px', fontWeight: 'var(--weight-semibold)', color: b.c }}>{b.g}</span>
        </span>
        <span
          aria-hidden="true"
          style={{
            color: 'var(--text-faint)', fontSize: 18,
            transform: hover ? 'translateX(2px)' : 'none',
            transition: 'transform var(--duration-fast) var(--ease-standard)',
          }}
        >
          ›
        </span>
      </div>
    )
  }

  if (saved.length === 0) {
    return (
      <div style={{ width: '100%', maxWidth: 880, margin: '0 auto', padding: '36px 24px 64px' }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{
            font: 'var(--font-label)', color: 'var(--accent)', letterSpacing: '0.08em',
            textTransform: 'uppercase', fontSize: 'var(--text-xs)', marginBottom: 6,
          }}>
            Signed in as {user?.email || 'your account'}
          </div>
          <h1 style={{ fontSize: 'var(--text-xl)', margin: 0 }}>Your scans</h1>
        </div>
        <Card style={{ textAlign: 'center', padding: 'var(--space-9) var(--space-6)' }}>
          <div style={{
            display: 'inline-flex', width: 64, height: 64, borderRadius: '50%',
            background: 'var(--accent-subtle)', color: 'var(--accent)',
            alignItems: 'center', justifyContent: 'center', marginBottom: 18,
          }}>
            {Ico('ScanLine', 30, 'currentColor')}
          </div>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 8px' }}>No scans yet</h2>
          <p style={{
            font: 'var(--font-body)', color: 'var(--text-muted)', maxWidth: 380,
            margin: '0 auto 22px', lineHeight: 1.6,
          }}>
            Run your first accessibility scan and it’ll show up here — ready to revisit any time you sign in.
          </p>
          <Button variant="primary" size="lg" pill onClick={() => onNav('landing')} iconLeft={Ico('ScanLine', 17, '#fff')}>
            Scan your first site
          </Button>
        </Card>
        <div style={{
          display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 18,
          padding: '14px 16px', background: 'var(--bg-inset)', borderRadius: 'var(--radius-md)',
        }}>
          <span style={{ color: 'var(--text-muted)', marginTop: 1 }}>{Ico(pv.destIcon, 16, 'currentColor')}</span>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-body)', lineHeight: 1.5, margin: 0 }}>
            Scans are saved to <strong style={{ color: 'var(--text-strong)' }}>{pv.store}</strong> ({storageLabel}) — your space, not ours. Nothing for us to meter or lock behind a paywall.
          </p>
        </div>
      </div>
    )
  }

  const avg = Math.round(saved.reduce((n, s) => n + s.score, 0) / saved.length)

  return (
    <div style={{ width: '100%', maxWidth: 880, margin: '0 auto', padding: '36px 24px 64px' }}>
      <div style={{
        display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
        gap: 16, flexWrap: 'wrap', marginBottom: 24,
      }}>
        <div>
          <div style={{
            font: 'var(--font-label)', color: 'var(--accent)', letterSpacing: '0.08em',
            textTransform: 'uppercase', fontSize: 'var(--text-xs)', marginBottom: 6,
          }}>
            Signed in as {user?.email || 'your account'}
          </div>
          <h1 style={{ fontSize: 'var(--text-xl)', margin: 0 }}>Your scans</h1>
        </div>
        <Button variant="primary" onClick={() => onNav('landing')} iconLeft={Ico('Plus', 16, '#fff')}>
          New scan
        </Button>
      </div>

      {onDeleteMany && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-sm)', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              aria-label="Select all scans"
              checked={selected.size === saved.length}
              onChange={toggleSelectAll}
              disabled={bulkBusy}
              style={{ width: 16, height: 16, cursor: 'pointer' }}
            />
            Select all
          </label>
          {selected.size > 0 && !bulkConfirm && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => { setBulkError(null); setBulkConfirm(true) }}
              iconLeft={Ico('Trash2', 14, '#fff')}
            >
              Delete {selected.size} selected
            </Button>
          )}
        </div>
      )}

      {bulkConfirm && (
        <div
          role="region"
          aria-label="Confirm delete selected scans"
          style={{
            marginBottom: 14, padding: 'var(--space-4)',
            background: 'var(--sev-critical-bg)', border: '1px solid var(--sev-critical)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <p style={{ font: 'var(--font-label)', fontWeight: 'var(--weight-semibold)', color: 'var(--sev-critical-fg)', margin: '0 0 8px' }}>
            Delete {selected.size} selected scan{selected.size === 1 ? '' : 's'}?
          </p>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.45 }}>
            They will be removed from your storage. GitHub history may still retain them.
          </p>
          {bulkError && (
            <div role="alert" style={{
              marginBottom: 12, padding: '10px 12px', borderRadius: 'var(--radius-md)',
              background: 'var(--surface-card)', border: '1px solid var(--sev-critical)',
              color: 'var(--sev-critical-fg)', fontSize: 'var(--text-sm)', lineHeight: 1.45,
            }}>
              {bulkError}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Button variant="danger" size="sm" disabled={bulkBusy} onClick={handleBulkDelete} iconLeft={Ico('Trash2', 16, '#fff')}>
              {bulkBusy ? 'Deleting…' : 'Yes, delete'}
            </Button>
            <Button variant="secondary" size="sm" disabled={bulkBusy} onClick={() => { setBulkConfirm(false); setBulkError(null) }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, marginBottom: 22 }}>
        {[['Sites saved', saved.length, 'var(--text-strong)'], ['Avg. score', avg, band(avg).c]].map(([label, val, col]) => (
          <Card key={label} padding="var(--space-4)">
            <div style={{
              font: 'var(--font-sans)', fontWeight: 'var(--weight-bold)',
              fontSize: 'var(--text-2xl)', color: col, lineHeight: 1, letterSpacing: '-0.02em',
            }}>
              {val}
            </div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 4 }}>{label}</div>
          </Card>
        ))}
      </div>

      <Card padding="0" style={{ overflow: 'hidden' }}>
        {saved.map((s, i) => <Row key={s.id || s.url} s={s} last={i === saved.length - 1} />)}
      </Card>

      <div style={{
        display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 18,
        padding: '14px 16px', background: 'var(--accent-subtle)',
        border: '1px solid var(--blue-100)', borderRadius: 'var(--radius-md)',
      }}>
        <span style={{ color: 'var(--accent)', marginTop: 1 }}>{Ico(pv.destIcon, 16, 'currentColor')}</span>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-800)', lineHeight: 1.5, margin: 0 }}>
          These reports live in <strong style={{ color: 'var(--text-strong)' }}>{pv.store}</strong> ({storageLabel}), synced from your {pv.name} account — so they’re yours to keep, export, or delete, and they never touch our servers.
        </p>
      </div>
    </div>
  )
}
