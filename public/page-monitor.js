// Combined PageMonitor + CheckoutMonitor (ported from GFM New Cloaked campaign/public/js/page-monitor.js & store/public/js/checkout-monitor.js)
// Reports (1) browser-side JS/promise/resource errors to /api/client/error and
// (2) checkout stage progression & unpaid exits to /api/client/report.
(function () {
  var ERROR_ENDPOINT = '/api/client/error';
  var REPORT_ENDPOINT = '/api/client/report';
  var ORDER = [
    'page_loaded',
    'form_loading',
    'form_ready',
    'email',
    'card_typing',
    'card_complete',
    'pay_tapped',
    'declined',
    'paid',
  ];
  var furthest = 'page_loaded';
  var paid = false;
  var sentExit = false;
  var sentErrors = {};
  var errorCount = 0;
  var startedAt = Date.now();

  function send(endpoint, payload, contentType) {
    var body = JSON.stringify(payload);
    try {
      if (
        navigator.sendBeacon &&
        navigator.sendBeacon(
          endpoint,
          new Blob([body], { type: contentType || 'application/json' })
        )
      ) {
        return;
      }
    } catch (_) {}
    try {
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': contentType || 'application/json' },
        body: body,
        keepalive: true,
      }).catch(function () {});
    } catch (_) {}
  }

  function stage(name) {
    if (name === 'paid') {
      paid = true;
      furthest = 'paid';
      return;
    }
    if (ORDER.indexOf(name) > ORDER.indexOf(furthest)) {
      furthest = name;
    }
  }

  function error(kind, message, extra) {
    var msg = String(message || '').slice(0, 300);
    if (!msg) return;
    if (
      /^Script error\.?$|ResizeObserver loop|chrome-extension:|moz-extension:|safari-extension:|webkit-masked-url/i.test(
        msg + ' ' + ((extra && extra.src) || '')
      )
    ) {
      return;
    }
    var key = kind + '|' + msg;
    if (sentErrors[key] || errorCount >= 15) return;
    sentErrors[key] = 1;
    errorCount += 1;
    send(
      ERROR_ENDPOINT,
      {
        kind: kind,
        msg: msg,
        src: extra && extra.src ? String(extra.src).slice(0, 200) : '',
        line: (extra && extra.line) || 0,
        code: extra && extra.code != null ? String(extra.code).slice(0, 60) : '',
        stage: furthest,
        ms: (extra && extra.ms) || null,
        secs: Math.round((Date.now() - startedAt) / 1000),
      },
      'text/plain'
    );
  }

  window.addEventListener(
    'error',
    function (e) {
      if (e.target && e.target !== window && (e.target.src || e.target.href)) {
        error(
          'resource',
          'failed to load ' + (e.target.tagName || '').toLowerCase(),
          { src: e.target.src || e.target.href }
        );
        return;
      }
      error('js', e.message, { src: e.filename, line: e.lineno });
    },
    true
  );

  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    error('promise', r && r.message ? r.message : String(r), {
      src: r && r.stack ? String(r.stack).split('\n')[1] : '',
    });
  });

  function reportExit() {
    if (paid || sentExit || furthest === 'page_loaded') return;
    sentExit = true;
    send(REPORT_ENDPOINT, {
      t: 'exit',
      stage: furthest,
      secs: Math.round((Date.now() - startedAt) / 1000),
    });
  }

  window.addEventListener('pagehide', reportExit);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden' && furthest !== 'pay_tapped') {
      reportExit();
    }
  });

  var attempts = 0;
  function attempt(result, ms, orderId, extra) {
    if (attempts >= 10) return;
    attempts += 1;
    extra = extra || {};
    send(REPORT_ENDPOINT, {
      t: 'attempt',
      result: result,
      ms: Math.round(ms || 0),
      orderId: orderId || '',
      method: extra.method || 'card',
      decline_code: extra.decline_code || '',
      code: extra.code || '',
      error_type: extra.error_type || '',
    });
  }

  window.PageMonitor = { error: error };
  window.CheckoutMonitor = {
    stage: stage,
    error: error,
    attempt: attempt,
    getStage: function () {
      return furthest;
    },
  };
})();
