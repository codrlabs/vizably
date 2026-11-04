/**
 * Log-safe URLs. A scanned reset link or signed URL carries its token in the
 * query string (or fragment), so logs keep the origin and path only. Pure — no
 * side effects.
 */

/**
 * Origin + path of a URL, with query, fragment and any `user:pass@` dropped.
 * @param {unknown} url
 * @returns {string}
 */
function safeUrl(url) {
  try {
    const parsed = new URL(String(url));
    return parsed.origin + parsed.pathname;
  } catch {
    // Unparseable input still gets its query/fragment cut.
    return String(url ?? '').split(/[?#]/)[0];
  }
}

/**
 * Apply `safeUrl` to every http(s) URL inside free text, e.g. a Puppeteer error
 * like `net::ERR_NAME_NOT_RESOLVED at https://x/?token=…`.
 * @param {unknown} text
 * @returns {string}
 */
function scrubUrls(text) {
  return String(text ?? '').replace(/https?:\/\/\S+/gi, (match) => safeUrl(match));
}

module.exports = { safeUrl, scrubUrls };
