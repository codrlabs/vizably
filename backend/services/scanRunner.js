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
const defaultPuppeteer = require('puppeteer');
const { transform: defaultTransform } = require('./axeTransformer');
const defaultAxe = require('axe-core');

class ScanRunner {
  /**
   * @param {object} [deps]
   * @param {typeof defaultPuppeteer} [deps.puppeteer]
   * @param {{ source: string }} [deps.axe]
   * @param {(raw: object) => object} [deps.transform]
   * @param {(url: string) => { ok: boolean, reason?: string }} [deps.validate]
   */
  constructor(deps = {}) {
    this.puppeteer = deps.puppeteer ?? defaultPuppeteer;
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
    // `--no-sandbox` is required when the container runs as root.
    let browser;

    browser = await this.puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    // Many sites ship a strict CSP that blocks inline script injection;
    // bypassing CSP for this page lets us inject axe-core reliably.
    await page.setBypassCSP(true);
    await page.goto(url, { waitUntil: 'networkidle0' });

    try {
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
