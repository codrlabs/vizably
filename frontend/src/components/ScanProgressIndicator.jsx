import { useScanProgress } from '../hooks/useScanProgress'

/**
 * Spinner + staged scan progress messages (issue #75).
 * Rotating stage copy is visual-only (`aria-hidden`) so screen readers hear
 * one stable status line instead of every stage change.
 *
 * @param {object} props
 * @param {string} [props.url] site being scanned (shown above the stage line)
 * @param {boolean} [props.fill] stretch to fill parent (results refetch layout)
 */
export default function ScanProgressIndicator({ url, fill = false }) {
  const stage = useScanProgress(true)
  const label = url ? `Scanning ${url}` : 'Scanning'
  const statusText = url
    ? `Scanning ${url}, this can take up to a minute.`
    : 'Scanning, this can take up to a minute.'

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      style={{
        flex: fill ? 1 : undefined,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        padding: fill ? '64px 24px' : '20px 0',
        textAlign: 'center',
      }}
    >
      <div
        className="ev-spin"
        aria-hidden="true"
        style={{
          width: 34,
          height: 34,
          borderRadius: '50%',
          border: '3px solid var(--blue-100)',
          borderTopColor: 'var(--accent)',
          marginBottom: 8,
        }}
      />
      {/* Fixed announcement for assistive tech; visual headline stays below. */}
      <span
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0, 0, 0, 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {statusText}
      </span>
      <div
        aria-hidden="true"
        style={{ font: 'var(--font-label)', color: 'var(--text-strong)' }}
      >
        {label}…
      </div>
      <div
        aria-hidden="true"
        style={{
          font: 'var(--font-body)',
          fontSize: 'var(--text-sm)',
          color: 'var(--text-muted)',
          lineHeight: 1.45,
          maxWidth: 360,
          minHeight: '1.45em',
        }}
      >
        {stage}
      </div>
    </div>
  )
}
