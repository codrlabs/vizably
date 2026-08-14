import { useState } from 'react'
import { Button, Card, Input } from '../design-system'
import { Ico, GoogleMark } from '../lib/icons'
import { PROVIDERS } from '../data/placeholders'
import { apiClient } from '../lib/apiClient'

/**
 * Account settings — profile + data/storage controls + delete account.
 * Deliberately framed around using LESS storage, not more.
 *
 * Delete flow collects both confirms before mutating. If the user wants the
 * GitHub repo gone, delete it first (wipe is then unnecessary). If they keep
 * the repo, wipe Vizably files only. A failed repo delete leaves the store intact.
 *
 * @param {object} props
 * @param {() => void | Promise<void>} props.onSignOut
 * @param {(result: { deletedRepository: boolean }) => void | Promise<void>} props.onAccountDeleted
 * @param {object} props.user
 * @param {object} [props.shellUser]
 * @param {'github' | 'google'} props.provider
 * @param {import('../lib/apiClient').ApiClient} [props.client]
 */
export default function AccountView({
  onSignOut,
  onAccountDeleted,
  user,
  shellUser,
  provider,
  client = apiClient,
}) {
  const pv = PROVIDERS[provider] || PROVIDERS.github
  const [autoDelete, setAutoDelete] = useState(user?.account?.settings?.autoDelete90d ?? true)
  /** @type {'idle' | 'confirm-wipe' | 'ask-repo' | 'busy'} */
  const [deleteStep, setDeleteStep] = useState('idle')
  const [deleteError, setDeleteError] = useState(null)

  const savedCount = user?.account?.scanCount ?? user?.account?.scans?.length ?? 0
  const storageLabel = user?.storage?.full_name || pv.dest
  const displayUser = shellUser || {
    name: user?.displayName || user?.username || 'User',
    email: user?.email || '',
  }
  const isGitHub = provider === 'github'
  const deleting = deleteStep === 'busy'

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

  const finishDeletion = async (deletedRepository) => {
    await onAccountDeleted({ deletedRepository })
  }

  /** First confirm — for GitHub, ask about the repo before any mutation. */
  const handleConfirmWipeIntent = async () => {
    setDeleteError(null)
    if (isGitHub) {
      setDeleteStep('ask-repo')
      return
    }
    setDeleteStep('busy')
    try {
      await client.wipeAccount()
      await finishDeletion(false)
    } catch (err) {
      setDeleteError(err.message || 'Failed to delete Vizably data from storage')
      setDeleteStep('confirm-wipe')
    }
  }

  const handleRepoChoice = async (shouldDeleteRepo) => {
    setDeleteError(null)
    setDeleteStep('busy')
    try {
      if (shouldDeleteRepo) {
        // Delete the repo first so a 403 leaves Vizably data untouched.
        await client.deleteAccountRepository()
        await finishDeletion(true)
        return
      }
      await client.wipeAccount()
      await finishDeletion(false)
    } catch (err) {
      setDeleteError(
        err.message ||
          (shouldDeleteRepo
            ? 'Failed to delete the GitHub repository'
            : 'Failed to delete Vizably data from storage'),
      )
      setDeleteStep('ask-repo')
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

      <Card style={{ marginBottom: 22 }}>
        <Section title="Data & storage" desc={`Your scans are saved in ${pv.store} — your space, not ours. Manage what’s kept here.`}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <RowItem icon={pv.destIcon} title={`Saved scans · ${savedCount}`} sub={savedCount ? `Stored in ${pv.storeShort} (${storageLabel}).` : 'No saved scans — nothing is taking up space.'}>
              <Button variant="secondary" size="sm" disabled title="Bulk delete lands in a later phase">
                {savedCount ? 'Delete all' : 'Cleared'}
              </Button>
            </RowItem>
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

      <Card style={{ borderColor: 'var(--sev-critical-bg)' }}>
        <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 2px', color: 'var(--sev-critical-fg)' }}>Delete account</h2>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', margin: '0 0 16px', lineHeight: 1.5 }}>
          Remove Vizably’s data from {pv.storeShort} ({storageLabel}), or delete the whole GitHub repository. Your {pv.name} login itself stays untouched. This can’t be undone.
        </p>

        {deleteError && (
          <div role="alert" style={{
            marginBottom: 12, padding: '10px 12px', borderRadius: 'var(--radius-md)',
            background: 'var(--sev-critical-bg)', border: '1px solid var(--sev-critical)',
            color: 'var(--sev-critical-fg)', fontSize: 'var(--text-sm)', lineHeight: 1.45,
          }}>
            {deleteError}
          </div>
        )}

        {deleteStep === 'idle' && (
          <Button variant="danger" onClick={() => setDeleteStep('confirm-wipe')} iconLeft={Ico('Trash2', 16, '#fff')}>
            Delete my account
          </Button>
        )}

        {deleteStep === 'confirm-wipe' && (
          <div style={{ background: 'var(--sev-critical-bg)', border: '1px solid var(--sev-critical)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)' }}>
            <p style={{ font: 'var(--font-label)', fontWeight: 'var(--weight-semibold)', color: 'var(--sev-critical-fg)', margin: '0 0 12px' }}>
              Delete Vizably data in {storageLabel}? This removes vizably.json and all saved scans.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Button variant="danger" disabled={deleting} onClick={handleConfirmWipeIntent} iconLeft={Ico('Trash2', 16, '#fff')}>
                {isGitHub ? 'Continue' : 'Delete my Vizably data'}
              </Button>
              <Button variant="secondary" disabled={deleting} onClick={() => { setDeleteStep('idle'); setDeleteError(null) }}>
                Keep my account
              </Button>
            </div>
          </div>
        )}

        {deleteStep === 'ask-repo' && (
          <div style={{ background: 'var(--sev-critical-bg)', border: '1px solid var(--sev-critical)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)' }}>
            <p style={{ font: 'var(--font-label)', fontWeight: 'var(--weight-semibold)', color: 'var(--sev-critical-fg)', margin: '0 0 8px' }}>
              Also delete the GitHub repository {storageLabel}?
            </p>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.45 }}>
              Yes deletes the whole repo (needs Vizably’s GitHub App <strong style={{ color: 'var(--text-body)' }}>Administration</strong> permission). No only removes Vizably files and leaves the repo. If delete fails, nothing is wiped yet.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Button variant="danger" disabled={deleting} onClick={() => handleRepoChoice(true)} iconLeft={Ico('Trash2', 16, '#fff')}>
                Yes, delete repository
              </Button>
              <Button variant="secondary" disabled={deleting} onClick={() => handleRepoChoice(false)}>
                No, wipe data only
              </Button>
            </div>
          </div>
        )}

        {deleteStep === 'busy' && (
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', margin: 0 }}>
            Working…
          </p>
        )}
      </Card>

      <p style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 20, lineHeight: 1.5 }}>
        <span style={{ color: 'var(--green-600)', marginTop: 1 }}>{Ico('Leaf', 15, 'currentColor')}</span>
        Because your scans live in {pv.store} ({storageLabel}), Vizably keeps no database of its own — your data stays yours, and there’s no server cost to pass on.
      </p>
    </div>
  )
}
