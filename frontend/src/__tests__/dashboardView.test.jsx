import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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
})
