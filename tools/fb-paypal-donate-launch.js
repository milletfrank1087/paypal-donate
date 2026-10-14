/**
 * Meta Ads — Upload 3 Snaptik 9:16 Videos (19, 20, 21) & Create 3 Ad Creatives + Ads
 *
 * Target:
 *  - Ad Account: act_1388808955587972 (1526707335197951)
 *  - Pixel: 1114144687675421 ("Paypal Donations", custom_event_type: "DONATE")
 *  - Campaign: 23859952985620790 ([TEST] PayPal Donate - Junie 9:16 Video - US - ABO)
 *  - Ad Set:   23859952985690790 ($50/day - US - 9:16 Reels/Stories/Mobile Feed - PayPal Donate)
 */
const fs = require('fs');
const path = require('path');

const envRaw = fs.readFileSync('C:/Users/iakwv/Downloads/FB ads manager/.env', 'utf8');
const TOKEN = envRaw.match(/FB_SYSTEM_USER_ACCESS_TOKEN=(.+)/)[1].trim();

const AD_ACCOUNT_ID = 'act_1388808955587972';
const PIXEL_ID = '1114144687675421';
const PAGE_ID = '113297813778299';
const IG_USER_ID = '17841473572828728';

const CAMPAIGN_ID = '23859952985620790';
const ADSET_ID = '23859952985690790';
const OLD_AD_ID = '23859952986170790';

const VIDEOS = [
  {
    num: 19,
    key: 'video_19_accordion_junie',
    label: 'Video 19 (Wood Accordion Hook -> Junie Hallway)',
    videoPath: 'C:/Users/iakwv/Downloads/download (19).mp4',
    thumbPath: 'C:/Users/iakwv/AppData/Local/Temp/snaptik_19_junie.jpg',
    existingVideoId: null,
    headline: 'Please Help Junie Get Her Life-Saving Surgery',
    description: 'Every donation goes directly toward Junie’s emergency surgery and recovery.',
    message: [
      'Junie still walks up to her bowl every morning, waiting patiently even through the pain. 💔',
      '',
      'Our sweet calico girl needs urgent surgery to survive, and we are running out of time to cover the veterinary surgical costs.',
      '',
      'Even $5 or $10 brings Junie one step closer to the operating table and a pain-free life. If you can’t donate today, please share her story. 🙏🐾'
    ].join('\n')
  },
  {
    num: 20,
    key: 'video_20_sunflower_junie',
    label: 'Video 20 (Sunflower Eggs Hook -> Junie Chair Treat)',
    videoPath: 'C:/Users/iakwv/Downloads/download (20).mp4',
    thumbPath: 'C:/Users/iakwv/AppData/Local/Temp/snaptik_20_junie.jpg',
    existingVideoId: null,
    headline: 'Help Save Sweet Junie — Emergency Surgery Fund',
    description: '100% of your contribution supports Junie’s veterinary surgery.',
    message: [
      '“I’m sorry Junie, no one is donating for your surgery...” 💔🐾',
      '',
      'She still purrs and licks her little treat, completely unaware of how close we are to running out of time for her operation.',
      '',
      'Please don’t scroll past Junie today. Any amount — big or small — helps pay for her surgery and gives her a second chance at life. 🙏❤️'
    ].join('\n')
  },
  {
    num: 21,
    key: 'video_21_pudding_junie',
    label: 'Video 21 (Cat Pudding Hook -> Junie Hallway)',
    videoPath: 'C:/Users/iakwv/Downloads/download (21).mp4',
    thumbPath: 'C:/Users/iakwv/AppData/Local/Temp/snaptik_21_junie.jpg',
    existingVideoId: '1697339751815862',
    headline: 'Don’t Let Junie Face This Alone — Donate Today',
    description: 'Fast, secure PayPal & Card checkout. Every dollar helps save Junie.',
    message: [
      'Watching Junie walk slowly down the hallway breaks my heart every single day. 💔',
      '',
      'The vet says her surgery cannot wait much longer, stabilize care is only temporary, and we still haven’t reached what we need for the procedure.',
      '',
      'If you have even a few dollars to spare, please help us get Junie into surgery today. Every single donation counts. 🙏🐱'
    ].join('\n')
  }
];

