/**
 * Browser-Side Tracking Module (ported from GFM New Cloaked campaign/public/js/tracking.js & store/public/js/paypal-tracking.js)
 * Handles Meta Pixel (fbq) + TikTok Pixel (ttq) browser events and server-side proxy for CAPI with shared eventId deduplication.
 */

const Tracking = (function () {
  let config = null;
  let initialized = false;
  let clientLocation = null;
  let cachedEmailHash = null;
  let addPaymentInfoFired = false;

  function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) {
      const raw = parts.pop().split(';').shift();
      try {
        return decodeURIComponent(raw);
      } catch (_) {
        return raw;
      }
    }
    return null;
  }

  function setCookie(name, value, days) {
    const maxAge = days * 24 * 60 * 60;
    document.cookie = `${name}=${encodeURIComponent(
      value
    )}; max-age=${maxAge}; path=/; SameSite=Lax`;
  }

  /**
   * Generate unique event ID for browser <-> CAPI deduplication
   */
  function generateEventId(eventName) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 11);
    return `${eventName}_${timestamp}_${random}`;
  }

  /**
   * Hash email with SHA-256 for Meta Pixel Advanced Matching
   */
  async function hashEmail(email) {
    if (!email || !window.crypto || !window.crypto.subtle) {
      return null;
    }
    try {
      const normalized = email.toLowerCase().trim();
      const msgBuffer = new TextEncoder().encode(normalized);
      const hashBuffer = await window.crypto.subtle.digest(
        'SHA-256',
        msgBuffer
      );
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch (_e) {
      return null;
    }
  }

  async function setUserEmail(email) {
    if (!email) return null;
    const hash = await hashEmail(email);
    if (hash) {
      cachedEmailHash = hash;
      try {
        sessionStorage.setItem('_user_email_hash', hash);
      } catch (_) {}
    }
    return hash;
  }

  function getUserEmailHash() {
    if (cachedEmailHash) return cachedEmailHash;
    try {
      const stored = sessionStorage.getItem('_user_email_hash');
      if (stored) {
        cachedEmailHash = stored;
        return stored;
      }
    } catch (_) {}
    return null;
  }

  /**
   * Capture click IDs, UTM parameters, and referral codes from URL
   */
  function captureClickIds() {
    const params = new URLSearchParams(window.location.search);

    const fbclid = params.get('fbclid');
    if (fbclid) {
      const existingFbc = getCookie('_fbc');
      if (!existingFbc || !existingFbc.includes(fbclid)) {
        const timestamp = Date.now();
        const fbc = `fb.1.${timestamp}.${fbclid}`;
        setCookie('_fbc', fbc, 90);
        setCookie('_fbclid', fbclid, 90);
      }
    }

    const ttclid = params.get('ttclid');
    if (ttclid) {
      setCookie('_ttclid', ttclid, 90);
    }

    const ref = params.get('ref');
    if (ref) {
      try {
        sessionStorage.setItem('_hr_ref', ref);
      } catch (_) {}
      setCookie('_hr_ref', ref, 7);
    }

    const utmParams = {
      utm_source: params.get('utm_source'),
      utm_medium: params.get('utm_medium'),
      utm_campaign: params.get('utm_campaign'),
      utm_content: params.get('utm_content'),
      utm_term: params.get('utm_term'),
    };

    if (Object.values(utmParams).some((v) => v !== null)) {
      const existing = sessionStorage.getItem('utm_data');
      if (!existing) {
        try {
          sessionStorage.setItem('utm_data', JSON.stringify(utmParams));
        } catch (_) {}
        setCookie('_utm_data', JSON.stringify(utmParams), 90);
      }
    }
  }

  /**
   * Get all tracking cookies and attribution data
   */
  function getTrackingData() {
    const urlParams = new URLSearchParams(window.location.search);
    const urlUtms = {
      utm_source: urlParams.get('utm_source'),
      utm_medium: urlParams.get('utm_medium'),
      utm_campaign: urlParams.get('utm_campaign'),
      utm_content: urlParams.get('utm_content'),
      utm_term: urlParams.get('utm_term'),
    };

    const hasUrlUtms = Object.values(urlUtms).some((v) => v !== null);
    let storedUtmData = {};

    if (!hasUrlUtms) {
      try {
        storedUtmData = JSON.parse(sessionStorage.getItem('utm_data') || '{}');
      } catch (_) {}
      if (Object.keys(storedUtmData).length === 0) {
        try {
          const cookieData = getCookie('_utm_data');
          if (cookieData) storedUtmData = JSON.parse(cookieData);
        } catch (_) {}
      }
    }

    const utmData = hasUrlUtms ? urlUtms : storedUtmData;

    let fbc = getCookie('_fbc');
    const fbclid = urlParams.get('fbclid') || getCookie('_fbclid');
    if (!fbc && fbclid) {
      let ts = null;
      try {
        ts = sessionStorage.getItem('_fbclid_ts');
      } catch (_) {}
      if (!ts) {
        ts = String(Date.now());
        try {
          sessionStorage.setItem('_fbclid_ts', ts);
        } catch (_) {}
      }
      fbc = `fb.1.${ts}.${fbclid}`;
    }

    let fbp = getCookie('_fbp');
    if (!fbp && config && config.fbp) {
      fbp = config.fbp;
    }

    return {
      fbp: fbp || null,
      fbc: fbc || null,
      fbclid: fbclid || null,
      ttp: getCookie('_ttp') || null,
      ttclid: urlParams.get('ttclid') || getCookie('_ttclid') || null,
      sourceUrl: window.location.href,
      utm_source: utmData.utm_source || null,
      utm_medium: utmData.utm_medium || null,
      utm_campaign: utmData.utm_campaign || null,
      utm_content: utmData.utm_content || null,
      utm_term: utmData.utm_term || null,
      referrer: document.referrer || null,
      ref_code: sessionStorage.getItem('_hr_ref') || getCookie('_hr_ref') || null,
    };
  }

  /**
   * Send event to server for CAPI processing
   */
  async function sendToServer(eventName, eventData) {
    try {
      const trackingData = getTrackingData();
      const emailHash = getUserEmailHash();
      const payload = {
        event: eventName,
        eventId: eventData.eventId,
        sourceUrl: trackingData.sourceUrl,
        cookies: {
          fbp: trackingData.fbp,
          fbc: trackingData.fbc,
          ttp: trackingData.ttp,
          ttclid: trackingData.ttclid,
        },
        clientLocation,
        data: {
          ...(eventData.data || {}),
          emailHash: emailHash || undefined,
        },
      };

      await fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (_error) {}
  }

  function fireMetaPixel(eventName, params, eventId) {
    if (typeof window.fbq !== 'undefined') {
      try {
        if (params && Object.keys(params).length > 0) {
          window.fbq('track', eventName, params, { eventID: eventId });
        } else {
          window.fbq('track', eventName, {}, { eventID: eventId });
        }
      } catch (_e) {}
    }
  }

  function fireTikTokPixel(eventName, params, eventId) {
    if (typeof window.ttq !== 'undefined') {
      try {
        if (eventName === 'Pageview') return;
        const ttParams = params
          ? { ...params, event_id: eventId }
          : { event_id: eventId };
        window.ttq.track(eventName, ttParams);
      } catch (_e) {}
    }
  }

  function track(eventName, data) {
    const eventId = generateEventId(eventName);
    const eventMapping = {
      PageView: { meta: 'PageView', tiktok: 'Pageview' },
      ViewContent: { meta: 'ViewContent', tiktok: 'ViewContent' },
      AddToCart: { meta: 'AddToCart', tiktok: 'AddToCart' },
      InitiateCheckout: {
        meta: 'InitiateCheckout',
        tiktok: 'InitiateCheckout',
      },
      AddPaymentInfo: { meta: 'AddPaymentInfo', tiktok: 'AddPaymentInfo' },
      Donate: { meta: 'Donate', tiktok: 'CompletePayment' },
      Purchase: { meta: 'Donate', tiktok: 'CompletePayment' },
    };

    const mapping = eventMapping[eventName];
    if (!mapping) return eventId;

    const metaParams = {};
    const tiktokParams = {
      content_type: 'product',
      content_id: 'donation',
      contents: [
        {
          content_id: 'donation',
          content_type: 'product',
          content_name: 'Donation',
          quantity: 1,
          price: data?.value || 0,
        },
      ],
    };

    if (data) {
      if (data.value !== undefined) {
        metaParams.value = Number(data.value);
        metaParams.currency = data.currency || 'USD';
        tiktokParams.value = Number(data.value);
        tiktokParams.currency = data.currency || 'USD';
        tiktokParams.contents[0].price = Number(data.value);
      }
      if (data.contentName) {
        metaParams.content_name = data.contentName;
        tiktokParams.contents[0].content_name = data.contentName;
      }
      if (data.contentType) {
        metaParams.content_type = data.contentType;
      }
    }

    fireMetaPixel(mapping.meta, metaParams, eventId);
    fireTikTokPixel(mapping.tiktok, tiktokParams, eventId);

    sendToServer(eventName, {
      eventId,
      data: data || {},
    });

    return eventId;
  }

  function trackPageView() {
    const eventId = generateEventId('PageView');
    fireMetaPixel('PageView', {}, eventId);
    sendToServer('PageView', { eventId, data: {} });
    return eventId;
  }

  async function trackViewContent(data) {
    const eventId = generateEventId('ViewContent');
    fireMetaPixel(
      'ViewContent',
      data ? { content_type: data.contentType } : {},
      eventId
    );
    fireTikTokPixel(
      'ViewContent',
      {
        content_type: 'product',
        content_id: 'donation',
        contents: [
          {
            content_id: 'donation',
            content_type: 'product',
            content_name: 'Donation',
            quantity: 1,
            price: 0,
          },
        ],
      },
      eventId
    );
    sendToServer('ViewContent', {
      eventId,
      data: data || {},
    });
    return eventId;
  }

  function normalizeValueData(valueOrObj, currency = 'USD', defaultName = 'Help my baby') {
    if (valueOrObj && typeof valueOrObj === 'object') {
      return {
        value: Number(valueOrObj.value) || 0,
        currency: valueOrObj.currency || 'USD',
        contentName: valueOrObj.contentName || defaultName,
        contentType: valueOrObj.contentType || 'donation',
      };
    }
    return {
      value: Number(valueOrObj) || 0,
      currency: currency || 'USD',
      contentName: defaultName,
      contentType: 'donation',
    };
  }

  function trackAddToCart(valueOrObj, currency = 'USD') {
    return track('AddToCart', normalizeValueData(valueOrObj, currency));
  }

  function trackInitiateCheckout(valueOrObj, currency = 'USD') {
    return track('InitiateCheckout', normalizeValueData(valueOrObj, currency));
  }

  function trackAddPaymentInfo(valueOrObj, currency = 'USD') {
    return track('AddPaymentInfo', normalizeValueData(valueOrObj, currency, 'Card Details Entered'));
  }

  function fireAddPaymentInfoOnce(value, currency = 'USD') {
    if (addPaymentInfoFired) return null;
    addPaymentInfoFired = true;
    return trackAddPaymentInfo({
      value: Number(value) || 0,
      currency,
      contentType: 'donation',
      contentName: 'Card Details Entered',
    });
  }

  function resetAddPaymentInfoGuard() {
    addPaymentInfoFired = false;
  }

  /**
   * Fire browser Donate pixel with shared eventId (matching server-side CAPI trackDonate)
   */
  async function trackDonateBrowser(valueOrObj, currencyOrEventId, maybeEventId) {
    let data;
    let finalEventId;
    if (valueOrObj && typeof valueOrObj === 'object') {
      data = normalizeValueData(valueOrObj, valueOrObj.currency);
      finalEventId = currencyOrEventId || generateEventId('Donate');
    } else {
      data = normalizeValueData(valueOrObj, currencyOrEventId);
      finalEventId = maybeEventId || generateEventId('Donate');
    }
    const metaParams = {
      value: Number(data.value),
      currency: data.currency || 'USD',
      content_name: data.contentName || 'Donation',
      content_type: 'donation',
    };

    const tiktokParams = {
      value: Number(data.value),
      currency: data.currency || 'USD',
      content_type: 'product',
      content_id: 'donation',
      contents: [
        {
          content_id: 'donation',
          content_type: 'product',
          content_name: data.contentName || 'Donation',
          quantity: 1,
          price: Number(data.value),
        },
      ],
    };

    fireMetaPixel('Donate', metaParams, finalEventId);
    fireTikTokPixel('CompletePayment', tiktokParams, finalEventId);
    return finalEventId;
  }

  const trackPurchaseBrowser = trackDonateBrowser;

  function trackPaymentEvent(eventType, detailsOrObj = {}, amount = null, paymentMethod = null) {
    const payloadObj =
      detailsOrObj && typeof detailsOrObj === 'object'
        ? detailsOrObj
        : { details: detailsOrObj, amount, paymentMethod };
    try {
      fetch('/api/track/payment-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType,
          details: payloadObj.details || null,
          amount: payloadObj.amount || null,
          paymentMethod: payloadObj.paymentMethod || null,
          clientLocation,
        }),
      }).catch(() => {});
    } catch (_) {}
  }

  function getFullTrackingPayload(eventId) {
    const td = getTrackingData();
    return {
      ...td,
      eventId: eventId || generateEventId('Donate'),
    };
  }

  async function init() {
    if (initialized) return config;
    captureClickIds();
    try {
      const response = await fetch('/api/tracking/config');
      if (response.ok) {
        config = await response.json();
        if (config.location) {
          clientLocation = config.location;
        }
      }
    } catch (_) {}

    initialized = true;
    trackPageView();
    trackViewContent({ contentType: 'campaign', contentName: 'Help my baby' });
    return config;
  }

  return {
    init,
    getConfig: () => config,
    getCookie,
    setCookie,
    generateEventId,
    getTrackingData,
    getTrackingCookies: getTrackingData,
    getFullTrackingPayload,
    getClientLocation: () => clientLocation,
    track,
    trackPageView,
    trackViewContent,
    trackAddToCart,
    trackInitiateCheckout,
    trackAddPaymentInfo,
    fireAddPaymentInfoOnce,
    resetAddPaymentInfoGuard,
    trackDonateBrowser,
    trackPurchaseBrowser,
    trackPaymentEvent,
    setUserEmail,
    getUserEmailHash,
  };
})();

if (typeof window !== 'undefined') {
  window.Tracking = Tracking;
}
