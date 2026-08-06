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

const defaultValidate = require('./ssrfGuard').validate;
const { transform: defaultTransform } = require('./axeTransformer');
const defaultAxe = require('axe-core');

/**
 * Resolve the browser driver at call time rather than module load time.
 *
 * `puppeteer` ships its own Chromium download, which is far too large for a
 * serverless bundle, so on Vercel we use `puppeteer-core` against the
 * Brotli-compressed binary from `@sparticuz/chromium` instead. Requiring
 * lazily keeps the heavy package off the import path where it is not wanted.
 *
 * @param {object} [injected] browser driver supplied by a caller or a test
 * @returns {Promise<{ puppeteer: object, chromium: object | null }>}
 */
async function resolveBrowser(injected) {
  if (injected) {
    return { puppeteer: injected, chromium: null };
  }
  if (process.env.VERCEL) {
    return {
      puppeteer: require('puppeteer-core'),
      chromium: require('@sparticuz/chromium'),
    };
  }
  // Local dev and Docker, where the Dockerfile points PUPPETEER_EXECUTABLE_PATH
  // at the system Chromium installed via apk.
  return { puppeteer: require('puppeteer'), chromium: null };
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