async function graphGet(endpoint) {
  const sep = endpoint.includes('?') ? '&' : '?';
  const res = await fetch(`https://graph.facebook.com/v21.0/${endpoint}${sep}access_token=${TOKEN}`);
  return res.json();
}

async function graphPost(endpoint, params) {
  const body = new URLSearchParams();
  body.set('access_token', TOKEN);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) {
      body.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
  }
  const res = await fetch(`https://graph.facebook.com/v21.0/${endpoint}`, {
    method: 'POST',
    body
  });
  return res.json();
}

async function graphDelete(endpoint) {
  const res = await fetch(`https://graph.facebook.com/v21.0/${endpoint}?access_token=${TOKEN}`, {
    method: 'DELETE'
  });
  return res.json();
}

async function uploadVideo(filePath, title) {
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  form.set('access_token', TOKEN);
  form.set('title', title);
  form.set('source', new Blob([buf], { type: 'video/mp4' }), path.basename(filePath));

  const res = await fetch(`https://graph-video.facebook.com/v21.0/${AD_ACCOUNT_ID}/advideos`, {
    method: 'POST',
    body: form
  });
  return res.json();
}

async function uploadImage(filePath) {
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  form.set('access_token', TOKEN);
  form.set('filename', new Blob([buf], { type: 'image/jpeg' }), path.basename(filePath));

  const res = await fetch(`https://graph.facebook.com/v21.0/${AD_ACCOUNT_ID}/adimages`, {
    method: 'POST',
    body: form
  });
  return res.json();
}

