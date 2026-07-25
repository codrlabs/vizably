import { useScanProgress } from '../hooks/useScanProgress'

/**
 * Spinner + staged scan progress messages (issue #75).
 *
 * @param {object} props
 * @param {string} [props.url] site being scanned (shown above the stage line)
 * @param {boolean} [props.fill] stretch to fill parent (results refetch layout)
 */
export default function ScanProgressIndicator({ url, fill = false }) {
  const stage = useScanProgress(true)
  const label = url ? `Scanning ${url}` : 'Scanning'

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
        style={{
          width: 34,
          height: 34,
          borderRadius: '50%',
          border: '3px solid var(--blue-100)',
          borderTopColor: 'var(--accent)',
          marginBottom: 8,
        }}
      />
      <div style={{ font: 'var(--font-label)', color: 'var(--text-strong)' }}>
        {label}…
      </div>
      <div
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
