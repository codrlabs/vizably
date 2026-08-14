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

  it('asks about repo delete before any mutation, then deletes the repo first', async () => {
    const onAccountDeleted = vi.fn()
    const client = {
      wipeAccount: vi.fn(),
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
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))

    expect(await screen.findByText(/also delete the github repository/i)).toBeInTheDocument()
    expect(client.wipeAccount).not.toHaveBeenCalled()
    expect(client.deleteAccountRepository).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /yes, delete repository/i }))

    await waitFor(() => expect(client.deleteAccountRepository).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(onAccountDeleted).toHaveBeenCalledWith({ deletedRepository: true }),
    )
    expect(client.wipeAccount).not.toHaveBeenCalled()
  })

  it('wipes only when the user keeps the repository', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    expect(await screen.findByText(/also delete the github repository/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /no, wipe data only/i }))

    await waitFor(() => expect(client.wipeAccount).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(onAccountDeleted).toHaveBeenCalledWith({ deletedRepository: false }),
    )
    expect(client.deleteAccountRepository).not.toHaveBeenCalled()
  })

  it('leaves the store intact when repo delete fails', async () => {
    const onAccountDeleted = vi.fn()
    const client = {
      wipeAccount: vi.fn(),
      deleteAccountRepository: vi.fn().mockRejectedValue(
        new Error('GitHub App cannot delete repositories'),
      ),
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
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    fireEvent.click(await screen.findByRole('button', { name: /yes, delete repository/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot delete/i)
    expect(client.wipeAccount).not.toHaveBeenCalled()
    expect(onAccountDeleted).not.toHaveBeenCalled()
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
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    fireEvent.click(await screen.findByRole('button', { name: /no, wipe data only/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/refused the wipe/i)
    expect(onAccountDeleted).not.toHaveBeenCalled()
  })
})
