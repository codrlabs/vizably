/**
 * ScanRunner — Orchestrate the Puppeteer + axe-core scanning lifecycle.
 *
 * Responsibilities:
 *   - validates URL via SSRF guard.
 *   - Launch headless Chromium via Puppeteer
 *   - Navigate to the target URL
 *   - Inject axe-core library into the page context
 *   - Execute axe.run() with WCAG 2.1 AA tags
 *   - Transform raw results via axeTransformer.transform()
 *   - Return the vizably-compatible ScanResult
 *
 * Constructor deps are injectable for unit tests (no real Chromium in CI).
 */

const fs = require('node:fs');

const defaultValidate = require('./ssrfGuard').validate;
const { transform: defaultTransform } = require('./axeTransformer');
const defaultAxe = require('axe-core');

/**
 * Does the full `puppeteer` package have a browser binary it can actually run?
 *
 * `executablePath()` honours PUPPETEER_EXECUTABLE_PATH, so this is true for the
 * Docker image (system Chromium from apk) and for local dev (the download in
 * ~/.cache/puppeteer). It is false on a serverless build, where the download is
 * skipped, and it throws when no browser is configured at all.
 */
function hasLocalBrowser(puppeteer) {
  try {
    return fs.existsSync(puppeteer.executablePath());
  } catch {
    return false;
  }
}

/**
 * Resolve the browser driver at call time rather than module load time.
 *
 * The choice is made from what is actually present, not from a platform flag:
 * Vercel's `VERCEL` variable only exists when "system environment variables"
 * are enabled for the project, so keying off it would fail silently if that
 * box were ever unchecked. Probing for a usable binary instead is true in
 * every environment by construction.
 *
 * @param {object} [injected] browser driver supplied by a caller or a test
 * @returns {Promise<{ puppeteer: object, chromium: object | null }>}
 */
async function resolveBrowser(injected) {
  if (injected) {
    return { puppeteer: injected, chromium: null };
  }

  let local = null;
  try {
    local = require('puppeteer');
  } catch {
    // Not installed at all — a production install that omitted devDependencies.
  }
  if (local && hasLocalBrowser(local)) {
    return { puppeteer: local, chromium: null };
  }

  // Serverless: no downloaded browser, so drive the Brotli-compressed build
  // that @sparticuz/chromium unpacks into /tmp.
  return {
    puppeteer: require('puppeteer-core'),
    chromium: require('@sparticuz/chromium'),
  };
}

class ScanRunner {
  /**
   * @param {object} [deps]
   * @param {object} [deps.puppeteer] browser driver; defaults are resolved lazily
   * @param {{ source: string }} [deps.axe]
   * @param {(raw: object) => object} [deps.transform]
   * @param {(url: string) => { ok: boolean, reason?: string }} [deps.validate]
   */
  constructor(deps = {}) {
    // Left null when not injected so the default is resolved per run — the
    // right driver depends on the environment, not on construction time.
    this.puppeteer = deps.puppeteer ?? null;
    this.axe = deps.axe ?? defaultAxe;
    this.transform = deps.transform ?? defaultTransform;
    this.validate = deps.validate ?? defaultValidate;
  }

  async run(url) {
    const guard = this.validate(url);

    if (!guard.ok) {
      throw new Error(`SSRF validation failed: ${guard.reason}`);
    }

    // In Docker we use the system Chromium installed via apk (see Dockerfile)
    // because Puppeteer's bundled download doesn't run on Alpine/musl.
    // `--no-sandbox` is required when the container runs as root. On Vercel,
    // @sparticuz/chromium supplies both the args and the unpacked binary.
    const { puppeteer, chromium } = await resolveBrowser(this.puppeteer);
    let browser;

    browser = await puppeteer.launch({
      headless: true,
      executablePath:
        process.env.PUPPETEER_EXECUTABLE_PATH ||
        (chromium ? await chromium.executablePath() : undefined),
      args: chromium ? chromium.args : ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    try {
      const page = await browser.newPage();
      // Many sites ship a strict CSP that blocks inline script injection;
      // bypassing CSP for this page lets us inject axe-core reliably.
      await page.setBypassCSP(true);
      // Wait for the DOM to be ready, not for the network to go quiet. Busy
      // sites (Stripe, Facebook) never reach networkidle0, so it would time out.
      // The short, ignored idle wait lets late content settle without hanging.
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {});

      await page.addScriptTag({ content: this.axe.source });
      const axeResults = await page.evaluate(() => {
        return new Promise((resolve) => {
          axe.run((err, results) => {
            if (err) throw err;
            resolve(results);
          });
        });
      });

      return this.transform(axeResults);
    } catch (err) {
      console.error(err);
      return null;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  async getResults(url) {
    return await this.run(url);
  }
}

module.exports = ScanRunner;
