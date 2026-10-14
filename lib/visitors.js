const { generateVisitorId, isLocalIP } = require('./logger');
const { parseUserAgent, deviceLabel } = require('./userAgentParser');

let geoip = null;
if (process.env.ENABLE_GEOIP_LITE === 'true') {
  try {
    geoip = require('geoip-lite');
  } catch (e) {
    console.warn('[geo] geoip-lite unavailable:', e.message);
  }
}

const visitors = new Map();

// Edge header or offline GeoIP lookup on the connection IP.
function lookupLocation(ip, req) {
  if (!ip || ip === 'unknown') return null;
  if (isLocalIP(ip)) {
    return {
      ip,
      city: 'Local',
      region: null,
      country: 'Local Dev',
      countryCode: 'DEV',
    };
  }
  const edgeCountry = (
    req?.headers?.['x-zeabur-ip-country'] ||
    req?.headers?.['cf-ipcountry'] ||
    ''
  )
    .trim()
    .toUpperCase();
  if (edgeCountry && edgeCountry !== 'XX') {
    return {
      ip,
      city: null,
      region: null,
      country: edgeCountry,
      countryCode: edgeCountry,
      ll: null,
      timezone: null,
    };
  }
  if (!geoip) return null;
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
    req.headers['cf-connecting-ip']?.trim() ||
    req.headers['x-real-ip']?.trim() ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.ip ||
    req.connection?.remoteAddress ||
    req.body?.clientLocation?.ip ||
    'unknown';
  ip = String(ip).replace(/^::ffff:/, '');

  const clientLocation = req.body?.clientLocation?.countryCode
    ? req.body.clientLocation
    : lookupLocation(ip, req);

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
