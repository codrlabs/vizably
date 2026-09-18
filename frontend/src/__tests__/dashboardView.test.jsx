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

  it('does not render checkboxes or select-all when onDeleteMany is absent', () => {
    render(
      <DashboardView
        onNav={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        saved={SAVED}
        provider="github"
        user={{ email: 'sam@example.com' }}
      />,
    )
    expect(screen.queryByLabelText(/select all scans/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/select scan example.com/i)).not.toBeInTheDocument()
  })

  it('selects scans with checkboxes and bulk-deletes the selection', async () => {
    const onOpen = vi.fn()
    const onDeleteMany = vi.fn().mockResolvedValue(undefined)
    render(
      <DashboardView
        onNav={vi.fn()}
        onOpen={onOpen}
        onDelete={vi.fn()}
        onDeleteMany={onDeleteMany}
        saved={SAVED}
        provider="github"
        user={{ email: 'sam@example.com' }}
      />,
    )

    fireEvent.click(screen.getByLabelText(/select scan example.com/i))
    expect(onOpen).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /delete 1 selected/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /delete 1 selected/i }))
    expect(screen.getByText(/delete 1 selected scan\?/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /yes, delete/i }))
    await waitFor(() => expect(onDeleteMany).toHaveBeenCalledWith(['s1']))
  })

  it('select all checks every row and bulk-deletes everything', async () => {
    const onDeleteMany = vi.fn().mockResolvedValue(undefined)
    render(
      <DashboardView
        onNav={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDeleteMany={onDeleteMany}
        saved={SAVED}
        provider="github"
        user={{ email: 'sam@example.com' }}
      />,
    )

    fireEvent.click(screen.getByLabelText(/^select all scans$/i))
    expect(screen.getByLabelText(/select scan example.com/i)).toBeChecked()
    expect(screen.getByLabelText(/select scan other.org/i)).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: /delete 2 selected/i }))
    fireEvent.click(screen.getByRole('button', { name: /yes, delete/i }))
    await waitFor(() => expect(onDeleteMany).toHaveBeenCalledWith(['s1', 's2']))
  })

  it('shows bulk-delete errors without clearing the selection', async () => {
    const onDeleteMany = vi.fn().mockRejectedValue(new Error('GitHub refused the delete'))
    render(
      <DashboardView
        onNav={vi.fn()}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
        onDeleteMany={onDeleteMany}
        saved={SAVED}
        provider="github"
        user={{ email: 'sam@example.com' }}
      />,
    )

    fireEvent.click(screen.getByLabelText(/select scan example.com/i))
    fireEvent.click(screen.getByRole('button', { name: /delete 1 selected/i }))
    fireEvent.click(screen.getByRole('button', { name: /yes, delete/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/refused the delete/i)
    expect(screen.getByLabelText(/select scan example.com/i)).toBeChecked()
  })
})
