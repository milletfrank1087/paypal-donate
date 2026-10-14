/**
 * User Agent Parser (ported from GFM New Cloaked)
 * Extracts device type, browser, OS, and in-app browser labels (FB app / IG app)
 * No external dependencies - uses regex patterns
 */

function parseUserAgent(userAgent) {
  if (!userAgent || typeof userAgent !== 'string') {
    return {
      deviceType: 'unknown',
      browser: 'unknown',
      os: 'unknown',
      isMobile: false,
      isTablet: false,
      isDesktop: false,
    };
  }

  const ua = userAgent.toLowerCase();

  const deviceType = detectDeviceType(ua);
  const browser = detectBrowser(ua);
  const os = detectOS(ua);

  return {
    deviceType,
    browser,
    os,
    isMobile: deviceType === 'mobile',
    isTablet: deviceType === 'tablet',
    isDesktop: deviceType === 'desktop',
  };
}

function detectDeviceType(ua) {
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
    return 'tablet';
  }
  if (
    /mobile|iphone|ipod|android|blackberry|opera mini|opera mobi|skyfire|maemo|windows phone|palm|iemobile|symbian|symbianos|fennec/i.test(
      ua
    )
  ) {
    return 'mobile';
  }
  return 'desktop';
}

function detectBrowser(ua) {
  if (ua.includes('edg/') || ua.includes('edge/')) return 'edge';
  if (ua.includes('opr/') || ua.includes('opera')) return 'opera';
  if (ua.includes('chrome') || ua.includes('crios')) return 'chrome';
  if (ua.includes('safari') && !ua.includes('chrome')) return 'safari';
  if (ua.includes('firefox') || ua.includes('fxios')) return 'firefox';
  if (ua.includes('msie') || ua.includes('trident/')) return 'ie';
  if (ua.includes('samsung')) return 'samsung';
  return 'other';
}

function detectOS(ua) {
  if (ua.includes('windows phone')) return 'windows phone';
  if (ua.includes('windows') || ua.includes('win32') || ua.includes('win64'))
    return 'windows';
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod'))
    return 'ios';
  if (ua.includes('mac os') || ua.includes('macintosh')) return 'macos';
  if (ua.includes('android')) return 'android';
  if (ua.includes('linux')) return 'linux';
  if (ua.includes('cros')) return 'chromeos';
  return 'other';
}

// "Android FB app", "iOS IG app", "desktop": same labels as GFM New Cloaked store & campaign logs
function deviceLabel(ua) {
  ua = String(ua || '');
  const os = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
    ? 'Android'
    : ua
    ? 'desktop'
    : '?';
  const app = /FBAN|FBAV|FB_IAB|FBIOS/.test(ua)
    ? ' FB app'
    : /Instagram/.test(ua)
    ? ' IG app'
    : '';
  return os + app;
}

module.exports = {
  parseUserAgent,
  deviceLabel,
};
