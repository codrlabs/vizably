/**
 * Guards on dependency shape that only fail in production otherwise.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/** @param {string} name */
function readInstalledPackageJson(name) {
  const pkgPath = path.join(__dirname, '..', 'node_modules', ...name.split('/'), 'package.json');
  return JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
}

test('@octokit/rest ships a CommonJS entry', () => {
  // v21+ are ESM-only. Vercel precompiles functions to bytecode, and that path
  // cannot require() an ES module even on Node 24 — where plain `node` can, so
  // an upgrade passes this whole suite locally and then 500s every route in
  // production. Pinned to the last CommonJS release; see backend/README.md.
  const pkg = readInstalledPackageJson('@octokit/rest');
  const hasCommonJsEntry =
    Boolean(pkg.main) || Boolean(pkg.exports?.['.']?.require);

  assert.ok(
    hasCommonJsEntry,
    `@octokit/rest@${pkg.version} is ESM-only, which Vercel cannot require(). ` +
      'Stay on the 20.x line, or convert the Octokit call sites to dynamic ' +
      'import() before upgrading.',
  );
});
