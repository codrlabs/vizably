import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import LandingView from '../views/LandingView'

function renderLanding(onScan = vi.fn()) {
  render(<LandingView onScan={onScan} />)
  return onScan
}

const typeAndScan = (value) => {
  fireEvent.change(screen.getByLabelText('Website URL'), { target: { value } })
  fireEvent.click(screen.getByRole('button', { name: /scan/i }))
}

describe('LandingView', () => {
  it('shows a validation error and does not scan on invalid input', () => {
    const onScan = renderLanding()
    typeAndScan('not a url')

    expect(screen.getByRole('alert')).toHaveTextContent(/doesn’t look like a URL/)
    expect(onScan).not.toHaveBeenCalled()
  })

  it('normalizes bare domains to https:// before scanning', async () => {
    const onScan = renderLanding(vi.fn().mockResolvedValue())
    typeAndScan('example.com')

    await waitFor(() => expect(onScan).toHaveBeenCalledWith('https://example.com'))
  })

  it('shows scanning progress stages while the scan promise is pending', async () => {
    let resolve
    const onScan = vi.fn(() => new Promise((r) => { resolve = r }))
    renderLanding(onScan)
    typeAndScan('https://example.com')

    expect(await screen.findByRole('status')).toHaveTextContent(/Scanning/)
    expect(screen.getByText(/Connecting to the target website/)).toBeInTheDocument()
    resolve()
  })

  it('surfaces a scan failure and returns to the idle form', async () => {
    renderLanding(vi.fn().mockRejectedValue(new Error('Scan failed — please try again.')))
    typeAndScan('example.com')

    expect(await screen.findByRole('alert')).toHaveTextContent('Scan failed — please try again.')
    expect(screen.getByLabelText('Website URL')).toBeInTheDocument()
  })
})
