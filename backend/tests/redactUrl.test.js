const test = require('node:test');
const assert = require('node:assert/strict');
const { safeUrl, scrubUrls } = require('../services/redactUrl');

test('safeUrl keeps origin + path and drops query, fragment and credentials', () => {
  assert.equal(safeUrl('https://a.test/reset?token=x#y'), 'https://a.test/reset');
  assert.equal(safeUrl('https://me:pw@a.test/p'), 'https://a.test/p');
  assert.equal(safeUrl('https://a.test:8443/'), 'https://a.test:8443/');
  assert.equal(safeUrl('not a url?token=x'), 'not a url');
  assert.equal(safeUrl(undefined), '');
});

test('scrubUrls redacts every URL inside free text', () => {
  assert.equal(
    scrubUrls('failed at https://a.test/x?sig=1 then http://b.test/?t=2'),
    'failed at https://a.test/x then http://b.test/',
  );
  assert.equal(scrubUrls('no urls here'), 'no urls here');
});
