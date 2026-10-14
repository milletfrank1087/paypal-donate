// Payment forensics (ported from GFM New Cloaked store/lib/payment-forensics.js & routes/paypal.js)
//  - rememberAttempt(): per-Order context captured at creation (visitor, market, device, country, attempt #)
//  - describePayPalDecline(): maps PayPal processor_response codes & card network codes to human explanations
//  - failureLine(): one readable log line combining card brand/last4, processor code, attempt #, device, and geo
//  - recordOutcome(): rolling authorization-rate monitor with early-warning alert

const { deviceLabel } = require('./userAgentParser');

const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ENTRIES = 3000;
const attempts = new Map(); // orderId -> context
const sessionAttempts = new Map(); // visitorId -> [timestamps of orders created]

function prune(now) {
  if (attempts.size <= MAX_ENTRIES) return;
  for (const [k, v] of attempts) if (now - v.t > TTL_MS) attempts.delete(k);
  if (attempts.size > MAX_ENTRIES) attempts.delete(attempts.keys().next().value);
}

// Called right after a PayPal Order is created. Returns this visitor's attempt number (1 = first try).
function rememberAttempt(orderId, info = {}) {
  const now = Date.now();
  const sid = info.vid || info.ip || 'anon';
  const list = (sessionAttempts.get(sid) || []).filter(
    (ts) => now - ts < 30 * 60 * 1000
  );
  list.push(now);
  if (sid) sessionAttempts.set(sid, list);
  if (sessionAttempts.size > MAX_ENTRIES)
    sessionAttempts.delete(sessionAttempts.keys().next().value);
  const attempt = list.length;
  attempts.set(orderId, {
    t: now,
    attempt,
    sinceFirstSecs: Math.round((now - list[0]) / 1000),
    vid: info.vid || null,
    mkt: info.mkt || null,
    device: deviceLabel(info.ua),
    ua: info.ua ? String(info.ua).slice(0, 400) : null,
    ip: info.ip || null,
    geo: info.geo || null,
    currency: info.currency || 'USD',
    amount: info.amount || null,
    frequency: info.frequency || 'ONE_TIME',
  });
  prune(now);
  return attempt;
}

function attemptContext(orderId) {
  return attempts.get(orderId) || null;
}

// Key raw bank response codes as they appear on PayPal & card networks
const PAYPAL_DECLINE_CODES = {
  '0000': 'Approved',
  '0500': 'Do not honor - contact bank',
  '5100': 'Generic decline',
  '5120': 'Insufficient funds',
  '5130': 'Suspected fraud',
  '5140': 'Invalid card',
  '5150': 'Expired card',
  '5160': 'Invalid CVV',
  '5170': 'Exceeds withdrawal limit',
  '5180': 'Invalid or restricted card',
  '5400': 'Expired card',
  '5700': 'Transaction not permitted to cardholder',
  '5950': 'Card declined by issuer',
  '9100': 'Issuer unavailable',
  '9600': 'System error',
  PPMD: 'PayPal risk decline',
  PPCE: 'Card expired or invalid',
  PPFV: 'Field validation failed',
  PPII: 'Invalid input / card number',
};

const NETWORK_CODES = {
  mastercard: {
    '01': 'refer to issuer',
    '03': 'invalid merchant',
    '05': 'do not honor',
    '12': 'invalid transaction',
    '14': 'invalid card number',
    '51': 'insufficient funds',
    '54': 'expired',
    '57': 'txn not permitted to cardholder',
    '58': 'txn not permitted to merchant',
    '61': 'exceeds amount limit',
    '62': 'restricted card',
    '63': 'security violation',
    '65': 'count limit / 3DS soft decline',
    '82': 'policy decline by issuer',
    '83': 'suspected fraud',
    '91': 'issuer unavailable',
    '96': 'system error',
  },
  visa: {
    '05': 'do not honor',
    '14': 'invalid card number',
    '51': 'insufficient funds',
    '54': 'expired',
    '57': 'txn not permitted to cardholder',
    '59': 'suspected fraud',
    '61': 'exceeds amount limit',
    '62': 'restricted card',
    '65': 'count limit',
    '91': 'issuer unavailable',
    '96': 'system error',
    '1A': '3DS required',
    N7: 'CVV2 failed',
  },
};

