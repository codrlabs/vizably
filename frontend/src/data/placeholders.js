/**
 * Provider display metadata for Connect / Account / Dashboard copy.
 * Repo lists come from `GET /api/auth/storages` — not hard-coded here.
 */
export const PLACEHOLDER_USER = { name: 'Samuel', email: 'Samuel@vizably.org' }

export const PROVIDERS = {
  github: {
    name: 'GitHub',
    store: 'a private GitHub repo',
    storeShort: 'GitHub repo',
    dest: 'vizably-scans',
    destIcon: 'GitBranch',
    unit: 'repository',
    unitShort: 'repo',
    article: 'a',
    scope: 'GitHub App (selected repos + Administration for create)',
    scopeNote:
      'Contents on installed repos; Administration lets Vizably create an empty private repo for you',
  },
  google: {
    name: 'Google',
    store: 'your Google Drive',
    storeShort: 'Google Drive',
    dest: 'Vizably',
    destIcon: 'HardDrive',
    unit: 'folder',
    unitShort: 'folder',
    article: 'a',
    scope: 'drive.file',
    scopeNote: 'Access only the folder you pick in Google Picker',
  },
}

/** Saved scans placeholder for the signed-in dashboard (Phase 2 follow-up). */
export const PLACEHOLDER_SAVED_SCANS = [
  { url: 'codrlabs.com', score: 72, issues: 7, when: '2 days ago', top: 'critical' },
  { url: 'stripe.com', score: 96, issues: 1, when: 'Today', top: 'minor' },
  { url: 'wikipedia.org', score: 88, issues: 3, when: '5 days ago', top: 'moderate' },
  { url: 'my-portfolio.dev', score: 64, issues: 11, when: '1 week ago', top: 'serious' },
  { url: 'acme-store.com', score: 41, issues: 23, when: '2 weeks ago', top: 'critical' },
]