async function waitForVideoReady(videoId) {
  for (let i = 0; i < 24; i++) {
    const st = await graphGet(`${videoId}?fields=status`);
    const vStatus = st?.status?.video_status;
    console.log(`  Video ${videoId} status [${i + 1}/24]: ${vStatus}`);
    if (vStatus === 'ready') return true;
    if (vStatus === 'error') throw new Error(`Video ${videoId} failed processing: ${JSON.stringify(st)}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

(async () => {
  console.log('=== 1. Updating Campaign & Ad Set for 9:16 Reels / Stories / Mobile Feed ===');
  await graphPost(CAMPAIGN_ID, {
    name: '[TEST] PayPal Donate - Junie 9:16 Videos (19/20/21) - US - ABO'
  });

  // Configure 9:16 vertical + high-ROAS mobile feed placements (excluding desktop right column, marketplace, audience network, explore)
  const targeting916 = {
    geo_locations: {
      countries: ['US'],
      location_types: ['home', 'recent']
    },
    age_min: 18,
    age_max: 65,
    device_platforms: ['mobile'],
    publisher_platforms: ['facebook', 'instagram'],
    facebook_positions: ['facebook_reels', 'story', 'feed', 'profile_feed', 'instream_video'],
    instagram_positions: ['reels', 'story', 'stream'],
    targeting_automation: {
      advantage_audience: 1
    }
  };

  let adsetUpdate = await graphPost(ADSET_ID, {
    name: '$50/day - US - 9:16 Vertical (Reels/Stories/Mobile Feed) - PayPal Donate',
    promoted_object: {
      pixel_id: PIXEL_ID,
      custom_event_type: 'DONATE'
    },
    targeting: targeting916
  });

  if (adsetUpdate.error) {
    console.warn('Primary 9:16 placement spec returned error, trying without profile_feed/instream_video:', adsetUpdate.error.message);
    targeting916.facebook_positions = ['facebook_reels', 'story', 'feed'];
    adsetUpdate = await graphPost(ADSET_ID, {
      name: '$50/day - US - 9:16 Vertical (Reels/Stories/Mobile Feed) - PayPal Donate',
      promoted_object: {
        pixel_id: PIXEL_ID,
        custom_event_type: 'DONATE'
      },
      targeting: targeting916
    });
  }
  console.log('Ad Set update response:', JSON.stringify(adsetUpdate));

  console.log('\n=== 2. Uploading Videos 19, 20, 21 & Junie Keyframe Thumbnails ===');
  const prepared = [];
  for (const item of VIDEOS) {
    let videoId = item.existingVideoId;
    if (!videoId) {
      console.log(`Uploading ${item.videoPath}...`);
      const up = await uploadVideo(item.videoPath, `Junie Surgery Appeal - Video ${item.num} (9:16)`);
      console.log(`Upload response (${item.num}):`, JSON.stringify(up));
      if (!up.id) throw new Error(`Failed to upload video ${item.num}: ${JSON.stringify(up)}`);
      videoId = up.id;
    } else {
      console.log(`Reusing uploaded Video ${item.num}: ${videoId}`);
    }

    await waitForVideoReady(videoId);

    console.log(`Uploading Junie thumbnail for Video ${item.num} (${item.thumbPath})...`);
    const imgUp = await uploadImage(item.thumbPath);
    const firstKey = Object.keys(imgUp.images || {})[0];
    const imageHash = imgUp.images?.[firstKey]?.hash;
    console.log(`Thumbnail hash (${item.num}): ${imageHash}`);
    if (!imageHash) throw new Error(`Failed to upload thumbnail for video ${item.num}: ${JSON.stringify(imgUp)}`);

    prepared.push({ ...item, videoId, imageHash });
  }

  console.log('\n=== 3. Removing Old Single Test Ad (if present) ===');
  if (OLD_AD_ID) {
    const del = await graphPost(OLD_AD_ID, { status: 'DELETED' });
    console.log(`Deleted old ad ${OLD_AD_ID}:`, JSON.stringify(del));
  }

  console.log('\n=== 4. Creating 3 Ad Creatives & 3 PAUSED Ads ===');
  const createdAds = [];
  for (const item of prepared) {
    const targetUrl = `https://paypal.risehope.online/?utm_source=fb&utm_medium=paid&utm_campaign=${CAMPAIGN_ID}&utm_content=${item.key}`;

    const buildVideoSpec = (ctaType) => ({
      page_id: PAGE_ID,
      instagram_user_id: IG_USER_ID,
      video_data: {
        video_id: item.videoId,
        image_hash: item.imageHash,
        title: item.headline,
        link_description: item.description,
        message: item.message,
        call_to_action: {
          type: ctaType,
          value: { link: targetUrl }
        }
      }
    });

    let usedCta = 'DONATE_NOW';
    let crRes = await graphPost(`${AD_ACCOUNT_ID}/adcreatives`, {
      name: `Creative - ${item.label} - ${new Date().toISOString().slice(0, 10)}`,
      object_story_spec: buildVideoSpec('DONATE_NOW')
    });

    if (!crRes.id) {
      console.warn(`DONATE_NOW failed for Video ${item.num}, falling back to LEARN_MORE:`, crRes.error?.message);
      usedCta = 'LEARN_MORE';
      crRes = await graphPost(`${AD_ACCOUNT_ID}/adcreatives`, {
        name: `Creative - ${item.label} - ${new Date().toISOString().slice(0, 10)}`,
        object_story_spec: buildVideoSpec('LEARN_MORE')
      });
    }
    if (!crRes.id) throw new Error(`Failed creative creation for Video ${item.num}: ${JSON.stringify(crRes)}`);

    const adRes = await graphPost(`${AD_ACCOUNT_ID}/ads`, {
      name: `Ad #${item.num} - ${item.label}`,
      adset_id: ADSET_ID,
      creative: { creative_id: crRes.id },
      status: 'PAUSED',
      tracking_specs: [
        {
          'action.type': ['offsite_conversion'],
          fb_pixel: [PIXEL_ID]
        }
      ]
    });
    if (!adRes.id) throw new Error(`Failed ad creation for Video ${item.num}: ${JSON.stringify(adRes)}`);

    console.log(`Created Ad #${item.num}: ad_id=${adRes.id}, creative_id=${crRes.id}, video_id=${item.videoId}, cta=${usedCta}`);
    createdAds.push({
      videoNum: item.num,
      label: item.label,
      videoId: item.videoId,
      imageHash: item.imageHash,
      creativeId: crRes.id,
      adId: adRes.id,
      cta: usedCta,
      targetUrl
    });
  }

  console.log('\n=== FINAL SUMMARY ===');
  console.log(JSON.stringify({
    adAccountId: AD_ACCOUNT_ID,
    pixelId: PIXEL_ID,
    campaignId: CAMPAIGN_ID,
    adsetId: ADSET_ID,
    ads: createdAds
  }, null, 2));
})().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
