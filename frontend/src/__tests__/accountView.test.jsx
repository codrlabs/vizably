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
  it('exports data in the chosen format and surfaces failures', async () => {
    const onExport = vi.fn().mockResolvedValueOnce().mockRejectedValueOnce(new Error('boom'))
    render(<AccountView onSignOut={vi.fn()} onExport={onExport} user={USER} provider="github" />)

    fireEvent.click(screen.getByRole('button', { name: /export as json/i }))
    await waitFor(() => expect(onExport).toHaveBeenCalledWith('json'))

    fireEvent.click(await screen.findByRole('button', { name: /export as pdf/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
    expect(onExport).toHaveBeenLastCalledWith('pdf')
  })

  it('tells the user when some scans could not be exported', async () => {
    const onExport = vi.fn().mockResolvedValue({ total: 100, failed: 6 })
    render(<AccountView onSignOut={vi.fn()} onExport={onExport} user={USER} provider="github" />)

    fireEvent.click(screen.getByRole('button', { name: /export as json/i }))
    expect(await screen.findByRole('status')).toHaveTextContent('94 of 100 scans exported')
  })

  it('confirms a full export too', async () => {
    const onExport = vi.fn().mockResolvedValue({ total: 100, failed: 0 })
    render(<AccountView onSignOut={vi.fn()} onExport={onExport} user={USER} provider="github" />)

    fireEvent.click(screen.getByRole('button', { name: /export as json/i }))
    expect(await screen.findByRole('status')).toHaveTextContent(/^100 of 100 scans exported\.$/)
  })

  it('says so when there are no saved scans', async () => {
    const onExport = vi.fn().mockResolvedValue({ total: 0, failed: 0 })
    render(<AccountView onSignOut={vi.fn()} onExport={onExport} user={USER} provider="github" />)

    fireEvent.click(screen.getByRole('button', { name: /export as json/i }))
    expect(await screen.findByRole('status')).toHaveTextContent('No saved scans to export.')
  })
})
