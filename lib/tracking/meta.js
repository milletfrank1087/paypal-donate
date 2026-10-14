const META_API_VERSION = 'v20.0';
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

function buildMetaUserData(userData, clientInfo, { hashSHA256 }) {
  const result = {};
  const emailHash =
    userData.emailHash || (userData.email ? hashSHA256(userData.email) : null);

  if (emailHash) {
    result.em = [emailHash];
  }

  if (userData.firstName) {
    result.fn = [hashSHA256(userData.firstName)];
  }

  if (userData.lastName) {
    result.ln = [hashSHA256(userData.lastName)];
  }

  if (userData.externalId) {
    result.external_id = [hashSHA256(String(userData.externalId))];
  } else if (emailHash) {
    result.external_id = [emailHash];
  }

  if (clientInfo.ipAddress && clientInfo.ipAddress !== 'unknown') {
    result.client_ip_address = clientInfo.ipAddress;
  }

  if (clientInfo.userAgent && clientInfo.userAgent !== 'unknown') {
    result.client_user_agent = clientInfo.userAgent;
  }

  if (userData.fbp) {
    result.fbp = userData.fbp;
  }

  if (userData.fbc) {
    result.fbc = userData.fbc;
  }

  if (clientInfo.clientLocation) {
    if (
      clientInfo.clientLocation.city &&
      !['Unknown', 'Local'].includes(clientInfo.clientLocation.city)
    ) {
      result.ct = [
        hashSHA256(
          clientInfo.clientLocation.city.toLowerCase().replace(/\s+/g, '')
        ),
      ];
    }
    if (
      clientInfo.clientLocation.countryCode &&
      !['??', 'DEV'].includes(clientInfo.clientLocation.countryCode)
    ) {
      result.country = [
        hashSHA256(clientInfo.clientLocation.countryCode.toLowerCase()),
      ];
    }
  }

  return result;
}

function resolveSourceUrl(originalUrl) {
  const capiDomain = process.env.CAPI_SOURCE_DOMAIN;
  if (!capiDomain) return originalUrl;
  return `https://${capiDomain}/`;
}

function isPlaceholderToken(token) {
  if (!token) return true;
  const t = String(token).trim();
  return t.length < 40 || /REDACTED|YOUR_|PLACEHOLDER/i.test(t);
}

async function sendMetaEvent(
  eventName,
  eventData,
  userData,
  clientInfo,
  { getConfig, hashSHA256 }
) {
  const { FB_PIXEL_ID, FB_ACCESS_TOKEN } = getConfig();

  if (!FB_PIXEL_ID) {
    return null;
  }

  if (!eventData.eventId) {
    console.error(`Meta CAPI: ${eventName} skipped (missing eventId for dedup)`);
    return null;
  }
  if (!eventData.sourceUrl) {
    console.error(`Meta CAPI: ${eventName} skipped (missing sourceUrl)`);
    return null;
  }

  try {
    const eventTime = Math.floor(Date.now() / 1000);
    const metaUserData = buildMetaUserData(userData, clientInfo, {
      hashSHA256,
    });

    const payload = {
      data: [
        {
          event_name: eventName,
          event_time: eventTime,
          event_id: eventData.eventId,
          event_source_url: resolveSourceUrl(eventData.sourceUrl),
          action_source: 'website',
          user_data: metaUserData,
        },
      ],
    };

    if (eventData.customData) {
      payload.data[0].custom_data = eventData.customData;
    }

    // If local dev uses a redacted placeholder token, validate & return simulated success with full payload
    if (isPlaceholderToken(FB_ACCESS_TOKEN)) {
      return {
        events_received: 1,
        mode: 'local_sandbox',
        payload: payload.data[0],
      };
    }

    const url = `${META_API_BASE}/${FB_PIXEL_ID}/events?access_token=${FB_ACCESS_TOKEN}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (result.events_received) {
      return result;
    } else {
      console.error(`❌ Meta CAPI: ${eventName} REJECTED`);
      console.error(`   Response:`, JSON.stringify(result));
      return null;
    }
  } catch (error) {
    console.error(
      `❌ Meta CAPI: ${eventName} FAILED with exception:`,
      error.message
    );
    return null;
  }
}

module.exports = { buildMetaUserData, sendMetaEvent };
