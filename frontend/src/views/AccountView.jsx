import { useState } from 'react'
import { Button, Card, Input } from '../design-system'
import { Ico, GoogleMark } from '../lib/icons'
import { PROVIDERS } from '../data/placeholders'
import { apiClient } from '../lib/apiClient'

/**
 * Account settings — profile + data/storage controls + delete account.
 * Deliberately framed around using LESS storage, not more.
 *
 * @param {object} props
 * @param {() => void | Promise<void>} props.onSignOut
 * @param {(result: { scanCount: number, scans: object[] }) => void | Promise<void>} [props.onDeleteAllScans]
 * @param {object} props.user
 * @param {object} [props.shellUser]
 * @param {'github' | 'google'} props.provider
 * @param {import('../lib/apiClient').ApiClient} [props.client]
 */
export default function AccountView({
  onSignOut,
  onDeleteAllScans,
  user,
  shellUser,
  provider,
  client = apiClient,
}) {
  const pv = PROVIDERS[provider] || PROVIDERS.github
  const [autoDelete, setAutoDelete] = useState(user?.account?.settings?.autoDelete90d ?? true)
  const [confirmDelete, setConfirmDelete] = useState(false)
  /** @type {'idle' | 'confirm' | 'busy'} */
  const [deleteAllStep, setDeleteAllStep] = useState('idle')
  const [deleteAllError, setDeleteAllError] = useState(null)

  const savedCount = user?.account?.scanCount ?? user?.account?.scans?.length ?? 0
  const storageLabel = user?.storage?.full_name || pv.dest
  const displayUser = shellUser || {
    name: user?.displayName || user?.username || 'User',
    email: user?.email || '',
  }
  const deletingAll = deleteAllStep === 'busy'

  const Section = ({ title, desc, children }) => (
    <section style={{ marginBottom: 22 }}>
      <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 2px' }}>{title}</h2>
      {desc && <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', margin: '0 0 12px' }}>{desc}</p>}
      {children}
    </section>
  )

  const RowItem = ({ icon, title, sub, children }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 0' }}>
      <span style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 'var(--radius-sm)', background: 'var(--bg-inset)', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{Ico(icon, 17)}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: 'var(--font-body)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-strong)' }}>{title}</div>
        {sub && <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.45 }}>{sub}</div>}
      </div>
      {children}
    </div>
  )

  const Switch = ({ on, onToggle }) => (
    <button role="switch" aria-checked={on} onClick={onToggle} style={{
      width: 44, height: 26, borderRadius: 'var(--radius-pill)', border: 'none', cursor: 'pointer',
      background: on ? 'var(--accent)' : 'var(--ink-300)', position: 'relative', flexShrink: 0,
      transition: 'background var(--duration-fast) var(--ease-standard)',
    }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', boxShadow: 'var(--shadow-sm)', transition: 'left var(--duration-fast) var(--ease-standard)' }} />
    </button>
  )

  const handleDeleteAll = async () => {
    setDeleteAllError(null)
    setDeleteAllStep('busy')
    try {
      const result = onDeleteAllScans
        ? await onDeleteAllScans()
        : await client.deleteAllScans()
      setDeleteAllStep('idle')
      return result
    } catch (err) {
      setDeleteAllError(err?.message || 'Failed to delete saved scans')
      setDeleteAllStep('confirm')
    }
  }

  return (
    <div style={{ width: '100%', maxWidth: 680, margin: '0 auto', padding: '36px 24px 64px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 28 }}>
        <div>
          <div style={{ font: 'var(--font-label)', color: 'var(--accent)', letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: 'var(--text-xs)', marginBottom: 6 }}>Account</div>
          <h1 style={{ fontSize: 'var(--text-xl)', margin: 0 }}>Settings</h1>
        </div>
        <Button variant="ghost" onClick={onSignOut} iconLeft={Ico('LogOut', 16)}>Sign out</Button>
      </div>

      {/* Profile */}
      <Card style={{ marginBottom: 22 }}>
        <Section title="Profile" desc={`Pulled from your ${pv.name} account.`}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', marginBottom: 16, background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
            <span style={{ flexShrink: 0, display: 'inline-flex' }}>{provider === 'google' ? GoogleMark(20) : Ico('Github', 20)}</span>
            <div style={{ flex: 1 }}>
              <div style={{ font: 'var(--font-label)', color: 'var(--text-strong)' }}>Connected with {pv.name}</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{displayUser.email}</div>
            </div>
            <Button variant="ghost" size="sm" onClick={onSignOut}>Disconnect</Button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Input label="Name" defaultValue={displayUser.name} iconLeft={Ico('User', 17)} readOnly />
            <Input label="Email" type="email" defaultValue={displayUser.email} iconLeft={Ico('Mail', 17)} readOnly />
          </div>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', margin: '12px 0 0', lineHeight: 1.45 }}>
            Profile fields come from {pv.name} and update when you reconnect.
          </p>
        </Section>
      </Card>

      {/* Data & storage */}
      <Card style={{ marginBottom: 22 }}>
        <Section title="Data & storage" desc={`Your scans are saved in ${pv.store} — your space, not ours. Manage what’s kept here.`}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <RowItem
              icon={pv.destIcon}
              title={`Saved scans · ${savedCount}`}
              sub={savedCount ? `Stored in ${pv.storeShort} (${storageLabel}).` : 'No saved scans — nothing is taking up space.'}
            >
              {savedCount === 0 ? (
                <Button variant="secondary" size="sm" disabled>
                  Cleared
                </Button>
              ) : deleteAllStep === 'idle' ? (
                <Button variant="secondary" size="sm" onClick={() => { setDeleteAllError(null); setDeleteAllStep('confirm') }}>
                  Delete all
                </Button>
              ) : null}
            </RowItem>

            {deleteAllStep !== 'idle' && savedCount > 0 && (
              <div
                role="region"
                aria-label="Confirm delete all scans"
                style={{
                  marginBottom: 8,
                  padding: 'var(--space-4)',
                  background: 'var(--sev-critical-bg)',
                  border: '1px solid var(--sev-critical)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <p style={{ font: 'var(--font-label)', fontWeight: 'var(--weight-semibold)', color: 'var(--sev-critical-fg)', margin: '0 0 8px' }}>
                  Delete all {savedCount} saved scan{savedCount === 1 ? '' : 's'} from {storageLabel}?
                </p>
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.45 }}>
                  Removes every report under scans/. Your Vizably account and repository stay. This can’t be undone.
                </p>
                {deleteAllError && (
                  <div role="alert" style={{
                    marginBottom: 12, padding: '10px 12px', borderRadius: 'var(--radius-md)',
                    background: 'var(--surface-card)', border: '1px solid var(--sev-critical)',
                    color: 'var(--sev-critical-fg)', fontSize: 'var(--text-sm)', lineHeight: 1.45,
                  }}>
                    {deleteAllError}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={deletingAll}
                    onClick={handleDeleteAll}
                    iconLeft={Ico('Trash2', 16, '#fff')}
                  >
                    {deletingAll ? 'Deleting…' : 'Yes, delete all'}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={deletingAll}
                    onClick={() => { setDeleteAllStep('idle'); setDeleteAllError(null) }}
                  >
                    Keep scans
                  </Button>
                </div>
              </div>
            )}

            <div style={{ borderTop: '1px solid var(--border-subtle)' }} />
            <RowItem icon="Timer" title="Auto-delete old scans" sub={`Automatically remove scans older than 90 days from ${pv.storeShort}.`}>
              <Switch on={autoDelete} onToggle={() => setAutoDelete((v) => !v)} />
            </RowItem>
            <div style={{ borderTop: '1px solid var(--border-subtle)' }} />
            <RowItem icon="Download" title="Download my data" sub="Export your account and saved reports as JSON.">
              <Button variant="secondary" size="sm" disabled title="Export lands in a later phase">Export</Button>
            </RowItem>
          </div>
        </Section>
      </Card>

      {/* Danger zone */}
      <Card style={{ borderColor: 'var(--sev-critical-bg)' }}>
        <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 2px', color: 'var(--sev-critical-fg)' }}>Delete account</h2>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', margin: '0 0 16px', lineHeight: 1.5 }}>
          Disconnect Vizably and delete the scans it saved in {pv.storeShort}. Your {pv.name} account itself stays untouched. This can’t be undone.
        </p>
        {!confirmDelete ? (
          <Button variant="danger" onClick={() => setConfirmDelete(true)} iconLeft={Ico('Trash2', 16, '#fff')}>Delete my account</Button>
        ) : (
          <div style={{ background: 'var(--sev-critical-bg)', border: '1px solid var(--sev-critical)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)' }}>
            <p style={{ font: 'var(--font-label)', fontWeight: 'var(--weight-semibold)', color: 'var(--sev-critical-fg)', margin: '0 0 12px' }}>
              Are you sure? This deletes everything, permanently.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <Button variant="danger" onClick={onSignOut} iconLeft={Ico('Trash2', 16, '#fff')}>Yes, sign out</Button>
              <Button variant="secondary" onClick={() => setConfirmDelete(false)}>Keep my account</Button>
            </div>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', margin: '10px 0 0', lineHeight: 1.45 }}>
              Storage deletion from {storageLabel} is not wired yet — this signs you out for now.
            </p>
          </div>
        )}
      </Card>

      <p style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 20, lineHeight: 1.5 }}>
        <span style={{ color: 'var(--green-600)', marginTop: 1 }}>{Ico('Leaf', 15, 'currentColor')}</span>
        Because your scans live in {pv.store} ({storageLabel}), Vizably keeps no database of its own — your data stays yours, and there’s no server cost to pass on.
      </p>
    </div>
  )
}
