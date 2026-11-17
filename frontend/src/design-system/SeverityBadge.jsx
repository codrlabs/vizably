/**
 * SeverityBadge — the signature vizably signal. Maps an axe-core
 * impact level to its color, and ALWAYS pairs that color with a
 * distinct glyph + text label so the meaning never depends on color
 * alone (WCAG 1.4.1 Use of Color).
 *
 * level: 'critical' | 'serious' | 'moderate' | 'minor'
 */
export default function SeverityBadge({ level = 'moderate', variant = 'soft', showLabel = true, size = 'md', style = {} }) {
  const map = {
    critical: { label: 'Critical', glyph: '●', fg: 'var(--sev-critical-fg)', solid: 'var(--sev-critical)', bg: 'var(--sev-critical-bg)' },
    serious: { label: 'Serious', glyph: '▲', fg: 'var(--sev-serious-fg)', solid: 'var(--sev-serious)', bg: 'var(--sev-serious-bg)' },
    moderate: { label: 'Moderate', glyph: '◆', fg: 'var(--sev-moderate-fg)', solid: 'var(--sev-moderate)', bg: 'var(--sev-moderate-bg)' },
    minor: { label: 'Minor', glyph: '■', fg: 'var(--sev-minor-fg)', solid: 'var(--sev-minor)', bg: 'var(--sev-minor-bg)' },
  }
  const s = map[level] || map.moderate
  const dims = size === 'sm'
    ? { pad: '2px 8px', fs: 'var(--text-xs)', glyph: 9 }
    : { pad: '4px 11px', fs: 'var(--text-sm)', glyph: 11 }
  const solid = variant === 'solid'
  return (
    <span
      role="img"
      aria-label={`${s.label} severity`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: dims.pad,
        background: solid ? s.solid : s.bg,
        color: solid ? '#fff' : s.fg,
        border: variant === 'outline' ? `1px solid ${s.solid}` : '1px solid transparent',
        font: 'var(--font-label)', fontSize: dims.fs,
        borderRadius: 'var(--radius-pill)', whiteSpace: 'nowrap',
        ...style,
      }}
    >
      <span aria-hidden="true" style={{ fontSize: dims.glyph, lineHeight: 1, color: solid ? '#fff' : s.solid }}>{s.glyph}</span>
      {showLabel && s.label}
    </span>
  )
}
