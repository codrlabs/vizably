const test = require('node:test');
const assert = require('node:assert/strict');

const { validate } = require('../services/ssrfGuard');

test('accepts a normal https URL', () => {
  const r = validate('https://example.com');
  assert.equal(r.ok, true);
});

test('rejects a missing url', () => {
  assert.equal(validate('').ok, false);
  assert.equal(validate(undefined).ok, false);
});

test('rejects unparseable strings', () => {
  assert.equal(validate('not a url').ok, false);
});

test('rejects file:// and data: schemes', () => {
  assert.equal(validate('file:///etc/passwd').ok, false);
  assert.equal(validate('data:text/html,<h1>x</h1>').ok, false);
  assert.equal(validate('javascript:alert(1)').ok, false);
});

test('rejects loopback and private hosts', () => {
  assert.equal(validate('http://localhost').ok, false);
  assert.equal(validate('http://127.0.0.1').ok, false);
  assert.equal(validate('http://10.0.0.1').ok, false);
  assert.equal(validate('http://192.168.1.1').ok, false);
  assert.equal(validate('http://172.16.0.1').ok, false);
  assert.equal(validate('http://169.254.169.254').ok, false);
});

test('rejects IPv6 loopback, ULA, and link-local hosts', () => {
  assert.equal(validate('http://[::1]/').ok, false);
  assert.equal(validate('http://[fc00::1]/').ok, false);
  assert.equal(validate('http://[fd12:3456:789a::1]/').ok, false);
  assert.equal(validate('http://[fe80::1]/').ok, false);
});
