/**
 * "Download my data" — gather the signed-in user's account + every saved
 * report from their store, and download it as a JSON or PDF file.
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

/**
 * Build the export as a real PDF file and download it. jsPDF is loaded on
 * demand so it stays out of the main bundle.
 * ponytail: jsPDF's built-in fonts are Latin-1 only — non-Latin scan text may
 * render as garbage; embed a Unicode TTF via addFont if that shows up.
 */
export async function downloadPdf(data) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const margin = 48
  const width = doc.internal.pageSize.getWidth() - margin * 2
  const bottom = doc.internal.pageSize.getHeight() - margin
  let y = margin

  const write = (text, { size = 10, bold = false, muted = false, indent = 0, gap = 4 } = {}) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    doc.setTextColor(muted ? 110 : 20)
    const lineHeight = size * 1.35
    for (const line of doc.splitTextToSize(String(text ?? ''), width - indent)) {
      if (y + lineHeight > bottom) { doc.addPage(); y = margin }
      doc.text(line, margin + indent, y + size)
      y += lineHeight
    }
    y += gap
  }

  write('Vizably - my data', { size: 20, bold: true })
  write(`Exported ${new Date(data.exportedAt).toLocaleString()}`, { muted: true, gap: 12 })
  write(`Name: ${data.profile.name}`)
  write(`Email: ${data.profile.email}`)
  write(`Storage: ${data.storage?.full_name || data.storage?.name || '-'}`)
  write(`Saved scans: ${data.scanCount}`, { gap: 16 })
  if (!data.scans.length) write('No saved scans.', { muted: true })

  for (const s of data.scans) {
    y += 8
    write(s.url || s.host || s.id, { size: 13, bold: true, gap: 2 })
    if (s.error) { write(`Could not load: ${s.error}`, { muted: true }); continue }
    write(`Scanned ${s.scannedAt ? new Date(s.scannedAt).toLocaleString() : 'unknown'}`, { muted: true, gap: 8 })
    for (const [key, list] of Object.entries(s.result?.problems ?? {})) {
      write(`${CATEGORY_LABELS[key] || key} (${list?.length ?? 0})`, { size: 11, bold: true, gap: 2 })
      if (!list?.length) write('No problems found.', { muted: true, indent: 12 })
      for (const p of list ?? []) {
        write(`- ${p.name}${p.impact ? ` (${p.impact})` : ''}`, { indent: 12, gap: 0 })
        if (p.rootCause) write(p.rootCause, { muted: true, indent: 22 })
      }
      y += 4
    }
    if (s.result?.whatsGood?.length) {
      write("What's good", { size: 11, bold: true, gap: 2 })
      for (const g of s.result.whatsGood) write(`- ${g}`, { indent: 12, gap: 0 })
    }
  }

  doc.save(`vizably-data-${fileStamp(data)}.pdf`)
}
