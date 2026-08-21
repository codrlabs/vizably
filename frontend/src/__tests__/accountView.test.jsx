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
  storage: { full_name: 'sam/vizably-scans' },
}

describe('AccountView', () => {
  it('renders profile and storage summary', () => {
    render(
      <AccountView
        onSignOut={vi.fn()}
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
        user={USER}
        shellUser={{ name: 'Sam', email: 'sam@example.com' }}
        provider="github"
      />,
    )

    expect(screen.getByRole('switch')).toBeChecked()
  })

  it('calls onSignOut from the header and from delete confirm', () => {
    const onSignOut = vi.fn()
    render(
      <AccountView
        onSignOut={onSignOut}
        user={USER}
        shellUser={{ name: 'Sam', email: 'sam@example.com' }}
        provider="github"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /^sign out$/i }))
    expect(onSignOut).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /delete my account/i }))
    fireEvent.click(screen.getByRole('button', { name: /yes, sign out/i }))
    expect(onSignOut).toHaveBeenCalledTimes(2)
  })

  it('asks for confirm before delete-all and calls onDeleteAllScans', async () => {
    const onDeleteAllScans = vi.fn().mockResolvedValue({
      deletedCount: 3,
      scanCount: 0,
      scans: [],
    })

    const { rerender } = render(
      <AccountView
        onSignOut={vi.fn()}
        onDeleteAllScans={onDeleteAllScans}
        user={USER}
        shellUser={{ name: 'Sam', email: 'sam@example.com' }}
        provider="github"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /^delete all$/i }))
    expect(screen.getByText(/delete all 3 saved scans/i)).toBeInTheDocument()
    expect(onDeleteAllScans).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /yes, delete all/i }))
    await waitFor(() => expect(onDeleteAllScans).toHaveBeenCalledTimes(1))

    rerender(
      <AccountView
        onSignOut={vi.fn()}
        onDeleteAllScans={onDeleteAllScans}
        user={{
          ...USER,
          account: { ...USER.account, scanCount: 0 },
        }}
        shellUser={{ name: 'Sam', email: 'sam@example.com' }}
        provider="github"
      />,
    )

    expect(screen.getByRole('button', { name: /^cleared$/i })).toBeDisabled()
  })

  it('keeps scans when confirm is cancelled', () => {
    const onDeleteAllScans = vi.fn()
    render(
      <AccountView
        onSignOut={vi.fn()}
        onDeleteAllScans={onDeleteAllScans}
        user={USER}
        shellUser={{ name: 'Sam', email: 'sam@example.com' }}
        provider="github"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /^delete all$/i }))
    fireEvent.click(screen.getByRole('button', { name: /keep scans/i }))
    expect(screen.getByRole('button', { name: /^delete all$/i })).toBeInTheDocument()
    expect(onDeleteAllScans).not.toHaveBeenCalled()
  })

  it('shows delete-all errors without clearing', async () => {
    const onDeleteAllScans = vi.fn().mockRejectedValue(new Error('GitHub refused the wipe'))
    render(
      <AccountView
        onSignOut={vi.fn()}
        onDeleteAllScans={onDeleteAllScans}
        user={USER}
        shellUser={{ name: 'Sam', email: 'sam@example.com' }}
        provider="github"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /^delete all$/i }))
    fireEvent.click(screen.getByRole('button', { name: /yes, delete all/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/refused the wipe/i)
    expect(screen.getByText(/saved scans · 3/i)).toBeInTheDocument()
  })
})
