(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function show(title, body, ref) {
    $('thanks-title').textContent = title;
    $('thanks-body').textContent = body;
    var refEl = $('thanks-ref');
    refEl.textContent = ref || '';
    refEl.hidden = !ref;
  }

  function money(amount, currency) {
    var n = parseFloat(amount);
    if (!Number.isFinite(n)) return '';
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(n);
    } catch (e) {
      return n.toFixed(2) + ' ' + (currency || '');
    }
  }

  var order = new URLSearchParams(window.location.search).get('order') || '';
  if (!/^[A-Z0-9]{10,30}$/.test(order)) {
    show('We could not find this donation', 'This page needs a valid donation reference. Nothing was charged by visiting it.');
    return;
  }

  fetch('/api/orders/' + encodeURIComponent(order) + '/status')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      var amount = money(data.amount, data.currency);
      if (data.status === 'COMPLETED') {
        show(
          'Thank you',
          amount
            ? 'Your donation of ' + amount + ' was received. PayPal will email you a receipt.'
            : 'Your donation was received. PayPal will email you a receipt.',
          'Reference: ' + (data.captureId || order)
        );
      } else if (data.status === 'PENDING') {
        show(
          'Your donation is being processed',
          'PayPal has not finished processing this payment yet. You will receive an email from PayPal when it is complete.',
          'Reference: ' + order
        );
      } else {
        show(
          'We could not confirm this donation',
          'PayPal does not show a completed payment for this reference. If you were charged, please contact the organizer.',
          'Reference: ' + order
        );
      }
    })
    .catch(function () {
      show('We could not check your donation', 'Please check your PayPal receipt email, or try reloading this page.', 'Reference: ' + order);
    });
})();
