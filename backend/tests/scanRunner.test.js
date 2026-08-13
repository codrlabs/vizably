/**
 * ScanRunner unit tests — mocked Puppeteer (no Chromium in CI).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ScanRunner = require('../services/scanRunner');

function createMockPuppeteer({ evaluateResult, evaluateError } = {}) {
  const page = {
    setBypassCSP: async () => {},
    goto: async () => {},
    waitForNetworkIdle: async () => {},
    addScriptTag: async () => {},
    evaluate: async () => {
      if (evaluateError) throw evaluateError;
      return evaluateResult ?? { violations: [], passes: [] };
    },
  };
  const browser = {
    newPage: async () => page,
    close: async () => {
      browser.closed = true;
    },
    closed: false,
  };
  return {
    page,
    browser,
    puppeteer: {
      launch: async () => browser,
    },
  };
}

test('run rejects SSRF failures before launching a browser', async () => {
  let launched = false;
  const runner = new ScanRunner({
    validate: () => ({ ok: false, reason: 'Private/loopback hosts are not allowed' }),
    puppeteer: {
      launch: async () => {
        launched = true;
        throw new Error('should not launch');
      },
    },
  });

  await assert.rejects(
    () => runner.run('http://localhost'),
    /SSRF validation failed/,
  );
  assert.equal(launched, false);
});

test('run navigates, injects axe, transforms, and closes the browser', async () => {
  const { puppeteer, browser, page } = createMockPuppeteer({
    evaluateResult: { violations: [{ id: 'contrast' }], passes: [] },
  });
  const calls = [];
  page.setBypassCSP = async () => { calls.push('bypass'); };
  page.goto = async (url, opts) => {
    calls.push(['goto', url, opts.waitUntil]);
  };
  page.addScriptTag = async ({ content }) => {
    calls.push(['script', content]);
  };

  const runner = new ScanRunner({
    puppeteer,
    axe: { source: '/* axe-source */' },
    transform: (raw) => ({
      problems: { visualAccessibility: [{ id: raw.violations[0].id }] },
      whatsGood: [],
    }),
    validate: () => ({ ok: true, url: new URL('https://example.com') }),
  });

  const result = await runner.run('https://example.com');

  assert.deepEqual(result.problems.visualAccessibility, [{ id: 'contrast' }]);
  assert.equal(browser.closed, true);
  assert.ok(calls.includes('bypass'));
  assert.deepEqual(calls.find((c) => Array.isArray(c) && c[0] === 'goto'), [
    'goto',
    'https://example.com',
    'domcontentloaded',
  ]);
  assert.deepEqual(calls.find((c) => Array.isArray(c) && c[0] === 'script'), [
    'script',
    '/* axe-source */',
  ]);
});

test('run returns null and still closes the browser when evaluate fails', async () => {
  const { puppeteer, browser } = createMockPuppeteer({
    evaluateError: new Error('axe blew up'),
  });
  const runner = new ScanRunner({
    puppeteer,
    axe: { source: '/* axe */' },
    transform: () => ({ problems: {}, whatsGood: [] }),
    validate: () => ({ ok: true, url: new URL('https://example.com') }),
  });

  const result = await runner.run('https://example.com');
  assert.equal(result, null);
  assert.equal(browser.closed, true);
});

test('getResults delegates to run', async () => {
  const runner = new ScanRunner({
    validate: () => ({ ok: false, reason: 'bad' }),
  });
  await assert.rejects(() => runner.getResults('http://127.0.0.1'), /SSRF/);
});

test('importing scanRunner does not pull in puppeteer', () => {
  // Vercel traces static requires into the function bundle, and puppeteer
  // carries its own Chromium download. A top-level require here would blow
  // the 250MB limit even though the serverless path never uses it.
  const { execFileSync } = require('node:child_process');
  const script = `
    const path = require('path');
    require('./services/scanRunner');
    const marker = path.sep + 'node_modules' + path.sep + 'puppeteer' + path.sep;
    const loaded = Object.keys(require.cache).some((p) => p.includes(marker));
    console.log(loaded ? 'LOADED' : 'NOT_LOADED');
  `;
  const out = execFileSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
  });

  assert.match(out, /NOT_LOADED/);
});
