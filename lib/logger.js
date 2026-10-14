const crypto = require('crypto');

// Log line format, shared with GFM New Cloaked (campaign/lib/logger.js & store/lib/logger.js):
//   TIME      MKT DONOR     STEP          WHAT HAPPENED                                  FLAGS
//   11:13:58  US  v-23f7d3  ✅ DONATED    $26.74 ($25 + $1.74 fee) · Generous S. · 18s   ⚠ Meta ✗
// The donor id (v-xxxxxx) identifies the whole journey across PageView -> Form -> Card -> Donated.
// Tracking status is only printed when it failed. Routine steps are counted into an hourly summary.

const EVENT_CONFIG = {
  PageView: { icon: '👀', step: 'visit' },
  ViewContent: { icon: '👀', step: 'visit' },
  Lead: { icon: '✍️', step: 'signed' },
  AddToCart: { icon: '🛒', step: 'form' },
  InitiateCheckout: { icon: '➜', step: 'checkout' },
  AddPaymentInfo: { icon: '💳', step: 'card' },
  Donate: { icon: '✅', step: 'DONATED', hidden: true },
  Purchase: { icon: '✅', step: 'DONATED', hidden: true },
  Subscribe: { icon: '💚', step: 'RECURRING' },
};

const PAYMENT_EVENT_CONFIG = {
  card_error: { icon: '❌', step: 'card', msg: 'card payment error' },
  card_validation: { icon: '⚠️', step: 'card', msg: 'card details rejected' },
  card_3ds_cancel: { icon: '🔐', step: 'card', msg: '3-D Secure cancelled' },
  modal_close: { icon: '🚪', step: 'form', msg: 'closed the donation form without paying' },
  checkout_abandon: { icon: '🏃', step: 'form', msg: 'left during checkout' },
  session_timeout: { icon: '⏱️', step: 'form', msg: 'session timed out' },
  redirect_initiated: { icon: '➜', step: 'checkout', msg: '' },
  cadence_selected: { icon: '🔁', step: 'cadence', msg: '' },
  duplicate_warned: { icon: '✋', step: 'form', msg: 'already donated — shown "donate again?" check' },
  subscribed: { icon: '💚', step: 'RECURRING', msg: '✓' },
  rebill_charged: { icon: '🔁', step: 'RENEWAL', msg: 'MIT vault rebill ✓' },
};

const recentLogLines = [];

function getTimestamp() {
  return new Date().toLocaleTimeString('en-GB', {
    hour12: false,
    timeZone: 'Europe/Athens',
  });
}

function generateVisitorId(ip) {
  const hash = crypto
    .createHash('md5')
    .update(String(ip || 'unknown'))
    .digest('hex');
  return `v-${hash.substring(0, 6)}`;
}

function isLocalIP(ip) {
  if (!ip) return true;
  return (
    ip === '::1' ||
    ip === '127.0.0.1' ||
    ip.startsWith('192.168.') ||
    ip.startsWith('10.') ||
    ip === 'unknown'
  );
}

// "Anna Grimaldi" -> "Anna G."
function shortName(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length || /^(anonymous|unknown|=|-|—)$/i.test(parts[0])) return '';
  return parts.length > 1
    ? `${parts[0]} ${parts[parts.length - 1][0]}.`
    : parts[0];
}

function duration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = Math.round(ms / 1000);
  return s < 60
    ? `${s}s`
    : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

// Only failures are shown: "⚠ Meta ✗" / "⚠ Meta SKIP(no-eid)".
function trackingFlags(status) {
  if (!status) return '';
  const bad = [];
  if (status.meta && status.meta !== '✓' && status.meta !== '-')
    bad.push(`Meta ${status.meta}`);
  if (status.tiktok && status.tiktok !== '✓' && status.tiktok !== '-')
    bad.push(`TikTok ${status.tiktok}`);
  return bad.length ? `⚠ ${bad.join(', ')}` : '';
}

function sourceOf(url) {
  try {
    const u = new URL(url);
    const src = (u.searchParams.get('utm_source') || '').toLowerCase();
    if (src === 'ig' || src.includes('insta')) return 'Instagram ad';
    if (
      u.searchParams.get('fbclid') ||
      src === 'fb' ||
      src.includes('facebook')
    )
      return 'Facebook ad';
    if (src) return src;
  } catch (_) {}
  return 'direct';
}

