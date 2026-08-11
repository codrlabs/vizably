import { Card } from '../design-system'
import { Ico } from '../lib/icons'

/**
 * Legal — Privacy Policy & Terms of Service. `doc` = 'privacy' | 'terms'.
 * Plain-language template content with a clear "not legal advice" banner.
 */
export default function LegalView({ doc = 'privacy', onNav }) {
  const privacy = {
    title: 'Privacy Policy',
    updated: 'Last updated 9 June 2026',
    intro: 'Vizably is built to make the web more inclusive — we’re not in the business of collecting more about you than we need to do that. Here’s exactly what we keep, and what you control.',
    sections: [
      { h: 'What we collect', list: [
        'When you sign in with GitHub or Google: your name and email, used only to identify you.',
        'URLs you scan and basic, privacy-respecting usage counts (e.g. number of scans) to keep the service healthy.',
      ] },
      { h: 'Where your scans live', p: 'Saved reports are written to your own storage — a private GitHub repo or your Google Drive — not to our servers. We don’t keep a copy. That means your scan history is yours to control, and there’s nothing on our side to leak or sell.' },
      { h: 'What we don’t do', list: [
        'We don’t sell or rent your data — ever.',
        'We don’t run advertising trackers or third-party ad pixels.',
        'We don’t store scans from signed-out visitors beyond the time it takes to show your results.',
      ] },
      { h: 'How long we keep it', p: 'Because saved reports live in your storage, you control retention: remove individual scans, clear them all, or turn on auto-delete for anything older than 90 days. Deleting your Vizably account removes the scans Vizably saved there (and can optionally delete the connected repository), then revokes our session access.' },
      { h: 'Your controls', p: 'You can view, export, or delete your data at any time from Account → Settings. Deleting is immediate and permanent.' },
      { h: 'Contact', p: 'Questions about privacy? Open an issue on our GitHub repository and we’ll respond in the open.' },
    ],
  }

  const terms = {
    title: 'Terms of Service',
    updated: 'Last updated 9 June 2026',
    intro: 'Vizably is free and open source. These terms keep it usable and safe for everyone — please read them.',
    sections: [
      { h: 'The service', p: 'Vizably analyses a URL and reports likely accessibility issues mapped to WCAG. Results are guidance to help you improve a site — they are not a certification or a legal guarantee of compliance.' },
      { h: 'Provided “as is”', p: 'The service is provided free of charge, without warranty of any kind. We work hard to be accurate, but we can’t promise every issue is caught or every suggestion fits your context.' },
      { h: 'Acceptable use', list: [
        'Only scan sites you own or have permission to test.',
        'Don’t use Vizably to overload, attack, or disrupt any website.',
        'Don’t abuse the service in ways that degrade it for others.',
      ] },
      { h: 'Accounts', p: 'You’re responsible for keeping your login secure and for activity under your account. Tell us promptly if you suspect unauthorised access.' },
      { h: 'Donations', p: 'Donations are voluntary and non-refundable, and are reinvested in full into developing and improving the project — tooling and maintenance, not storage, since your saved scans live in your own Google Drive or GitHub.' },
      { h: 'Licence & changes', p: 'Vizably is released under the MPL-2.0 licence. We may update these terms as the project evolves; material changes will be noted here with a new date.' },
    ],
  }

  const data = doc === 'terms' ? terms : privacy

  const Tab = ({ id, children }) => (
    <button onClick={() => onNav(id)} style={{
      padding: '8px 16px', borderRadius: 'var(--radius-pill)', border: 'none', cursor: 'pointer',
      font: 'var(--font-label)',
      background: doc === id ? 'var(--accent)' : 'transparent',
      color: doc === id ? '#fff' : 'var(--text-body)',
    }}>{children}</button>
  )

  return (
    <div style={{ width: '100%', maxWidth: 720, margin: '0 auto', padding: '40px 24px 64px' }}>
      <div style={{ display: 'flex', gap: 6, padding: 4, background: 'var(--bg-inset)', borderRadius: 'var(--radius-pill)', width: 'fit-content', margin: '0 auto 28px' }}>
        <Tab id="privacy">Privacy</Tab>
        <Tab id="terms">Terms</Tab>
      </div>

      <h1 style={{ fontSize: 'var(--text-2xl)', letterSpacing: '-0.02em', margin: '0 0 6px', textAlign: 'center' }}>{data.title}</h1>
      <p style={{ textAlign: 'center', fontSize: 'var(--text-sm)', color: 'var(--text-muted)', margin: '0 0 24px' }}>{data.updated}</p>

      {/* Not-legal-advice disclaimer */}
      <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start', background: 'var(--sev-moderate-bg)', border: '1px solid var(--sev-moderate)', borderRadius: 'var(--radius-md)', padding: '14px 16px', marginBottom: 28 }}>
        <span style={{ color: 'var(--sev-moderate)', marginTop: 1 }}>{Ico('TriangleAlert', 18, 'currentColor')}</span>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--sev-moderate-fg)', margin: 0, lineHeight: 1.55 }}>
          <strong>Template, not legal advice.</strong> This is a plain-language starting point written for clarity — it has not been reviewed by a lawyer. Have a professional adapt it to your jurisdiction before relying on it.
        </p>
      </div>

      <p style={{ font: 'var(--font-body)', fontSize: 'var(--text-md)', color: 'var(--text-body)', lineHeight: 1.7, margin: '0 0 28px', textWrap: 'pretty' }}>{data.intro}</p>

      <Card padding="var(--space-6)">
        {data.sections.map((s, i) => (
          <section key={i} style={{ marginBottom: i === data.sections.length - 1 ? 0 : 24 }}>
            <h2 style={{ fontSize: 'var(--text-base)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', margin: '0 0 10px' }}>{s.h}</h2>
            {s.p && <p style={{ font: 'var(--font-body)', color: 'var(--text-body)', lineHeight: 1.65, margin: 0 }}>{s.p}</p>}
            {s.list && (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 9 }}>
                {s.list.map((li, j) => (
                  <li key={j} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', font: 'var(--font-body)', color: 'var(--text-body)', lineHeight: 1.55 }}>
                    <span style={{ color: 'var(--accent)', marginTop: 2, flexShrink: 0 }}>{Ico('Check', 15, 'currentColor')}</span>
                    <span>{li}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </Card>
    </div>
  )
}
