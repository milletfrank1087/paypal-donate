const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api/v1.3';

function buildTikTokUserData(userData, clientInfo, { hashSHA256 }) {
  const result = {};

  if (userData.email) {
    result.email = hashSHA256(userData.email);
  }

  if (userData.externalId) {
    result.external_id = hashSHA256(String(userData.externalId));
  } else if (userData.email) {
    result.external_id = hashSHA256(userData.email);
  }

  if (clientInfo.ipAddress && clientInfo.ipAddress !== 'unknown') {
    result.ip = clientInfo.ipAddress;
  }

  if (clientInfo.userAgent && clientInfo.userAgent !== 'unknown') {
    result.user_agent = clientInfo.userAgent;
  }

  if (userData.ttp) {
    result.ttp = userData.ttp;
  }

  if (userData.ttclid) {
    result.ttclid = userData.ttclid;
  }

  return result;
}

function isPlaceholderToken(token) {
  if (!token) return true;
  const t = String(token).trim();
  return t.length < 25 || /REDACTED|YOUR_|PLACEHOLDER/i.test(t);
}

async function sendTikTokEvent(
  eventName,
  eventData,
  userData,
  clientInfo,
  { getConfig, hashSHA256 }
) {
  const { TIKTOK_PIXEL_ID, TIKTOK_ACCESS_TOKEN } = getConfig();

  if (!TIKTOK_PIXEL_ID) {
    return null;
  }

  try {
    const eventTime = Math.floor(Date.now() / 1000);
    const tiktokUserData = buildTikTokUserData(userData, clientInfo, {
      hashSHA256,
    });

    const payload = {
      event_source: 'web',
      event_source_id: TIKTOK_PIXEL_ID,
      data: [
        {
          event: eventName,
          event_time: eventTime,
          event_id: eventData.eventId,
          user: tiktokUserData,
          page: {
            url: eventData.sourceUrl,
          },
        },
      ],
    };

    if (eventData.properties) {
      payload.data[0].properties = eventData.properties;
    }

    if (isPlaceholderToken(TIKTOK_ACCESS_TOKEN)) {
      return {
        code: 0,
        mode: 'local_sandbox',
        payload: payload.data[0],
      };
    }

    const url = `${TIKTOK_API_BASE}/event/track/`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Access-Token': TIKTOK_ACCESS_TOKEN,
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (result.code === 0) {
      return result;
    } else {
      console.error(`TikTok API error for ${eventName}:`, result);
      return null;
    }
  } catch (error) {
    console.error(`TikTok API request failed for ${eventName}:`, error.message);
    return null;
  }
}

module.exports = { buildTikTokUserData, sendTikTokEvent };
