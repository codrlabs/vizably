
import { useState } from 'react'
import { Button, Input, Card } from '../design-system'

const GITHUB_ISSUES_URL =
  'https://github.com/codrlabs/vizably/issues/new'

const FEEDBACK_TYPES = [
  'Bug',
  'Scan result looks wrong',
  'Idea',
  'Other',
]

export default function FeedbackView() {
  const [type, setType] = useState('Bug')
  const [message, setMessage] = useState('')
  const [scannedUrl, setScannedUrl] = useState('')
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  function handleSubmit(event) {
    event.preventDefault()

    const trimmedMessage = message.trim()

    if (!trimmedMessage) {
      setError('Please enter your feedback message.')
      setStatus('')
      return
    }

    setError('')

    const title = `[Feedback] ${type}: ${trimmedMessage.slice(0, 60)}`

    const body = [
      `**Feedback type:** ${type}`,
      '',
      '**Message:**',
      trimmedMessage,
      '',
      '**Scanned URL:**',
      scannedUrl.trim() || 'Not provided',
    ].join('\n')

    const githubUrl =
      `${GITHUB_ISSUES_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`

    window.open(githubUrl, '_blank', 'noopener,noreferrer')

    setStatus('GitHub issue opened in a new tab. You can review and submit your feedback there.')
  }

  return (
    <div
      style={{
        width: '100%',
        maxWidth: 680,
        margin: '0 auto',
        padding: '64px 24px 80px',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ marginBottom: 28 }}>
        <p
          style={{
            color: 'var(--accent)',
            font: 'var(--font-label)',
            marginBottom: 10,
          }}
        >
          HELP US IMPROVE VIZABLY
        </p>

        <h1
          style={{
            fontSize: 'var(--text-2xl)',
            color: 'var(--text-strong)',
            margin: '0 0 12px',
          }}
        >
          Share your feedback
        </h1>

        <p
          style={{
            color: 'var(--text-muted)',
            font: 'var(--font-body)',
            lineHeight: 1.7,
            margin: 0,
          }}
        >
          Found a bug, noticed a missing or incorrect accessibility
          finding, or have an idea? We'd love to hear from you.
          Your feedback helps make Vizably better.
        </p>
      </div>

      <Card padding="var(--space-6)">
        <form onSubmit={handleSubmit} noValidate>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 22,
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 7,
              }}
            >
              <label
                htmlFor="feedback-type"
                style={{
                  font: 'var(--font-label)',
                  color: 'var(--text-strong)',
                }}
              >
                Feedback type
              </label>

              <select
                id="feedback-type"
                value={type}
                onChange={(event) => setType(event.target.value)}
                style={{
                  width: '100%',
                  height: 44,
                  padding: '0 14px',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--surface-card)',
                  color: 'var(--text-strong)',
                  font: 'var(--font-body)',
                }}
              >
                {FEEDBACK_TYPES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="feedback-message"
                style={{
                  display: 'block',
                  font: 'var(--font-label)',
                  color: 'var(--text-strong)',
                  marginBottom: 7,
                }}
              >
                Your message <span aria-hidden="true">*</span>
              </label>

              <textarea
                id="feedback-message"
                value={message}
                onChange={(event) => {
                  setMessage(event.target.value)
                  if (error) setError('')
                }}
                required
                aria-invalid={error ? 'true' : undefined}
                aria-describedby={error ? 'feedback-error' : undefined}
                placeholder="Tell us what happened or share your idea..."
                rows={6}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: 14,
                  resize: 'vertical',
                  border: `1px solid ${error ? 'var(--sev-critical)' : 'var(--border-strong)'}`,
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--surface-card)',
                  color: 'var(--text-strong)',
                  font: 'var(--font-body)',
                  outlineColor: 'var(--accent)',
                }}
              />

              {error && (
                <p
                  id="feedback-error"
                  role="alert"
                  style={{
                    color: 'var(--sev-critical-fg)',
                    font: 'var(--font-label)',
                    margin: '7px 0 0',
                  }}
                >
                  {error}
                </p>
              )}
            </div>

            <Input
              label="Scanned website URL (optional)"
              type="url"
              placeholder="https://example.com"
              value={scannedUrl}
              onChange={(event) => setScannedUrl(event.target.value)}
              hint="If your feedback relates to a scan, share the website URL."
            />

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <Button type="submit" size="lg" style={{ width: '100%' }}>
                Submit feedback
              </Button>

              {status && (
                <p
                  role="status"
                  style={{
                    color: 'var(--text-body)',
                    font: 'var(--font-body)',
                    lineHeight: 1.5,
                    margin: 0,
                  }}
                >
                  {status}
                </p>
              )}

              <p
                style={{
                  color: 'var(--text-muted)',
                  font: 'var(--font-body)',
                  fontSize: 'var(--text-sm)',
                  lineHeight: 1.6,
                  margin: 0,
                  textAlign: 'center',
                }}
              >
                GitHub will open in a new tab so you can review and
                submit your feedback.
              </p>
            </div>
          </div>
        </form>
      </Card>

      <p
        style={{
          textAlign: 'center',
          color: 'var(--text-muted)',
          font: 'var(--font-body)',
          fontSize: 'var(--text-sm)',
          marginTop: 24,
        }}
      >
        Prefer email?{' '}
        <a
          href="mailto:solabode223@gmail.com"
          style={{
            color: 'var(--text-link)',
            textDecoration: 'underline',
          }}
        >
          Contact us directly
        </a>
      </p>
    </div>
  )
}