function createJourneyLog(fmtCurrency, { market = 'US' } = {}) {
  const MKT = String(market).toUpperCase().slice(0, 3).padEnd(3);
  const seenVisitors = new Set();
  const newCounters = () => ({
    visits: 0,
    returning: 0,
    forms: 0,
    checkouts: 0,
    cards: 0,
    donated: 0,
    total: 0,
    monthly: 0,
    rebills: 0,
    declined: 0,
    tracked: 0,
    trackFail: 0,
    jsErrors: 0,
    jsNew: 0,
    scanner: 0,
    exits: {},
    declineKinds: {},
    devices: {},
  });
  const seenClientErrors = new Map();
  let hour = new Date().getHours();
  let c = newCounters();

  function recordLine(entry) {
    recentLogLines.unshift(entry);
    if (recentLogLines.length > 150) recentLogLines.pop();
  }

  function line(visitorId, icon, step, message, flags, meta = {}) {
    const ts = getTimestamp();
    const f = flags ? `   ${flags}` : '';
    const formatted = `${ts}  ${MKT} ${String(visitorId || '--').padEnd(
      9
    )} ${icon} ${String(step).padEnd(10)} ${message}${f}`;
    console.log(formatted);
    recordLine({
      ts,
      market: MKT.trim(),
      visitorId: visitorId || '--',
      icon,
      step,
      message,
      flags: flags || '',
      raw: formatted,
      ip: meta.ip || null,
      location: meta.location || null,
      device: meta.device || null,
    });
  }

  function countTracking(status) {
    if (!status) return;
    c.tracked += 1;
    if (trackingFlags(status)) c.trackFail += 1;
  }

  function flushHour(force) {
    const now = new Date();
    if (!force && now.getHours() === hour) return;
    const label = new Date(
      now.getTime() - (force ? 0 : 60_000)
    ).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      timeZone: 'Europe/Athens',
    });
    if (
      c.visits ||
      c.forms ||
      c.donated ||
      c.monthly ||
      c.rebills ||
      c.declined ||
      c.jsErrors
    ) {
      const metaOk = c.tracked
        ? Math.round((100 * (c.tracked - c.trackFail)) / c.tracked)
        : 100;
      const summaryLine = `── ${label}:00 last hour · ${MKT.trim()} ${
        c.visits
      } visits (${c.returning} returning) · ${c.forms} forms · ${
        c.checkouts
      } checkouts · ${c.donated} donated ${fmtCurrency(
        Math.round(c.total * 100) / 100
      )} · ${c.monthly} recurring · ${c.rebills} rebills · ${
        c.declined
      } declined | tracking ok ${metaOk}%`;
      console.log(summaryLine);
      recordLine({
        ts: getTimestamp(),
        market: MKT.trim(),
        visitorId: 'SUMMARY',
        icon: '📊',
        step: 'hourly',
        message: summaryLine,
        flags: '',
        raw: summaryLine,
      });
    }
    hour = now.getHours();
    c = newCounters();
  }
  setInterval(() => flushHour(false), 30_000).unref();

  return {
    market: MKT.trim(),

    formatLocation(visitor) {
      if (!visitor) return '';
      if (visitor.city && !['Unknown', 'Local'].includes(visitor.city)) {
        const city =
          visitor.city.length > 22
            ? visitor.city.slice(0, 21) + '…'
            : visitor.city;
        return visitor.country && visitor.country !== '??'
          ? `${city}, ${visitor.country}`
          : city;
      }
      if (visitor.city === 'Local') return 'Local (DEV)';
      return visitor.country && visitor.country !== '??' ? visitor.country : '';
    },

    event(visitor, eventName, message, capiStatus) {
      const cfg = EVENT_CONFIG[eventName] || { icon: 'ℹ️', step: eventName };
      countTracking(capiStatus);
      if (eventName === 'AddToCart') c.forms += 1;
      if (eventName === 'InitiateCheckout') c.checkouts += 1;
      if (eventName === 'AddPaymentInfo') c.cards += 1;
      const flags = trackingFlags(capiStatus);
      if (cfg.hidden && !flags) return;
      const text =
        {
          AddToCart: 'opened card donation drawer',
          AddPaymentInfo: 'typing card details in hosted fields',
          Lead: 'signed the petition',
        }[eventName] || message;
      line(visitor?.id || '--', cfg.icon, cfg.step, text, flags, {
        ip: visitor?.ip,
        location: this.formatLocation(visitor),
        device: visitor?.device,
      });
    },

    // First visit: "landed from Facebook ad · Verona"; later visits: "↺ back on the campaign page".
    newVisitor(visitor, sourceUrl, capiStatus) {
      countTracking(capiStatus);
      const flags = trackingFlags(capiStatus);
      const loc = this.formatLocation(visitor);
      const dev = visitor?.device ? ` · ${visitor.device}` : '';
      if (seenVisitors.has(visitor.id)) {
        c.returning += 1;
        line(
          visitor.id,
          '↺',
          'back',
          `back on the donation page${loc ? ' · ' + loc : ''}${dev}`,
          flags,
          { ip: visitor.ip, location: loc, device: visitor.device }
        );
        return;
      }
      seenVisitors.add(visitor.id);
      if (seenVisitors.size > 5000) seenVisitors.clear();
      c.visits += 1;
      line(
        visitor.id,
        '👀',
        'visit',
        `landed from ${sourceOf(sourceUrl)}${loc ? ' · ' + loc : ''}${dev}`,
        flags,
        { ip: visitor.ip, location: loc, device: visitor.device }
      );
    },

    // info: { amount, tip, total, brand, last4, name, frequency, vaultId }
    purchase(visitor, info, capiStatus) {
      countTracking(capiStatus);
      const donation = Number(info.amount) || 0;
      const tip = Number(info.tip) || 0;
      const total = Number(info.total) || donation + tip;
      c.donated += 1;
      c.total += total;
      if (info.frequency === 'WEEK' || info.frequency === 'MONTH') {
        c.monthly += 1;
      }
      const parts = [
        tip > 0
          ? `${fmtCurrency(total)} (${fmtCurrency(donation)} + ${fmtCurrency(
              tip
            )} fee)`
          : fmtCurrency(total),
      ];
      if (info.frequency && info.frequency !== 'ONE_TIME') {
        parts.push(info.frequency === 'WEEK' ? 'Weekly' : 'Monthly');
      }
      if (info.brand) {
        parts.push(
          `${info.brand}${info.last4 ? ' ••' + info.last4 : ''}`
        );
      }
      const who = shortName(info.name);
      if (who) parts.push(who);
      if (visitor?.firstSeen)
        parts.push(`${duration(Date.now() - visitor.firstSeen)} from landing`);
      if (info.vaultId) parts.push(`vault:${info.vaultId}`);
      line(
        visitor?.id || '--',
        '✅',
        'DONATED',
        parts.join(' · '),
        trackingFlags(capiStatus),
        {
          ip: visitor?.ip,
          location: this.formatLocation(visitor),
          device: visitor?.device,
        }
      );
    },

    paymentEvent(visitor, eventType, details, capiStatus) {
      const cfg = PAYMENT_EVENT_CONFIG[eventType] || {
        icon: 'ℹ️',
        step: eventType,
        msg: '',
      };
      if (eventType === 'subscribed') c.monthly += 1;
      if (eventType === 'rebill_charged') c.rebills += 1;
      if (eventType === 'card_error' || eventType === 'card_validation')
        c.declined += 1;
      if (cfg.hidden) return;
      const text = [cfg.msg, details].filter(Boolean).join(' · ');
      line(
        visitor?.id || '--',
        cfg.icon,
        cfg.step,
        text,
        trackingFlags(capiStatus),
        {
          ip: visitor?.ip,
          location: this.formatLocation(visitor),
          device: visitor?.device,
        }
      );
    },

    decline(visitor, message, kindKey) {
      c.declined += 1;
      if (kindKey) c.declineKinds[kindKey] = (c.declineKinds[kindKey] || 0) + 1;
      line(visitor?.id || '--', '❌', 'DECLINED', message, '', {
        ip: visitor?.ip,
        location: this.formatLocation(visitor),
        device: visitor?.device,
      });
    },

    scannerHit() {
      c.scanner += 1;
    },

    checkoutExit(stage) {
      c.exits[stage] = (c.exits[stage] || 0) + 1;
    },

    attempt(device, result, ms) {
      const key = device || 'desktop';
      const d =
        c.devices[key] ||
        (c.devices[key] = { n: 0, paid: 0, slow: 0, slowPaid: 0, pending: 0 });
      if (result === 'pending') {
        d.pending += 1;
        return;
      }
      d.n += 1;
      if (result === 'paid') d.paid += 1;
      if (ms > 20000) {
        d.slow += 1;
        if (result === 'paid') d.slowPaid += 1;
      }
    },

    system(emoji, message) {
      line('--', emoji, 'system', message, '');
    },

    clientError(visitorId, signature, text) {
      c.jsErrors += 1;
      if (seenClientErrors.has(signature)) {
        seenClientErrors.set(signature, seenClientErrors.get(signature) + 1);
        return;
      }
      if (seenClientErrors.size > 500) seenClientErrors.clear();
      seenClientErrors.set(signature, 1);
      c.jsNew += 1;
      line(visitorId, '🐞', 'browser', text, '');
    },

    flushHour,

    getRecentLogs() {
      return recentLogLines;
    },

    getCounters() {
      return c;
    },

    startup(port, campaign, currency, language, trackingStatus) {
      const w = 79;
      const brand = String(campaign || 'HELP MY BABY')
        .toUpperCase()
        .replace(/-/g, ' ');
      const bannerCore = `           📋 \x1b[1m${brand}\x1b[0m - PayPal Donate Server`;
      const visibleLen = brand.length + 33;
      const bannerPad = ' '.repeat(Math.max(0, w - visibleLen));
      console.log('');
      console.log(`\x1b[36m╔${'═'.repeat(w)}╗\x1b[0m`);
      console.log(`\x1b[36m║\x1b[0m${bannerCore}${bannerPad}\x1b[36m║\x1b[0m`);
      console.log(`\x1b[36m╠${'═'.repeat(w)}╣\x1b[0m`);
      console.log(
        `\x1b[36m║\x1b[0m  🌐 Server:   http://localhost:${String(port).padEnd(
          45
        )}\x1b[36m║\x1b[0m`
      );
      console.log(
        `\x1b[36m║\x1b[0m  📋 Campaign: ${String(campaign).padEnd(
          52
        )}\x1b[36m║\x1b[0m`
      );
      console.log(
        `\x1b[36m║\x1b[0m  🌍 Market:   ${`${MKT.trim()} · ${language}`.padEnd(
          52
        )}\x1b[36m║\x1b[0m`
      );
      console.log(
        `\x1b[36m║\x1b[0m  💳 Payment:  ${'PayPal Orders v2 + Vault v3 (CardFields)'.padEnd(
          52
        )}\x1b[36m║\x1b[0m`
      );
      console.log(
        `\x1b[36m║\x1b[0m  💰 Currency: ${String(currency).padEnd(
          52
        )}\x1b[36m║\x1b[0m`
      );
      console.log(
        `\x1b[36m║\x1b[0m  📊 Tracking: ${String(trackingStatus).padEnd(
          52
        )}\x1b[36m║\x1b[0m`
      );
      console.log(`\x1b[36m╠${'═'.repeat(w)}╣\x1b[0m`);
      console.log(
        `\x1b[36m║\x1b[0m  \x1b[2mLog: TIME  MKT DONOR  STEP  WHAT HAPPENED  (⚠ = tracking/ops problem)\x1b[0m        \x1b[36m║\x1b[0m`
      );
      console.log(`\x1b[36m╚${'═'.repeat(w)}╝\x1b[0m`);
      console.log('');
    },
  };
}

module.exports = {
  EVENT_CONFIG,
  PAYMENT_EVENT_CONFIG,
  createJourneyLog,
  getTimestamp,
  generateVisitorId,
  isLocalIP,
  shortName,
  duration,
  trackingFlags,
  sourceOf,
};
