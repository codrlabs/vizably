/**
 * Rate limiting for POST /api/scan. Every scan launches a headless Chromium,
 * so request volume is a cost and abuse surface, not just a fairness concern.
 *
 * Anonymous requests are limited per IP (IPv6 grouped by subnet, so rotating
 * addresses within one allocation doesn't reset the count). Signed-in requests
 * are limited per user instead — people sharing an office or campus IP each
 * get their own budget.
 *
 * ponytail: in-memory store, so on Vercel each warm instance counts on its own
 * and a cold start resets it. Move to a shared store (e.g. Redis/Upstash via
 * express-rate-limit's `store` option) if abuse gets past per-instance limits.
 */
const { rateLimit } = require('express-rate-limit');

const WINDOW_MS = 15 * 60 * 1000;
const ANON_LIMIT = 10;
const USER_LIMIT = 30;

const tooMany = (who) => ({
  error: `Too many scans ${who}. Try again in a few minutes.`,
  code: 'RATE_LIMITED',
});

/**
 * @param {{ windowMs?: number, anonLimit?: number, userLimit?: number }} [options]
 * @returns {import('express').RequestHandler[]}
 */
function makeScanRateLimit({
  windowMs = WINDOW_MS,
  anonLimit = ANON_LIMIT,
  userLimit = USER_LIMIT,
} = {}) {
  const common = { windowMs, standardHeaders: 'draft-8', legacyHeaders: false };

  const perIp = rateLimit({
    ...common,
    limit: anonLimit,
    skip: (req) => Boolean(req.user),
    message: tooMany('from this network'),
  });

  const perUser = rateLimit({
    ...common,
    limit: userLimit,
    skip: (req) => !req.user,
    keyGenerator: (req) => `user:${req.user.id}`,
    message: tooMany('from your account'),
  });

  return [perIp, perUser];
}

module.exports = makeScanRateLimit;
