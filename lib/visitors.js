const { generateVisitorId, isLocalIP } = require('./logger');
const { parseUserAgent, deviceLabel } = require('./userAgentParser');

let geoip = null;
try {
  geoip = require('geoip-lite');
} catch (e) {
  console.warn('[geo] geoip-lite unavailable:', e.message);
}

const visitors = new Map();

// Offline GeoIP lookup on the connection IP (ported from GFM New Cloaked).
// Replaces browser-side ipapi.co calls which hit HTTP 429 rate limits.
function lookupLocation(ip) {
  if (!geoip || !ip || ip === 'unknown') return null;
  if (isLocalIP(ip)) {
    return {
      ip,
      city: 'Local',
      region: null,
      country: 'Local Dev',
      countryCode: 'DEV',
    };
  }
  const hit = geoip.lookup(ip);
  if (!hit || !hit.country) return null;
  return {
    ip,
    city: hit.city || null,
    region: hit.region || null,
    country: hit.country || null,
    countryCode: hit.country,
    ll: hit.ll || null,
    timezone: hit.timezone || null,
  };
}

function getClientInfo(req) {
  let ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.ip ||
    req.connection?.remoteAddress ||
    req.body?.clientLocation?.ip ||
    'unknown';
  ip = String(ip).replace(/^::ffff:/, '');

  const clientLocation = req.body?.clientLocation?.countryCode
    ? req.body.clientLocation
    : lookupLocation(ip);

  const userAgent = req.headers['user-agent'] || 'unknown';
  const parsedUA = parseUserAgent(userAgent);
  const device = deviceLabel(userAgent);

  return {
    ipAddress: ip,
    userAgent,
    device,
    parsedUA,
    referer: req.headers.referer || req.headers.referrer || 'direct',
    clientLocation,
  };
}

function getOrCreateVisitor(ip, location, userAgent) {
  const isLocal = isLocalIP(ip);

  if (visitors.has(ip)) {
    const visitor = visitors.get(ip);
    visitor.eventCount++;
    visitor.lastSeen = Date.now();
    if (
      location?.city &&
      location.city !== 'Unknown' &&
      visitor.city === 'Local'
    ) {
      visitor.city = location.city;
      visitor.country =
        location.countryCode || location.country || visitor.country;
    }
    if (userAgent && (!visitor.device || visitor.device === '?')) {
      visitor.device = deviceLabel(userAgent);
    }
    return { visitor, isNew: false };
  }

  const visitor = {
    id: generateVisitorId(ip),
    ip,
    city: isLocal ? 'Local' : location?.city || 'Unknown',
    region: location?.region || null,
    country: isLocal
      ? 'DEV'
      : location?.countryCode || location?.country || '??',
    device: userAgent ? deviceLabel(userAgent) : 'desktop',
    firstSeen: Date.now(),
    lastSeen: Date.now(),
    eventCount: 1,
  };
  visitors.set(ip, visitor);

  if (visitors.size > 1000) {
    const oldest = [...visitors.entries()].sort(
      (a, b) => a[1].firstSeen - b[1].firstSeen
    )[0];
    visitors.delete(oldest[0]);
  }

  return { visitor, isNew: true };
}

module.exports = {
  visitors,
  getOrCreateVisitor,
  lookupLocation,
  getClientInfo,
};
