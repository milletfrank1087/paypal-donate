const crypto = require('crypto');
const { sendMetaEvent } = require('./meta');
const { sendTikTokEvent } = require('./tiktok');

const recentCapiEvents = [];

function getConfig() {
  return {
    TRACKING_ENABLED: process.env.TRACKING_ENABLED === 'true',
    FB_PIXEL_ID: process.env.FB_PIXEL_ID,
    FB_ACCESS_TOKEN: process.env.FB_ACCESS_TOKEN,
    TIKTOK_PIXEL_ID: process.env.TIKTOK_PIXEL_ID,
    TIKTOK_ACCESS_TOKEN: process.env.TIKTOK_ACCESS_TOKEN,
  };
}

function hashSHA256(value) {
  if (!value) return null;
  const normalized = String(value).toLowerCase().trim();
  if (!normalized) return null;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function parseName(fullName) {
  if (!fullName) return { firstName: null, lastName: null };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return {
    firstName: parts[0],
    lastName: parts[parts.length - 1],
  };
}

const helpers = { getConfig, hashSHA256 };

const EVENT_MAP = {
  PageView: { meta: 'PageView', tiktok: 'Pageview' },
  ViewContent: { meta: 'ViewContent', tiktok: 'ViewContent' },
  Lead: { meta: 'Lead', tiktok: 'SubmitForm' },
  AddToCart: { meta: 'AddToCart', tiktok: 'AddToCart' },
  InitiateCheckout: { meta: 'InitiateCheckout', tiktok: 'InitiateCheckout' },
  AddPaymentInfo: { meta: 'AddPaymentInfo', tiktok: 'AddPaymentInfo' },
  Donate: { meta: 'Donate', tiktok: 'CompletePayment' },
  Purchase: { meta: 'Donate', tiktok: 'CompletePayment' },
  Subscribe: { meta: 'Subscribe', tiktok: 'Subscribe' },
};

async function trackEvent(eventName, eventData, userData, clientInfo) {
  const mapping = EVENT_MAP[eventName];
  if (!mapping) {
    console.warn(`Unknown event: ${eventName}`);
    return { meta: null, tiktok: null };
  }

  const metaCustomData = {};
  const tiktokProperties = {};

  if (eventData.value !== undefined) {
    metaCustomData.value = Number(eventData.value);
    metaCustomData.currency = eventData.currency || 'USD';
    tiktokProperties.value = Number(eventData.value);
    tiktokProperties.currency = eventData.currency || 'USD';
  }

  if (eventData.contentName) {
    metaCustomData.content_name = eventData.contentName;
  }

  if (eventData.contentType) {
    metaCustomData.content_type = eventData.contentType;
  }

  tiktokProperties.content_type = 'product';
  tiktokProperties.content_id = eventData.contentId || 'donation';
  tiktokProperties.contents = [
    {
      content_id: eventData.contentId || 'donation',
      content_type: 'product',
      content_name: eventData.contentName || 'Donation',
      quantity: 1,
      price: Number(eventData.value) || 0,
    },
  ];

  if (eventData.orderId) {
    metaCustomData.order_id = eventData.orderId;
  }

  const metaEventData = {
    eventId: eventData.eventId,
    sourceUrl: eventData.sourceUrl,
    customData:
      Object.keys(metaCustomData).length > 0 ? metaCustomData : undefined,
  };

  const tiktokEventData = {
    eventId: eventData.eventId,
    sourceUrl: eventData.sourceUrl,
    properties:
      Object.keys(tiktokProperties).length > 0 ? tiktokProperties : undefined,
  };

  const tiktokPromise =
    eventName === 'PageView'
      ? Promise.resolve(null)
      : sendTikTokEvent(
          mapping.tiktok,
          tiktokEventData,
          userData,
          clientInfo,
          helpers
        );

  const [metaResult, tiktokResult] = await Promise.all([
    sendMetaEvent(mapping.meta, metaEventData, userData, clientInfo, helpers),
    tiktokPromise,
  ]);

  const statusObj = {
    meta: metaResult?.events_received ? '✓' : '✗',
    tiktok:
      eventName === 'PageView'
        ? '-'
        : tiktokResult?.code === 0
        ? '✓'
        : '✗',
    rawMeta: metaResult,
    rawTiktok: tiktokResult,
  };

  recentCapiEvents.unshift({
    id: eventData.eventId || `${eventName}_${Date.now()}`,
    eventName,
    value: eventData.value ?? null,
    currency: eventData.currency || 'USD',
    contentName: eventData.contentName || null,
    orderId: eventData.orderId || null,
    meta: statusObj.meta,
    tiktok: statusObj.tiktok,
    fbp: userData?.fbp || null,
    fbc: userData?.fbc || null,
    ip: clientInfo?.ipAddress || null,
    city: clientInfo?.clientLocation?.city || null,
    countryCode: clientInfo?.clientLocation?.countryCode || null,
    timestamp: new Date().toISOString(),
  });
  if (recentCapiEvents.length > 100) recentCapiEvents.pop();

  return statusObj;
}

async function trackDonate(paymentData, trackingData, clientInfo) {
  if (!trackingData || !trackingData.eventId) {
    throw new Error('trackDonate requires trackingData.eventId for dedup integrity');
  }
  if (!trackingData.sourceUrl) {
    throw new Error('trackDonate requires trackingData.sourceUrl');
  }

  const { firstName, lastName } = parseName(
    paymentData.cardHolderName || paymentData.donorNameReal
  );

  const userData = {
    email: paymentData.donorEmail || paymentData.payerEmail || null,
    firstName,
    lastName,
    externalId: paymentData.customerId || null,
    fbp: trackingData.fbp || null,
    fbc: trackingData.fbc || null,
    ttp: trackingData.ttp || null,
    ttclid: trackingData.ttclid || null,
  };

  const eventData = {
    eventId: trackingData.eventId,
    sourceUrl: trackingData.sourceUrl,
    value: Number(paymentData.amount),
    currency: paymentData.currency || 'USD',
    contentName: `${
      paymentData.donationType === 'monthly'
        ? 'Monthly'
        : paymentData.donationType === 'weekly'
        ? 'Weekly'
        : 'One-time'
    } Donation`,
    contentType: 'donation',
    orderId: paymentData.captureId,
  };

  return trackEvent('Donate', eventData, userData, clientInfo);
}

const trackPurchase = trackDonate;

// Recurring subscription initial creation (server-side CAPI Subscribe event).
// Note from GFM New Cloaked: Renewals are not sent: they aren't new ad conversions.
async function trackSubscribe(sub, donor, trackingData, clientInfo) {
  const { firstName, lastName } = parseName(donor.name);
  const userData = {
    email: donor.email || null,
    firstName,
    lastName,
    externalId: sub.id,
    fbp: trackingData.fbp || null,
    fbc:
      trackingData.fbc ||
      (trackingData.fbclid
        ? `fb.1.${Date.now()}.${trackingData.fbclid}`
        : null),
    ttp: trackingData.ttp || null,
    ttclid: trackingData.ttclid || null,
  };
  const eventData = {
    eventId: `Subscribe_${sub.id}`,
    sourceUrl: trackingData.sourceUrl,
    value: Number(sub.monthly || sub.amount),
    currency: sub.currency || 'USD',
    contentName:
      sub.frequency === 'WEEK' ? 'Weekly Donation' : 'Monthly Donation',
    contentType: 'product',
    orderId: sub.id,
  };
  return trackEvent('Subscribe', eventData, userData, clientInfo);
}

function getTrackingConfig() {
  const { TRACKING_ENABLED, FB_PIXEL_ID, TIKTOK_PIXEL_ID } = getConfig();
  return {
    fbPixelId: TRACKING_ENABLED ? FB_PIXEL_ID || null : null,
    tiktokPixelId: TRACKING_ENABLED ? TIKTOK_PIXEL_ID || null : null,
    enabled: TRACKING_ENABLED && !!(FB_PIXEL_ID || TIKTOK_PIXEL_ID),
  };
}

function isTrackingEnabled() {
  const { TRACKING_ENABLED, FB_PIXEL_ID, TIKTOK_PIXEL_ID } = getConfig();
  return TRACKING_ENABLED && !!(FB_PIXEL_ID || TIKTOK_PIXEL_ID);
}

function getRecentCapiEvents() {
  return recentCapiEvents;
}

module.exports = {
  trackEvent,
  trackDonate,
  trackPurchase,
  trackSubscribe,
  getTrackingConfig,
  isTrackingEnabled,
  getRecentCapiEvents,
  hashSHA256,
  parseName,
};
