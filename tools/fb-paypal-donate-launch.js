// PayPal Donate Meta Ads Campaign Launcher (ABO $50/day, Pixel 1114144687675421 "Paypal Donations", DONATE optimization)
// Usage: node tools/fb-paypal-donate-launch.js
const fs = require('fs');
const path = require('path');

const fbEnvPath = 'C:/Users/iakwv/Downloads/FB ads manager/.env';
const env = Object.fromEntries(
  fs
    .readFileSync(fbEnvPath, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [
        l.slice(0, i).trim(),
        l
          .slice(i + 1)
          .trim()
          .replace(/^["']|["']$/g, ''),
      ];
    })
);

const T = env.FB_SYSTEM_USER_ACCESS_TOKEN || env.FB_USER_ACCESS_TOKEN;
const V = env.GRAPH_API_VERSION || 'v21.0';
const ACT = process.env.FB_AD_ACCOUNT_ID || 'act_1388808955587972';
const PAGE = process.env.FB_PAGE_ID || '113297813778299';
const PIXEL = process.env.FB_PIXEL_ID || '1114144687675421'; // "Paypal Donations"
const VIDEO_PATH =
  process.env.VIDEO_PATH || 'C:/Users/iakwv/Downloads/download (21).mp4';
const THUMB_PATH =
  process.env.THUMB_PATH || 'C:/Users/iakwv/AppData/Local/Temp/snaptik_21_1s.jpg';
const DOMAIN = process.env.DONATE_DOMAIN || 'https://paypal.risehope.online';
const COUNTRY = process.env.TARGET_COUNTRY || 'US';

const B = `https://graph.facebook.com/${V}`;

const post = async (p, o, isMultipart = false) => {
  const res = await fetch(
    `${B}/${p}`,
    Object.assign(
      { method: 'POST' },
      isMultipart
        ? { body: o }
        : { body: new URLSearchParams(Object.assign({ access_token: T }, o)) }
    )
  );
  return res.json();
};

const get = async (p) => {
  const res = await fetch(
    `${B}/${p}${p.includes('?') ? '&' : '?'}access_token=${T}`
  );
  return res.json();
};

const fail = (label, r) => {
  console.log(`${label}: ${JSON.stringify(r).slice(0, 600)}`);
  if (r.error) process.exit(1);
  return r;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log(`=== Launching PAUSED Meta Campaign on ${ACT} (Pixel: ${PIXEL}) ===`);

  // 1. Upload Thumbnail Image for Video Creative
  const thumbBuf = fs.readFileSync(THUMB_PATH);
  const imgForm = new FormData();
  imgForm.append('access_token', T);
  imgForm.append(
    'filename',
    new Blob([thumbBuf], { type: 'image/jpeg' }),
    'snaptik-thumb.jpg'
  );
  const upImg = fail('upload_thumbnail', await post(`${ACT}/adimages`, imgForm, true));
  const imageHash = upImg.images[Object.keys(upImg.images)[0]].hash;
  console.log('image_hash=' + imageHash);

  // 2. Upload Snaptik Video to Ad Account
  const vidBuf = fs.readFileSync(VIDEO_PATH);
  const vidForm = new FormData();
  vidForm.append('access_token', T);
  vidForm.append('title', path.basename(VIDEO_PATH));
  vidForm.append(
    'source',
    new Blob([vidBuf], { type: 'video/mp4' }),
    'snaptik-video.mp4'
  );
  const upVid = fail('upload_video', await post(`${ACT}/advideos`, vidForm, true));
  const videoId = upVid.id;
  console.log('video_id=' + videoId);

  // Poll until video is ready
  for (let i = 0; i < 15; i++) {
    const vStat = await get(`${videoId}?fields=status`);
    const st = vStat?.status?.video_status;
    console.log(`video_status [${i + 1}]: ${st}`);
    if (st === 'ready') break;
    await sleep(3000);
  }

  // 3. Create Campaign (PAUSED so content can be finalized before spend)
  const camp = fail(
    'campaign',
    await post(`${ACT}/campaigns`, {
      name: `PayPal Donate - ${COUNTRY} (Snaptik Video)`,
      objective: 'OUTCOME_SALES',
      status: 'PAUSED',
      buying_type: 'AUCTION',
      special_ad_categories: '[]',
      is_adset_budget_sharing_enabled: 'False',
    })
  );

  // 4. Create Ad Set (ABO $50/day, OFFSITE_CONVERSIONS -> Pixel 1114144687675421 DONATE)
  const link = `${DOMAIN}/?utm_source=fb&utm_medium=paid&utm_campaign=${camp.id}`;
  const aset = fail(
    'adset',
    await post(`${ACT}/adsets`, {
      name: `$50/day - ${COUNTRY} - Broad - PayPal Donate (DONATE)`,
      campaign_id: camp.id,
      daily_budget: '5000',
      billing_event: 'IMPRESSIONS',
      optimization_goal: 'OFFSITE_CONVERSIONS',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      promoted_object: JSON.stringify({
        pixel_id: PIXEL,
        custom_event_type: 'DONATE',
      }),
      targeting: JSON.stringify({
        age_min: 18,
        age_max: 65,
        user_age_unknown: true,
        geo_locations: {
          countries: [COUNTRY],
          location_types: ['frequently_in', 'home', 'recent'],
        },
        targeting_automation: { advantage_audience: 1 },
      }),
      attribution_spec: JSON.stringify([
        { event_type: 'CLICK_THROUGH', window_days: 7 },
      ]),
      status: 'PAUSED',
    })
  );

  // 5. Create Video Ad Creative (DONATE_NOW fallback to LEARN_MORE)
  const placeholderMsg =
    'Every contribution directly supports urgent pediatric care. Tap below to donate securely via PayPal.';
  const buildVideoSpec = (ctaType) => ({
    page_id: PAGE,
    video_data: {
      video_id: videoId,
      image_hash: imageHash,
      title: 'Support Help My Baby — Official PayPal Fundraiser',
      link_description: '100% secure one-time or recurring donation.',
      message: placeholderMsg,
      call_to_action: {
        type: ctaType,
        value: { link },
      },
    },
  });

  let cr = await post(`${ACT}/adcreatives`, {
    name: 'PayPal Donate - Snaptik Video Creative',
    object_story_spec: JSON.stringify(buildVideoSpec('DONATE_NOW')),
  });
  if (cr.error) {
    console.log(
      'creative-donate-now-fallback: ' + JSON.stringify(cr).slice(0, 300)
    );
    cr = fail(
      'creative',
      await post(`${ACT}/adcreatives`, {
        name: 'PayPal Donate - Snaptik Video Creative',
        object_story_spec: JSON.stringify(buildVideoSpec('LEARN_MORE')),
      })
    );
  } else {
    console.log('creative: ' + JSON.stringify(cr).slice(0, 300));
  }

  // 6. Create Ad (PAUSED)
  const ad = fail(
    'ad',
    await post(`${ACT}/ads`, {
      name: 'PayPal Donate - Snaptik Video Ad #1',
      adset_id: aset.id,
      creative: JSON.stringify({ creative_id: cr.id }),
      status: 'PAUSED',
    })
  );

  console.log(
    'READBACK ad: ' +
      JSON.stringify(
        await get(`${ad.id}?fields=id,name,status,effective_status`)
      )
  );
  console.log(
    `DONE campaign=${camp.id} adset=${aset.id} creative=${cr.id} ad=${ad.id} link=${link}`
  );
})();
