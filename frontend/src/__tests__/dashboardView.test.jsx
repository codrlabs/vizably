import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import DashboardView from '../views/DashboardView'

const SAVED = [
  {
    id: 's1',
    url: 'example.com',
    score: 92,
    issues: 1,
    when: 'Today',
    top: 'minor',
  },
  {
    id: 's2',
    url: 'other.org',
    score: 55,
    issues: 8,
    when: 'Yesterday',
    top: 'serious',
  },
]

describe('DashboardView', () => {
  it('shows the empty state and navigates to landing for a first scan', () => {
    const onNav = vi.fn()
    render(
      <DashboardView
        onNav={onNav}
        onOpen={vi.fn()}
        saved={[]}
        provider="github"
        user={{ email: 'sam@example.com' }}
        storage={{ full_name: 'sam/vizably-scans' }}
      />,
    )

    expect(screen.getByText(/no scans yet/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /scan your first site/i }))
    expect(onNav).toHaveBeenCalledWith('landing')
  })

  it('lists saved scans and opens one on click', () => {
    const onOpen = vi.fn()
    render(
      <DashboardView
        onNav={vi.fn()}
        onOpen={onOpen}
        saved={SAVED}
        provider="github"
        user={{ email: 'sam@example.com' }}
        storage={{ full_name: 'sam/vizably-scans' }}
      />,
    )

    expect(screen.getByText('example.com')).toBeInTheDocument()
    expect(screen.getByText('Sites saved')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()

    fireEvent.click(screen.getByText('example.com'))
    expect(onOpen).toHaveBeenCalledWith(SAVED[0])
  })

  it('opens a scan with keyboard Enter', () => {
    const onOpen = vi.fn()
    render(
      <DashboardView
        onNav={vi.fn()}
        onOpen={onOpen}
        saved={SAVED}
        provider="github"
        user={{ email: 'sam@example.com' }}
      />,
    )

    const row = screen.getByText('other.org').closest('[role="button"]')
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledWith(SAVED[1])
  })

  it('asks for confirm before delete and does not open the scan', async () => {
    const onOpen = vi.fn()
    const onDelete = vi.fn().mockResolvedValue(undefined)
    render(
      <DashboardView
        onNav={vi.fn()}
        onOpen={onOpen}
        onDelete={onDelete}
        saved={SAVED}
        provider="github"
        user={{ email: 'sam@example.com' }}
        storage={{ full_name: 'sam/vizably-scans' }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /delete scan example.com/i }))
    expect(onOpen).not.toHaveBeenCalled()
    expect(screen.getByText(/delete this scan/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /yes, delete/i }))
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(SAVED[0]))
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('cancel leaves the list alone without calling onDelete', () => {
    const onDelete = vi.fn()
    render(
      <DashboardView
        onNav={vi.fn()}
        onOpen={vi.fn()}
        onDelete={onDelete}
        saved={SAVED}
        provider="github"
        user={{ email: 'sam@example.com' }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /delete scan example.com/i }))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.queryByText(/delete this scan/i)).not.toBeInTheDocument()
  })
})
