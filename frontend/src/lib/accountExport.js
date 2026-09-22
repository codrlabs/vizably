/**
 * "Download my data" — gather the signed-in user's account + every saved
 * report from their store, and hand it back as a JSON file or a printable
 * (Save as PDF) document.
 */

const CATEGORY_LABELS = {
  visualAccessibility: 'Visual accessibility',
  structureAndSemantics: 'Structure & semantics',
  multimedia: 'Multimedia',
}

/**
 * @param {object} user session user (with `account.scans` index entries)
 * @param {(id: string) => Promise<object>} getSavedScan
 */
export async function buildAccountExport(user, getSavedScan) {
  const entries = user?.account?.scans ?? []
  // One failed scan file shouldn't sink the whole export — record it and move on.
  const scans = await Promise.all(entries.map((entry) =>
    getSavedScan(entry.id).catch((err) => ({ ...entry, error: err?.message || 'Could not load this scan' })),
  ))
  return {
    exportedAt: new Date().toISOString(),
    profile: {
      name: user?.displayName || user?.username || '',
      username: user?.username || '',
      email: user?.email || '',
    },
    storage: user?.storage ?? null,
    settings: user?.account?.settings ?? {},
    scanCount: scans.length,
    scans,
  }
}

function fileStamp(data) {
  return data.exportedAt.slice(0, 10)
}

/** @param {object} data output of buildAccountExport */
export function downloadJson(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `vizably-data-${fileStamp(data)}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
))

/** Printable HTML for the export. Every value is escaped — scan data comes from third-party pages. */
export function toPrintableHtml(data) {
  const scans = data.scans.map((s) => {
    if (s.error) return `<section><h2>${esc(s.url || s.host || s.id)}</h2><p class="muted">Could not load: ${esc(s.error)}</p></section>`
    const problems = s.result?.problems ?? {}
    const cats = Object.entries(problems).map(([key, list]) => `
      <h3>${esc(CATEGORY_LABELS[key] || key)} (${list?.length ?? 0})</h3>
      ${list?.length ? `<ul>${list.map((p) => `<li><strong>${esc(p.name)}</strong>${p.impact ? ` <span class="muted">· ${esc(p.impact)}</span>` : ''}${p.rootCause ? `<br>${esc(p.rootCause)}` : ''}</li>`).join('')}</ul>` : '<p class="muted">No problems found.</p>'}`).join('')
    const good = s.result?.whatsGood?.length
      ? `<h3>What's good</h3><ul>${s.result.whatsGood.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>`
      : ''
    return `<section><h2>${esc(s.url)}</h2><p class="muted">Scanned ${esc(s.scannedAt ? new Date(s.scannedAt).toLocaleString() : 'unknown')}</p>${cats}${good}</section>`
  }).join('')

  return `<!doctype html><html><head><meta charset="utf-8"><title>vizably-data-${esc(fileStamp(data))}</title>
<style>
  body { font: 13px/1.5 system-ui, sans-serif; color: #111; margin: 32px; }
  h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 0 0 2px; word-break: break-all; }
  h3 { font-size: 13px; margin: 12px 0 4px; } ul { margin: 0; padding-left: 18px; } li { margin-bottom: 4px; }
  section { border-top: 1px solid #ccc; padding-top: 14px; margin-top: 18px; break-inside: avoid-page; }
  .muted { color: #666; margin: 0; } dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; }
  dt { color: #666; } dd { margin: 0; }
</style></head><body>
<h1>Vizably — my data</h1>
<p class="muted">Exported ${esc(new Date(data.exportedAt).toLocaleString())}</p>
<dl>
  <dt>Name</dt><dd>${esc(data.profile.name)}</dd>
  <dt>Email</dt><dd>${esc(data.profile.email)}</dd>
  <dt>Storage</dt><dd>${esc(data.storage?.full_name || data.storage?.name || '—')}</dd>
  <dt>Saved scans</dt><dd>${data.scanCount}</dd>
</dl>
${scans || '<p class="muted">No saved scans.</p>'}
</body></html>`
}

/** Opens the browser print dialog (Save as PDF) on a hidden iframe — no popup to get blocked. */
export function printAsPdf(data) {
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;'
  document.body.appendChild(iframe)
  const doc = iframe.contentDocument
  doc.open()
  doc.write(toPrintableHtml(data))
  doc.close()
  const win = iframe.contentWindow
  win.addEventListener('afterprint', () => iframe.remove())
  win.focus()
  win.print()
}