function describeNetworkCode(brand, code) {
  if (!code) return '';
  const codeUp = String(code).toUpperCase();
  if (PAYPAL_DECLINE_CODES[codeUp]) {
    return `${codeUp} (${PAYPAL_DECLINE_CODES[codeUp]})`;
  }
  const label = (NETWORK_CODES[String(brand || '').toLowerCase()] || {})[codeUp];
  return label ? `${codeUp} (${label})` : String(code);
}

// "US VISA CREDIT ••1111 · bank 5120 (Insufficient funds) · try #2 (+18s) · desktop · geo Local"
function failureLine(orderId, details = {}, a = null) {
  const ctx = a || attemptContext(orderId);
  const brand = details.brand || 'CARD';
  const parts = [];
  const who = [ctx?.geo || '', brand, details.cardType || '']
    .filter(Boolean)
    .join(' ');
  parts.push(who + (details.last4 ? ` ••${details.last4}` : ''));
  if (details.code) {
    parts.push(`bank ${describeNetworkCode(brand, details.code)}`);
  }
  if (details.issue) {
    parts.push(details.issue);
  }
  if (ctx) {
    parts.push(
      `try #${ctx.attempt}${
        ctx.attempt > 1 ? ` (+${ctx.sinceFirstSecs}s)` : ''
      }`
    );
    parts.push(ctx.device + (ctx.geo ? ` · geo ${ctx.geo}` : ''));
  }
  return parts.filter(Boolean).join(' · ');
}

// Rolling authorization-rate monitor: warns when most recent card outcomes are failures.
const WINDOW_MS = 45 * 60 * 1000;
const MIN_SAMPLES = 10;
const ALERT_BELOW = 0.5;
let outcomes = []; // { t, ok, country, code }

function recordOutcome(ok, meta = {}, emitAlert) {
  const now = Date.now();
  outcomes.push({
    t: now,
    ok: !!ok,
    country: meta.country || '',
    code: meta.code || '',
  });
  outcomes = outcomes.filter((o) => now - o.t < WINDOW_MS).slice(-200);
  if (ok || !emitAlert || outcomes.length < MIN_SAMPLES) return;
  const rate = outcomes.filter((o) => o.ok).length / outcomes.length;
  if (rate >= ALERT_BELOW) return;
  const tally = {};
  outcomes
    .filter((o) => !o.ok)
    .forEach((o) => {
      const k = `${o.country || '?'}:${o.code || '?'}`;
      tally[k] = (tally[k] || 0) + 1;
    });
  const top = Object.entries(tally)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 5)
    .map(([k, v]) => `${k}×${v}`)
    .join(' ');
  emitAlert({
    key: 'auth-rate-low',
    severity: 'warning',
    title: `Payment success rate ${Math.round(rate * 100)}% (last ${Math.round(
      WINDOW_MS / 60000
    )} min)`,
    context: {
      samples: outcomes.length,
      ok: outcomes.filter((o) => o.ok).length,
      top_failures: top,
    },
  });
}

function getAuthStats() {
  const now = Date.now();
  const recent = outcomes.filter((o) => now - o.t < WINDOW_MS);
  const okCount = recent.filter((o) => o.ok).length;
  return {
    samples: recent.length,
    approved: okCount,
    declined: recent.length - okCount,
    approvalRatePct: recent.length
      ? Math.round((okCount / recent.length) * 100)
      : 100,
  };
}

module.exports = {
  deviceLabel,
  rememberAttempt,
  attemptContext,
  PAYPAL_DECLINE_CODES,
  NETWORK_CODES,
  describeNetworkCode,
  failureLine,
  recordOutcome,
  getAuthStats,
};
