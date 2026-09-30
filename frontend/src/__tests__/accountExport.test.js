import { describe, it, expect, vi } from 'vitest'
import { buildAccountExport } from '../lib/accountExport'

const USER = {
  displayName: 'Sam',
  email: 'sam@example.com',
  storage: { full_name: 'sam/vizably-scans' },
  account: { settings: { autoDelete90d: true }, scans: [{ id: 'a', url: 'https://a.test' }, { id: 'b', url: 'https://b.test' }] },
}

describe('accountExport', () => {
  it('loads every saved scan and keeps going when one fails', async () => {
    const getSavedScan = vi.fn((id) => (id === 'a'
      ? Promise.resolve({ id, url: 'https://a.test', result: { problems: {}, whatsGood: [] } })
      : Promise.reject(new Error('gone'))))
    const data = await buildAccountExport(USER, getSavedScan)

    expect(data.profile).toMatchObject({ name: 'Sam', email: 'sam@example.com' })
    expect(data.settings).toEqual({ autoDelete90d: true })
    expect(data.scanCount).toBe(2)
    expect(data.scans[0].result).toBeDefined()
    expect(data.scans[1]).toMatchObject({ id: 'b', error: 'gone' })
  })

  it('fetches at most a few scans at a time and keeps index order', async () => {
    const scans = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}` }))
    let inFlight = 0
    let peak = 0
    const getSavedScan = async (id) => {
      peak = Math.max(peak, ++inFlight)
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
      return { id }
    }
    const data = await buildAccountExport({ account: { scans } }, getSavedScan)

    expect(peak).toBeLessThanOrEqual(4)
    expect(data.scans.map((s) => s.id)).toEqual(scans.map((s) => s.id))
  })

  it('downloads a PDF containing the saved report', async () => {
    const save = vi.fn()
    const text = []
    vi.doMock('jspdf', () => ({
      jsPDF: class {
        internal = { pageSize: { getWidth: () => 595, getHeight: () => 842 } }
        setFont() {} setFontSize() {} setTextColor() {} addPage() {}
        splitTextToSize(t) { return [t] }
        text(t) { text.push(t) }
        save = save
      },
    }))
    const { downloadPdf } = await import('../lib/accountExport')
    const data = await buildAccountExport(USER, async (id) => ({
      id,
      url: `https://${id}.test`,
      result: { problems: { multimedia: [{ name: 'Missing captions', impact: 'serious' }] }, whatsGood: ['ok'] },
    }))
    await downloadPdf(data)

    expect(save).toHaveBeenCalledWith(expect.stringMatching(/^vizably-data-\d{4}-\d{2}-\d{2}\.pdf$/))
    expect(text).toContain('https://a.test')
    expect(text).toContain('Multimedia (1)')
    expect(text).toContain('- Missing captions (serious)')
  })
})
