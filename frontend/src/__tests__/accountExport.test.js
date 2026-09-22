import { describe, it, expect, vi } from 'vitest'
import { buildAccountExport, toPrintableHtml } from '../lib/accountExport'

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

  it('escapes third-party scan content in the printable HTML', async () => {
    const data = await buildAccountExport(USER, async (id) => ({
      id,
      url: 'https://x.test',
      result: { problems: { multimedia: [{ name: '<img src=x onerror=alert(1)>', rootCause: 'r' }] }, whatsGood: ['ok'] },
    }))
    const html = toPrintableHtml(data)
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('Multimedia (1)')
  })
})
