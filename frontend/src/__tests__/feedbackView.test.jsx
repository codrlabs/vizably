
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import FeedbackView from '../views/FeedbackView'

describe('FeedbackView', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the feedback form and email link', () => {
    render(<FeedbackView />)

    expect(screen.getByLabelText(/feedback type/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/your message/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/scanned website url/i)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /submit feedback/i }),
    ).toBeInTheDocument()

    expect(
      screen.getByRole('link', { name: /contact us directly/i }),
    ).toHaveAttribute('href', 'mailto:solabode223@gmail.com')
  })

  it('requires a feedback message', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    render(<FeedbackView />)

    fireEvent.click(screen.getByRole('button', { name: /submit feedback/i }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      /please enter your feedback message/i,
    )
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('opens a GitHub issue with an encoded title and body', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    render(<FeedbackView />)

    const message = 'The scan misses keyboard navigation!'

    fireEvent.change(screen.getByLabelText(/feedback type/i), {
      target: { value: 'Bug' },
    })

    fireEvent.change(screen.getByLabelText(/your message/i), {
      target: { value: message },
    })

    fireEvent.change(screen.getByLabelText(/scanned website url/i), {
      target: { value: 'https://example.com' },
    })

    fireEvent.click(screen.getByRole('button', { name: /submit feedback/i }))

    expect(openSpy).toHaveBeenCalledTimes(1)

    const [openedUrl, target] = openSpy.mock.calls[0]

    expect(openedUrl).toContain(
      `title=${encodeURIComponent(`[Feedback] Bug: ${message}`)}`,
    )

    const expectedBody = [
      '**Feedback type:** Bug',
      '',
      '**Message:**',
      message,
      '',
      '**Scanned URL:**',
      'https://example.com',
    ].join('\n')

    expect(openedUrl).toContain(
      `body=${encodeURIComponent(expectedBody)}`,
    )

    expect(target).toBe('_blank')
  })
})
