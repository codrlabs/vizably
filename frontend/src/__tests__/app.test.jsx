import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

// The whole app, wired the way it runs, with only the network mocked. This is
// what catches a prop App.jsx forgets to pass: the view tests render
// DashboardView directly and hand it every prop.
const { apiClient } = vi.hoisted(() => ({
  apiClient: {
    getAuthStatus: vi.fn(),
    getUser: vi.fn(),
    listScans: vi.fn(),
    deleteScan: vi.fn(),
    deleteScans: vi.fn(),
  },
}))
vi.mock('../lib/apiClient', () => ({ apiClient }))

import App from '../App'

const SCANS = [
  { id: 's1', url: 'https://example.com', host: 'example.com', score: 80, scannedAt: '2026-11-01T12:00:00Z', topSeverity: 'serious' },
  { id: 's2', url: 'https://other.org', host: 'other.org', score: 60, scannedAt: '2026-11-02T12:00:00Z', topSeverity: 'moderate' },
]

/** Open the dashboard and let the list refresh it runs on open finish. */
async function openDashboard() {
  render(<App />)
  await screen.findByLabelText(/^select all scans$/i)
  await waitFor(() => expect(apiClient.listScans).toHaveBeenCalledTimes(2))
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
}

describe('App dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.scrollTo = vi.fn()
    window.history.pushState({}, '', '/dashboard')
    apiClient.getAuthStatus.mockResolvedValue({ authenticated: true })
    apiClient.getUser.mockResolvedValue({
      username: 'sam',
      email: 'sam@example.com',
      provider: 'github',
      storage: { id: 'R_kg', full_name: 'sam/viz_scans' },
      account: { settings: {}, scanCount: 2 },
    })
    apiClient.listScans.mockResolvedValue({ scanCount: 2, scans: SCANS })
  })

  it('shows the per-row delete next to the checkboxes and deletes one scan', async () => {
    apiClient.deleteScan.mockResolvedValue({ scanCount: 1, scans: [SCANS[1]] })
    await openDashboard()

    expect(screen.getByLabelText(/select scan example.com/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /delete scan example.com/i }))
    fireEvent.click(screen.getByRole('button', { name: /yes, delete/i }))

    await waitFor(() => expect(apiClient.deleteScan).toHaveBeenCalledWith('s1'))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /delete scan example.com/i })).not.toBeInTheDocument(),
    )
  })

  it('bulk-deletes the selected scans by id', async () => {
    apiClient.deleteScans.mockResolvedValue({ deletedCount: 2, scanCount: 0, scans: [] })
    await openDashboard()

    fireEvent.click(screen.getByLabelText(/^select all scans$/i))
    fireEvent.click(screen.getByRole('button', { name: /delete 2 selected/i }))
    fireEvent.click(screen.getByRole('button', { name: /yes, delete/i }))

    await waitFor(() => expect(apiClient.deleteScans).toHaveBeenCalledWith(['s1', 's2']))
  })
})
