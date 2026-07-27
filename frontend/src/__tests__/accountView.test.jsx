import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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
})
