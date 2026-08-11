import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AccountView from '../views/AccountView'

const USER = {
  email: 'sam@example.com',
  displayName: 'Sam',
  account: {
    scanCount: 3,
    settings: { autoDelete90d: true },
  },
  storage: { id: 'R_kg', full_name: 'sam/vizably-scans' },
}

describe('AccountView', () => {
  it('renders profile and storage summary', () => {
    render(
      <AccountView
        onSignOut={vi.fn()}
        onAccountDeleted={vi.fn()}
        user={USER}
        shellUser={{ name: 'Sam', email: 'sam@example.com' }}
        provider="github"
      />,
    )

    expect(screen.getByText(/connected with github/i)).toBeInTheDocument()
    expect(screen.getByText('sam@example.com')).toBeInTheDocument()
    expect(screen.getByText(/saved scans · 3/i)).toBeInTheDocument()
  })

  it('shows auto-delete enabled from account settings', () => {
    render(
      <AccountView
        onSignOut={vi.fn()}
        onAccountDeleted={vi.fn()}
        user={USER}
        shellUser={{ name: 'Sam', email: 'sam@example.com' }}
        provider="github"
      />,
    )

    expect(screen.getByRole('switch')).toBeChecked()
  })

  it('calls onSignOut from the header without wiping', () => {
    const onSignOut = vi.fn()
    render(
      <AccountView
        onSignOut={onSignOut}
        onAccountDeleted={vi.fn()}
        user={USER}
        shellUser={{ name: 'Sam', email: 'sam@example.com' }}
        provider="github"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /^sign out$/i }))
    expect(onSignOut).toHaveBeenCalledTimes(1)
  })

  it('wipes storage then asks about repo delete before finishing', async () => {
    const onAccountDeleted = vi.fn()
    const client = {
      wipeAccount: vi.fn().mockResolvedValue({
        success: true,
        wiped: true,
        pathsRemoved: ['vizably.json'],
        storageRef: { id: 'R_kg', full_name: 'sam/vizably-scans', branch: 'main' },
      }),
      deleteAccountRepository: vi.fn().mockResolvedValue({
        success: true,
        deleted: true,
        full_name: 'sam/vizably-scans',
      }),
    }

    render(
      <AccountView
        onSignOut={vi.fn()}
        onAccountDeleted={onAccountDeleted}
        user={USER}
        shellUser={{ name: 'Sam', email: 'sam@example.com' }}
        provider="github"
        client={client}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /delete my account/i }))
    fireEvent.click(screen.getByRole('button', { name: /delete my vizably data/i }))

    expect(await screen.findByText(/also delete the github repository/i)).toBeInTheDocument()
    expect(client.wipeAccount).toHaveBeenCalledTimes(1)
    expect(onAccountDeleted).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /yes, delete repository/i }))

    await waitFor(() => expect(client.deleteAccountRepository).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(onAccountDeleted).toHaveBeenCalledWith({ deletedRepository: true }),
    )
  })

  it('skips repo delete when the user keeps the repository', async () => {
    const onAccountDeleted = vi.fn()
    const client = {
      wipeAccount: vi.fn().mockResolvedValue({
        success: true,
        wiped: true,
        pathsRemoved: [],
        storageRef: { id: 'R_kg', full_name: 'sam/vizably-scans', branch: 'main' },
      }),
      deleteAccountRepository: vi.fn(),
    }

    render(
      <AccountView
        onSignOut={vi.fn()}
        onAccountDeleted={onAccountDeleted}
        user={USER}
        shellUser={{ name: 'Sam', email: 'sam@example.com' }}
        provider="github"
        client={client}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /delete my account/i }))
    fireEvent.click(screen.getByRole('button', { name: /delete my vizably data/i }))
    expect(await screen.findByText(/also delete the github repository/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /no, keep repository/i }))

    await waitFor(() =>
      expect(onAccountDeleted).toHaveBeenCalledWith({ deletedRepository: false }),
    )
    expect(client.deleteAccountRepository).not.toHaveBeenCalled()
  })

  it('shows wipe errors without signing out', async () => {
    const onAccountDeleted = vi.fn()
    const client = {
      wipeAccount: vi.fn().mockRejectedValue(new Error('GitHub refused the wipe')),
      deleteAccountRepository: vi.fn(),
    }

    render(
      <AccountView
        onSignOut={vi.fn()}
        onAccountDeleted={onAccountDeleted}
        user={USER}
        shellUser={{ name: 'Sam', email: 'sam@example.com' }}
        provider="github"
        client={client}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /delete my account/i }))
    fireEvent.click(screen.getByRole('button', { name: /delete my vizably data/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/refused the wipe/i)
    expect(onAccountDeleted).not.toHaveBeenCalled()
  })
})
