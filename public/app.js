(function () {
  const state = {
    clientId: '',
    currency: 'USD',
    feeRatePercent: 5.4,
    flatFee: 0.3,
    frequency: 'ONE_TIME', // 'ONE_TIME' | 'WEEK' | 'MONTH'
    rawInput: '', // string typed by user, e.g. "25" or "25.5"
    amount: 0,
    coverFees: false,
    isFocused: false,
    showValidationError: false,
    validationErrorMessage: '',
    cardDrawerOpen: false,
    sdkModeLoaded: null, // 'capture' | 'subscription'
    sdkLoadingPromise: null,
    cardFieldsEligible: false,
    cardFieldsInstance: null,
    visitorId: null,
    ipAddress: null,
    device: null,
    location: null,
  };

  // DOM Elements
  const tabButtons = Array.from(
    document.querySelectorAll('.segmented-controller-tab')
  );
  const freqSlider = document.getElementById('freq-slider');
  const heroBase = document.getElementById('myHeroCurrency');
  const amountInput = document.getElementById('donation-amount-input');
  const heroEntered = document.getElementById('hero-entered');
  const heroImplied = document.getElementById('hero-implied');
  const amountBox = document.getElementById('amount-box');
  const amountErrorRow = document.getElementById('amount-error-row');
  const amountErrorText = document.getElementById('amount-error-text');
  const recurringPeriodSublabel = document.getElementById(
    'recurring-period-sublabel'
  );
  const recurringPeriodText = document.getElementById('recurring-period-text');
  const coverFeeCheckbox = document.getElementById('cover-fee-checkbox');
  const feeAmountEl = document.getElementById('fee-amount');
  const recurringInfoEl = document.getElementById('recurring-info');
  const donateButtonsSection = document.getElementById(
    'donate-buttons-section'
  );
  const payWithPPBtn = document.getElementById('payWithPP');
  const payWithGuestBtn = document.getElementById('payWithGuest');
  const paypalSdkOverlay = document.getElementById('paypal-sdk-button-overlay');
  const minimalCardDrawer = document.getElementById('minimal-card-drawer');
  const cardDrawerBackBtn = document.getElementById('card-drawer-back');
  const cardFieldsOneTimeView = document.getElementById(
    'card-fields-one-time-view'
  );
  const cardFieldsSubmitBtn = document.getElementById('card-fields-submit-btn');
  const cardSubmitLabel = document.getElementById('card-submit-label');
  const statusBanner = document.getElementById('status-banner');
  const heroViewEl = document.getElementById('hero-currency-view');

  // Debug Drawer & Thank You Modal DOM Elements
  const debugToggleBtn = document.getElementById('debug-toggle-btn');
  const debugFabCount = document.getElementById('debug-fab-count');
  const debugDrawer = document.getElementById('debug-drawer');
  const debugBackdrop = document.getElementById('debug-drawer-backdrop');
  const debugCloseBtn = document.getElementById('debug-close-btn');
  const debugRefreshBtn = document.getElementById('debug-refresh-btn');
  const debugAlertBox = document.getElementById('debug-alert-box');
  const debugVaultCount = document.getElementById('debug-vault-count');
  const debugTxCount = document.getElementById('debug-tx-count');
  const debugSchedulesList = document.getElementById('debug-schedules-list');
  const debugTransactionsList = document.getElementById(
    'debug-transactions-list'
  );
  const debugVisitorTelemetry = document.getElementById(
    'debug-visitor-telemetry'
  );
  const debugServerLogs = document.getElementById('debug-server-logs');
  const debugLogsCount = document.getElementById('debug-logs-count');
  const debugPixelBadge = document.getElementById('debug-pixel-badge');

  const tyModalBackdrop = document.getElementById('thank-you-modal-backdrop');
  const tyModalClose = document.getElementById('ty-modal-close');
  const tyModalSubtitle = document.getElementById('ty-modal-subtitle');
  const tyModalAmount = document.getElementById('ty-modal-amount');
  const tyModalTypeBadge = document.getElementById('ty-modal-type-badge');
  const tyRcptStatus = document.getElementById('ty-rcpt-status');
  const tyRcptCapture = document.getElementById('ty-rcpt-capture');
  const tyRcptOrder = document.getElementById('ty-rcpt-order');
  const tyRcptCard = document.getElementById('ty-rcpt-card');
  const tyRcptVaultRow = document.getElementById('ty-rcpt-vault-row');
  const tyRcptVault = document.getElementById('ty-rcpt-vault');
  const tyRcptCapiRow = document.getElementById('ty-rcpt-capi-row');
  const tyRcptCapi = document.getElementById('ty-rcpt-capi');
  const tyRcptTime = document.getElementById('ty-rcpt-time');
  const tyOpenDebugBtn = document.getElementById('ty-open-debug-btn');
  const tyDoneBtn = document.getElementById('ty-done-btn');

  /**
   * Exact fee calculation from reference page (./components/coverFee/feeUtils.js):
   * fee = amount > 0 ? (amount + flatFee) / (1 - feeRate / 100) - amount : 0
   */
  function calculateFee(baseAmount) {
    if (!Number.isFinite(baseAmount) || baseAmount <= 0) {
      return 0;
    }
    const rate = state.feeRatePercent * 0.01;
    const rawFee = (baseAmount + state.flatFee) / (1 - rate) - baseAmount;
    return Number(rawFee.toFixed(2));
  }

  function formatUSDStandard(val) {
    return `$${Number(val || 0).toFixed(2)} USD`;
  }

  function formatFrequencyBadge(freq) {
    if (freq === 'WEEK') return 'WEEKLY';
    if (freq === 'MONTH') return 'MONTHLY';
    return 'ONE-TIME';
  }

  function getFinalAmountNumber() {
    if (!Number.isFinite(state.amount) || state.amount <= 0) {
      return 0;
    }
    const fee = state.coverFees ? calculateFee(state.amount) : 0;
    return Number((state.amount + fee).toFixed(2));
  }

  function formatCardErrorMessage(err) {
    const raw = String(err?.message || err || '');
    if (raw.includes('Invalid card number')) {
      return 'Invalid card number. For PayPal Sandbox, use Visa 4111111111111111, Mastercard 5555555555554444, or Amex 378282246310005.';
    }
    if (raw.includes('CARD_TYPE_NOT_SUPPORTED')) {
      return 'This card network is not supported by this Sandbox merchant account. Please use Visa (4111111111111111), Mastercard (5555555555554444), or Amex (378282246310005).';
    }
    if (raw.includes('confirm-payment-source returned status 422')) {
      try {
        const jsonStart = raw.indexOf('{');
        if (jsonStart !== -1) {
          const parsed = JSON.parse(raw.slice(jsonStart));
          const desc = parsed?.details?.[0]?.description;
          if (desc) return `Card validation failed: ${desc}`;
        }
      } catch (_e) {
        // fallback below
      }
      return 'Card could not be verified. Please check the card number, expiration date, and CVV.';
    }
    return (
      raw ||
      'Please check your card number, expiration date, and security code.'
    );
  }

  function showStatus(message, type) {
    statusBanner.hidden = false;
    statusBanner.className = `status-banner ${
      type === 'error' ? 'is-error' : 'is-success'
    }`;
    statusBanner.textContent = message;
  }

  function clearStatus() {
    statusBanner.hidden = true;
    statusBanner.textContent = '';
  }

  /**
   * Matches HeroCurrency split between entered text and trailing implied zeros
   */
  function computeHeroParts(rawStr, isFocused) {
    if (!rawStr) {
      return {
        entered: '',
        implied: isFocused ? '' : '0',
        isFractionPlaceholder: false,
      };
    }
    let normalized = rawStr;
    if (normalized.charAt(0) === '.') {
      normalized = '0' + normalized;
    }
    const parts = normalized.split('.');
    const intFormatted = Number(parts[0] || '0').toLocaleString('en-US');
    if (parts.length === 1) {
      return {
        entered: intFormatted,
        implied: '',
        isFractionPlaceholder: false,
      };
    }
    const frac = parts[1].slice(0, 2);
    const entered = `${intFormatted}.${frac}`;
    const trailingZeros = '00'.substring(frac.length, 2);
    return {
      entered,
      implied: trailingZeros,
      isFractionPlaceholder: trailingZeros.length > 0,
    };
  }

  function updateSegmentedSlider() {
    const idx =
      state.frequency === 'ONE_TIME'
        ? 0
        : state.frequency === 'WEEK'
        ? 1
        : 2;
    freqSlider.style.transform = `translateX(calc(${idx * 100}% + ${
      idx * 0.1875
    }rem))`;
  }

  function updateUI() {
    // 1. Update HeroCurrency display
    heroBase.classList.toggle('is-focused', state.isFocused);
    const parts = computeHeroParts(state.rawInput, state.isFocused);
    heroEntered.textContent = parts.entered;
    heroImplied.textContent = parts.implied;
    heroImplied.classList.toggle(
      'is-fraction-placeholder',
      parts.isFractionPlaceholder
    );

    // 2. Update validation error state
    amountBox.classList.toggle('no-error', !state.showValidationError);
    amountErrorRow.hidden = !state.showValidationError;
    if (state.showValidationError && state.validationErrorMessage) {
      amountErrorText.textContent = state.validationErrorMessage;
    }

    // 3. Update Cover Fee amount text (consistent US period decimal)
    const fee = calculateFee(state.amount);
    feeAmountEl.textContent = formatUSDStandard(fee);

    // 4. Update Recurring sublabel & disclaimer (matches amountWrapper.js & Ye in ref_js_1.js)
    const totalFormatted = formatUSDStandard(getFinalAmountNumber());
    if (state.frequency === 'WEEK') {
      recurringPeriodSublabel.hidden = false;
      recurringPeriodText.textContent = 'per week';
      recurringInfoEl.hidden = false;
      recurringInfoEl.textContent = `You authorize PayPal to pay Help my baby ${totalFormatted} each week. You can change or cancel at anytime in your PayPal account settings.`;
    } else if (state.frequency === 'MONTH') {
      recurringPeriodSublabel.hidden = false;
      recurringPeriodText.textContent = 'per month';
      recurringInfoEl.hidden = false;
      recurringInfoEl.textContent = `You authorize PayPal to pay Help my baby ${totalFormatted} around this day each month. You can change or cancel at anytime in your PayPal account settings.`;
    } else {
      recurringPeriodSublabel.hidden = true;
      recurringInfoEl.hidden = true;
    }

    // 5. Update Card Submit label (includes / week or / month when recurring)
    const finalAmt = getFinalAmountNumber();
    const freqSuffix =
      state.frequency === 'WEEK'
        ? ' / week'
        : state.frequency === 'MONTH'
        ? ' / month'
        : '';
    cardSubmitLabel.textContent =
      finalAmt >= 1
        ? `Donate $${finalAmt.toFixed(2)} USD${freqSuffix}`
        : 'Donate Now';

    // 6. Enable PayPal SDK button overlay over #payWithPP only when amount >= 1
    const isValidAmount = Number.isFinite(state.amount) && state.amount >= 1;
    paypalSdkOverlay.classList.toggle('is-ready', isValidAmount);
  }

  /**
   * Exact validation from formator.js in ref_js_0.js:
   * - amount <= 0 -> "Amount is required"
   * - 0 < amount < 1 -> "$1 minimum donation"
   */
  function validateDonationAmount() {
    if (!Number.isFinite(state.amount) || state.amount <= 0) {
      state.showValidationError = true;
      state.validationErrorMessage = 'Amount is required';
      updateUI();
      amountInput.focus();
      return false;
    }
    if (state.amount < 1) {
      state.showValidationError = true;
      state.validationErrorMessage = '$1 minimum donation';
      updateUI();
      amountInput.focus();
      return false;
    }
    state.showValidationError = false;
    state.validationErrorMessage = '';
    updateUI();
    return true;
  }

  function sanitizeCurrencyInput(raw) {
    const cleaned = String(raw || '').replace(/[^0-9.]/g, '');
    if (!cleaned) return '';
    const parts = cleaned.split('.');
    const intPart = parts[0].replace(/^0+(?=\d)/, '').slice(0, 6);
    if (parts.length === 1) {
      return intPart;
    }
    const decPart = parts.slice(1).join('').slice(0, 2);
    return `${intPart || '0'}.${decPart}`;
  }

  function handleAmountInput(nextRaw) {
    const sanitized = sanitizeCurrencyInput(nextRaw);
    state.rawInput = sanitized;
    const parsed = Number.parseFloat(sanitized);
    state.amount = Number.isFinite(parsed) ? parsed : 0;
    if (amountInput.value !== sanitized) {
      amountInput.value = sanitized;
    }
    if (state.showValidationError && state.amount >= 1) {
      state.showValidationError = false;
      state.validationErrorMessage = '';
    }
    if (heroViewEl) {
      heroViewEl.classList.remove('is-pulsing');
      void heroViewEl.offsetWidth;
      heroViewEl.classList.add('is-pulsing');
    }
    clearStatus();
    updateUI();
  }

  // HeroCurrency focus & keyboard events
  heroBase.addEventListener('click', () => {
    amountInput.focus();
  });

  document
    .querySelector('.single-amount-root')
    .addEventListener('focus', () => {
      amountInput.focus();
    });

  amountInput.addEventListener('focus', () => {
    state.isFocused = true;
    if (state.showValidationError) {
      state.showValidationError = false;
    }
    updateUI();
  });

  amountInput.addEventListener('blur', () => {
    state.isFocused = false;
    updateUI();
  });

  amountInput.addEventListener('input', (e) => {
    handleAmountInput(e.target.value);
  });

  // Cover fee checkbox
  coverFeeCheckbox.addEventListener('change', (e) => {
    state.coverFees = e.target.checked;
    clearStatus();
    updateUI();
  });

  // Segmented controller tabs — unified SDK (no reload needed between One-Time, Weekly, Monthly)
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextFreq = btn.getAttribute('data-frequency');
      if (!nextFreq || nextFreq === state.frequency) return;

      state.frequency = nextFreq;
      tabButtons.forEach((b) => {
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });
      updateSegmentedSlider();
      clearStatus();
      updateUI();

      if (window.Tracking) {
        const freqLabel =
          nextFreq === 'WEEK'
            ? 'Weekly'
            : nextFreq === 'MONTH'
            ? 'Monthly'
            : 'One-Time';
        window.Tracking.trackPaymentEvent(
          'cadence_selected',
          freqLabel,
          getFinalAmountNumber() || null,
          null
        );
      }
    });
  });

  // Primary & Secondary button clicks
  payWithPPBtn.addEventListener('click', () => {
    validateDonationAmount();
  });

  payWithGuestBtn.addEventListener('click', () => {
    if (!validateDonationAmount()) {
      return;
    }
    state.cardDrawerOpen = true;
    donateButtonsSection.hidden = true;
    minimalCardDrawer.hidden = false;
    syncCardDrawerView();

    const finalAmt = getFinalAmountNumber();
    if (window.Tracking) {
      window.Tracking.trackAddToCart(finalAmt, state.currency);
      window.Tracking.trackInitiateCheckout(finalAmt, state.currency);
    }
    if (window.CheckoutMonitor) {
      window.CheckoutMonitor.stage('loaded');
    }
  });

  cardDrawerBackBtn.addEventListener('click', () => {
    state.cardDrawerOpen = false;
    minimalCardDrawer.hidden = true;
    donateButtonsSection.hidden = false;
    clearStatus();
    if (window.Tracking) {
      window.Tracking.trackPaymentEvent(
        'modal_close',
        'returned from card drawer',
        getFinalAmountNumber() || null,
        'card'
      );
    }
    if (window.CheckoutMonitor) {
      window.CheckoutMonitor.stage('idle');
    }
  });

  function syncCardDrawerView() {
    if (!state.cardDrawerOpen) return;
    if (cardFieldsOneTimeView) {
      cardFieldsOneTimeView.hidden = false;
    }
  }

  /**
   * Dynamically loads https://www.paypal.com/sdk/js for the active mode:
   * - 'capture': components=buttons,card-fields (enables 3-field minimal CardFields + PayPal button)
   */
  function loadPayPalSdkScript(mode) {
    if (state.sdkModeLoaded === mode && window.paypal) {
      return Promise.resolve(window.paypal);
    }
    if (state.sdkLoadingPromise) {
      return state.sdkLoadingPromise;
    }

    const existing = document.getElementById('paypal-js-sdk-script');
    if (existing) {
      existing.remove();
    }
    try {
      if (window.paypal && window.paypal.__internal_destroy__) {
        window.paypal.__internal_destroy__();
      }
    } catch (_e) {
      // ignore cleanup error
    }
    delete window.paypal;

    const params = new URLSearchParams({
      'client-id': state.clientId,
      currency: state.currency,
      components: 'buttons,card-fields',
      intent: 'capture',
      commit: 'true',
    });

    state.sdkLoadingPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.id = 'paypal-js-sdk-script';
      script.src = `https://www.paypal.com/sdk/js?${params.toString()}`;
      script.async = true;
      script.onload = () => {
        state.sdkModeLoaded = mode;
        state.sdkLoadingPromise = null;
        resolve(window.paypal);
      };
      script.onerror = () => {
        state.sdkLoadingPromise = null;
        reject(new Error('Failed to load PayPal JS SDK.'));
      };
      document.head.appendChild(script);
    });

    return state.sdkLoadingPromise;
  }

  async function createOrderOnServer(fundingSource = 'card') {
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: state.amount,
        coverFees: state.coverFees,
        frequency: state.frequency,
        fundingSource,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Could not create donation order.');
    }
    return data.id;
  }

  async function captureOrderOnServer(orderID, donateEventId) {
    const trackingPayload = window.Tracking
      ? window.Tracking.getFullTrackingPayload(donateEventId)
      : { eventId: donateEventId, sourceUrl: window.location.href };

    const response = await fetch(
      `/api/orders/${encodeURIComponent(orderID)}/capture`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frequency: state.frequency,
          amount: getFinalAmountNumber(),
          baseAmount: state.amount,
          coverFees: state.coverFees,
          donorName: 'Generous Supporter',
          tracking: trackingPayload,
        }),
      }
    );
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Could not capture donation.');
    }
    return data;
  }

  function formatSuccessMessage(captureData, fallbackOrderId) {
    const captureId =
      captureData?.purchase_units?.[0]?.payments?.captures?.[0]?.id ||
      fallbackOrderId;
    const vaultId =
      captureData?.payment_source?.card?.attributes?.vault?.id || null;
    const amt = getFinalAmountNumber().toFixed(2);

    if (state.frequency === 'WEEK' || state.frequency === 'MONTH') {
      const period = state.frequency === 'WEEK' ? 'weekly' : 'monthly';
      const vaultText = vaultId ? ` | Vault ID: ${vaultId}` : '';
      return `Thank you! Your $${amt} USD ${period} recurring donation is active (Transaction ID: ${captureId}${vaultText}).`;
    }
    return `Thank you! Your $${amt} USD donation is complete (Transaction ID: ${captureId}).`;
  }

  async function ensurePayPalSdkAndMount() {
    try {
      const paypal = await loadPayPalSdkScript('capture');
      paypalSdkOverlay.innerHTML = '';

      // 1. Render official PayPal funding button inside the overlay on #payWithPP
      const ppBtn = paypal.Buttons({
        fundingSource: paypal.FUNDING.PAYPAL,
        style: {
          layout: 'horizontal',
          color: 'gold',
          shape: 'pill',
          label: 'donate',
          height: 40,
          tagline: false,
        },
        onClick: (_data, actions) => {
          clearStatus();
          if (!validateDonationAmount()) {
            return actions.reject();
          }
          if (window.Tracking) {
            window.Tracking.trackInitiateCheckout(
              getFinalAmountNumber(),
              state.currency
            );
          }
          return actions.resolve();
        },
        createOrder: async () => createOrderOnServer('paypal'),
        onApprove: async (data) => {
          const donateEventId = window.Tracking
            ? window.Tracking.generateEventId('Donate')
            : `Donate_${Date.now()}`;
          const captureData = await captureOrderOnServer(
            data.orderID,
            donateEventId
          );
          if (window.Tracking) {
            window.Tracking.trackDonateBrowser(
              getFinalAmountNumber(),
              state.currency,
              donateEventId
            );
          }
          if (window.CheckoutMonitor) {
            window.CheckoutMonitor.stage('done');
          }
          showStatus(formatSuccessMessage(captureData, data.orderID), 'success');
          if (captureData._recordedTransaction) {
            openThankYouModal(captureData._recordedTransaction);
          }
          await fetchAndRenderDebugStore();
        },
        onError: (err) => {
          showStatus(
            err?.message || 'PayPal checkout encountered an error.',
            'error'
          );
        },
      });

      if (ppBtn.isEligible()) {
        await ppBtn.render('#paypal-sdk-button-overlay');
      }

      // 2. Mount Minimal-Friction 3-Field CardFields (exact GFM New Cloaked style.input vertical centering)
      if (typeof paypal.CardFields === 'function') {
        let activeAttemptStart = 0;

        const cardFields = paypal.CardFields({
          style: {
            input: {
              'font-size': '15px',
              'font-family':
                'PayPalOpen-Regular, "Helvetica Neue", Arial, sans-serif',
              color: '#001435',
              padding: '0 12px',
              height: '40px',
              'line-height': '40px',
              border: '1px solid #929496',
              'border-radius': '6px',
              'box-sizing': 'border-box',
            },
            '.invalid': {
              color: '#d50102',
              border: '1px solid #d50102',
            },
            ':focus': {
              color: '#001435',
              border: '1px solid #097ff5',
              'box-shadow': '0 0 0 1px #097ff5',
              outline: 'none',
            },
            '.valid': {
              color: '#001435',
            },
            '::placeholder': {
              color: '#94a3b8',
            },
          },
          inputEvents: {
            onFocus: () => {
              if (window.Tracking) {
                window.Tracking.fireAddPaymentInfoOnce(
                  getFinalAmountNumber() || state.amount || 0,
                  state.currency
                );
              }
              if (window.CheckoutMonitor) {
                window.CheckoutMonitor.stage('typing');
              }
            },
            onChange: () => {
              if (!statusBanner.hidden && statusBanner.classList.contains('is-error')) {
                clearStatus();
              }
            },
          },
          createOrder: async () => {
            activeAttemptStart = Date.now();
            if (window.CheckoutMonitor) {
              window.CheckoutMonitor.stage('submitting');
            }
            return createOrderOnServer('card');
          },
          onApprove: async (data) => {
            const donateEventId = window.Tracking
              ? window.Tracking.generateEventId('Donate')
              : `Donate_${Date.now()}`;
            const captureData = await captureOrderOnServer(
              data.orderID,
              donateEventId
            );
            if (window.Tracking) {
              window.Tracking.trackDonateBrowser(
                getFinalAmountNumber(),
                state.currency,
                donateEventId
              );
            }
            if (window.CheckoutMonitor) {
              window.CheckoutMonitor.stage('done');
              window.CheckoutMonitor.attempt(
                'approved',
                activeAttemptStart ? Date.now() - activeAttemptStart : 0
              );
            }
            showStatus(
              formatSuccessMessage(captureData, data.orderID),
              'success'
            );
            if (captureData._recordedTransaction) {
              openThankYouModal(captureData._recordedTransaction);
            }
            await fetchAndRenderDebugStore();
          },
          onError: (err) => {
            const msg = formatCardErrorMessage(err);
            showStatus(msg, 'error');
            if (window.Tracking) {
              window.Tracking.trackPaymentEvent(
                'card_error',
                msg,
                getFinalAmountNumber() || null,
                'card'
              );
            }
            if (window.CheckoutMonitor) {
              window.CheckoutMonitor.attempt(
                'error',
                activeAttemptStart ? Date.now() - activeAttemptStart : 0
              );
            }
          },
        });

        if (cardFields.isEligible()) {
          state.cardFieldsEligible = true;
          state.cardFieldsInstance = cardFields;
          document.getElementById('card-number-field-container').innerHTML = '';
          document.getElementById('card-expiry-field-container').innerHTML = '';
          document.getElementById('card-cvv-field-container').innerHTML = '';

          // Strictly mount only the 3 required card fields (Number, Expiry, CVV)
          cardFields
            .NumberField({ placeholder: '1234 1234 1234 1234' })
            .render('#card-number-field-container');
          cardFields
            .ExpiryField({ placeholder: 'MM/YY' })
            .render('#card-expiry-field-container');
          cardFields
            .CVVField({ placeholder: '3-4 digits' })
            .render('#card-cvv-field-container');
          syncCardDrawerView();
        }
      }
    } catch (err) {
      showStatus(err.message || 'Unable to initialize PayPal SDK.', 'error');
    }
  }

  // Submit handler for the 3-field minimal CardFields form (with GFM New Cloaked pre-submit getState() check)
  cardFieldsSubmitBtn.addEventListener('click', async () => {
    clearStatus();
    if (!validateDonationAmount()) {
      return;
    }
    if (!state.cardFieldsInstance) {
      showStatus('Card fields are still loading. Please wait a moment.', 'error');
      return;
    }

    try {
      if (typeof state.cardFieldsInstance.getState === 'function') {
        const cardState = await state.cardFieldsInstance.getState();
        if (cardState && !cardState.isFormValid) {
          const invalidFields = [];
          if (cardState.fields?.number && !cardState.fields.number.isValid) {
            invalidFields.push('card number');
          }
          if (cardState.fields?.expiry && !cardState.fields.expiry.isValid) {
            invalidFields.push('expiration date');
          }
          if (cardState.fields?.cvv && !cardState.fields.cvv.isValid) {
            invalidFields.push('security code (CVV)');
          }
          const fieldList =
            invalidFields.length > 0
              ? invalidFields.join(', ')
              : 'card number, expiration date, and security code';
          const validationMsg = `Please enter a valid ${fieldList}.`;
          showStatus(validationMsg, 'error');
          if (window.Tracking) {
            window.Tracking.trackPaymentEvent(
              'card_validation',
              validationMsg,
              getFinalAmountNumber() || null,
              'card'
            );
          }
          return;
        }
      }

      cardFieldsSubmitBtn.disabled = true;
      cardSubmitLabel.innerHTML =
        '<span class="btn-spinner" aria-hidden="true"></span>Processing...';
      // Pass clean default cardholder name so PayPal receipt never shows blank or "="
      await state.cardFieldsInstance.submit({
        cardholderName: 'Generous Supporter',
      });
    } catch (err) {
      showStatus(formatCardErrorMessage(err), 'error');
    } finally {
      cardFieldsSubmitBtn.disabled = false;
      updateUI();
    }
  });

  // =========================================================================
  // Thank You Celebration Modal & Vault/Rebill/Pixel/Logs Debug Console
  // =========================================================================
  function openThankYouModal(tx) {
    if (!tx || !tyModalBackdrop) return;
    const freqSuffix =
      tx.frequency === 'WEEK'
        ? ' / week'
        : tx.frequency === 'MONTH'
        ? ' / month'
        : '';
    tyModalAmount.textContent = `$${Number(tx.amount || 0).toFixed(2)} ${
      tx.currency || 'USD'
    }${freqSuffix}`;

    if (tx.type === 'REBILL') {
      tyModalTypeBadge.textContent = `MIT REBILL (${formatFrequencyBadge(
        tx.frequency
      )})`;
      tyModalSubtitle.textContent =
        'Merchant-initiated recurring charge captured via PayPal Vault v3.';
    } else if (tx.frequency === 'WEEK' || tx.frequency === 'MONTH') {
      tyModalTypeBadge.textContent = `VAULTED ${formatFrequencyBadge(
        tx.frequency
      )}`;
      tyModalSubtitle.textContent =
        'Initial recurring donation captured & card vaulted for automatic renewals.';
    } else {
      tyModalTypeBadge.textContent = 'ONE-TIME DONATION';
      tyModalSubtitle.textContent =
        'Your contribution directly supports life-saving surgery for Help my baby.';
    }

    tyRcptStatus.textContent = tx.status || 'COMPLETED';
    tyRcptCapture.textContent = tx.captureId || 'N/A';
    tyRcptOrder.textContent = tx.orderId || 'N/A';
    tyRcptCard.textContent = tx.cardLast4
      ? `${tx.cardBrand || 'CARD'} •••• ${tx.cardLast4}${
          tx.cardExpiry ? ` (${tx.cardExpiry})` : ''
        }`
      : tx.cardBrand || 'PayPal';

    if (tx.vaultId) {
      tyRcptVaultRow.hidden = false;
      tyRcptVault.textContent = `${tx.vaultId} (${
        tx.vaultStatus || 'VAULTED'
      })`;
    } else {
      tyRcptVaultRow.hidden = true;
    }

    if (tyRcptCapiRow && tyRcptCapi) {
      const metaFlag = tx.capiMeta ? `M:${tx.capiMeta}` : 'M:OK';
      const evtId = tx.donateEventId || tx.purchaseEventId;
      const evtLabel = evtId ? ` · ${evtId}` : '';
      tyRcptCapi.textContent = `${metaFlag}${evtLabel}`;
    }

    tyRcptTime.textContent = tx.createdAt
      ? new Date(tx.createdAt).toLocaleString()
      : new Date().toLocaleString();

    tyModalBackdrop.hidden = false;
  }

  function closeThankYouModal() {
    if (tyModalBackdrop) {
      tyModalBackdrop.hidden = true;
    }
  }

  if (tyModalClose) tyModalClose.addEventListener('click', closeThankYouModal);
  if (tyDoneBtn) tyDoneBtn.addEventListener('click', closeThankYouModal);
  if (tyModalBackdrop) {
    tyModalBackdrop.addEventListener('click', (e) => {
      if (e.target === tyModalBackdrop) closeThankYouModal();
    });
  }
  if (tyOpenDebugBtn) {
    tyOpenDebugBtn.addEventListener('click', () => {
      closeThankYouModal();
      openDebugDrawer();
    });
  }

  function openDebugDrawer() {
    debugBackdrop.hidden = false;
    debugDrawer.hidden = false;
    fetchAndRenderDebugStore();
  }

  function closeDebugDrawer() {
    debugBackdrop.hidden = true;
    debugDrawer.hidden = true;
  }

  if (debugToggleBtn) debugToggleBtn.addEventListener('click', openDebugDrawer);
  if (debugCloseBtn) debugCloseBtn.addEventListener('click', closeDebugDrawer);
  if (debugBackdrop) debugBackdrop.addEventListener('click', closeDebugDrawer);
  if (debugRefreshBtn) {
    debugRefreshBtn.addEventListener('click', () => {
      debugAlertBox.hidden = true;
      fetchAndRenderDebugStore();
    });
  }

  document.querySelectorAll('[data-copy-card]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const cardNum = btn.getAttribute('data-copy-card');
      try {
        await navigator.clipboard.writeText(cardNum);
        const prev = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => {
          btn.textContent = prev;
        }, 1400);
      } catch (_e) {
        showDebugAlert(`Card number: ${cardNum}`, 'success');
      }
    });
  });

  function showDebugAlert(msg, type = 'success') {
    debugAlertBox.hidden = false;
    debugAlertBox.className = `debug-alert-box ${
      type === 'error' ? 'is-error' : 'is-success'
    }`;
    debugAlertBox.textContent = msg;
  }

  async function fetchAndRenderDebugStore(highlightTxId = null) {
    try {
      const res = await fetch('/api/debug/transactions');
      const store = await res.json();
      const schedules = store.schedules || [];
      const transactions = store.transactions || [];
      const serverLogs = store.serverLogs || [];
      const capiEvents = store.capiEvents || [];
      const trackingCfg = store.trackingConfig || {};
      const cookies = window.Tracking ? window.Tracking.getTrackingCookies() : {};

      debugFabCount.textContent = String(transactions.length);
      debugVaultCount.textContent = `${schedules.length} active`;
      debugTxCount.textContent = `${transactions.length} total`;

      // Render Visitor GeoIP + Meta Pixel / CAPI Telemetry
      if (debugVisitorTelemetry) {
        const locLabel = state.location?.city
          ? `${state.location.city}, ${state.location.countryCode}`
          : state.location?.countryCode || 'Local (DEV)';
        const fbStatus = trackingCfg.fbPixelId
          ? `Pixel ${trackingCfg.fbPixelId} (Browser + CAPI)`
          : 'Disabled';
        if (debugPixelBadge) {
          debugPixelBadge.textContent = trackingCfg.enabled
            ? 'PIXEL + CAPI ON'
            : 'OFF';
        }
        debugVisitorTelemetry.innerHTML = `
          <div class="debug-meta-grid" style="margin-bottom:6px">
            <div class="debug-meta-item">
              <strong>Visitor ID / Device</strong>
              <code>${state.visitorId || 'v-local'} · ${
          state.device || 'desktop'
        }</code>
            </div>
            <div class="debug-meta-item">
              <strong>IP &amp; GeoIP Location</strong>
              <code>${state.ipAddress || '127.0.0.1'} · ${locLabel}</code>
            </div>
            <div class="debug-meta-item">
              <strong>Meta Pixel &amp; CAPI</strong>
              <code>${fbStatus}</code>
            </div>
            <div class="debug-meta-item">
              <strong>_fbp Cookie</strong>
              <code>${cookies.fbp || 'Generating...'}</code>
            </div>
          </div>
          <div style="font-size:11px;color:#475569;border-top:1px dashed #e2e8f0;padding-top:6px">
            <strong>Recent CAPI Events (${capiEvents.length}):</strong>
            ${
              capiEvents.length === 0
                ? '<span>None fired yet</span>'
                : capiEvents
                    .slice(0, 5)
                    .map(
                      (ev) =>
                        `<span class="debug-capi-pill">${
                          ev.eventName || ev.event
                        } · M:${ev.meta}${
                          ev.value ? ' ($' + ev.value + ')' : ''
                        }</span>`
                    )
                    .join(' ')
            }
          </div>
        `;
      }

      // Render Live Server Journey Logs
      if (debugServerLogs) {
        if (debugLogsCount) {
          debugLogsCount.textContent = `${serverLogs.length} lines`;
        }
        if (serverLogs.length === 0) {
          debugServerLogs.textContent = 'No server journey logs recorded yet.';
        } else {
          debugServerLogs.textContent = serverLogs
            .slice(0, 20)
            .map((l) => l.raw || l.line || '')
            .join('\n');
        }
      }

      // Render Active Vaulted Schedules
      if (schedules.length === 0) {
        debugSchedulesList.innerHTML =
          '<div class="debug-card"><p class="debug-section-desc" style="margin:0">No vaulted cards yet. Complete a Weekly or Monthly card donation to vault a card.</p></div>';
      } else {
        debugSchedulesList.innerHTML = schedules
          .map(
            (s) => `
          <div class="debug-card" data-schedule-id="${s.scheduleId}">
            <div class="debug-card-top">
              <div class="debug-badge-row">
                <span class="debug-tag is-vaulted">${
                  s.vaultStatus || 'VAULTED'
                }</span>
                <span class="debug-tag is-completed">${formatFrequencyBadge(
                  s.frequency
                )}</span>
                <strong style="font-size:13px;color:#001435">${
                  s.cardBrand || 'VISA'
                } •••• ${s.cardLast4 || '1111'}</strong>
              </div>
              <span class="debug-amount-strong">$${Number(
                s.amount || 1
              ).toFixed(2)} / ${
              s.frequency === 'WEEK' ? 'wk' : 'mo'
            }</span>
            </div>
            <div class="debug-meta-grid">
              <div class="debug-meta-item">
                <strong>Vault Token ID</strong>
                <code>${s.vaultId}</code>
              </div>
              <div class="debug-meta-item">
                <strong>Customer ID</strong>
                <code>${s.customerId || 'N/A'}</code>
              </div>
              <div class="debug-meta-item">
                <strong>Network Ref (${s.networkName || 'VISA'})</strong>
                <code>${s.lastNetworkReferenceId || 'N/A'}</code>
              </div>
              <div class="debug-meta-item">
                <strong>Rebills Executed</strong>
                <span>${s.rebillCount || 0} cycle(s)</span>
              </div>
            </div>
            <div class="debug-rebill-controls">
              <label class="debug-rebill-input-wrap" title="Rebill Amount (USD)">
                <span>$</span>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  value="${Number(s.amount || 1).toFixed(2)}"
                  id="rebill-amt-${s.scheduleId}"
                />
              </label>
              <button
                type="button"
                class="debug-rebill-btn"
                data-rebill-schedule="${s.scheduleId}"
                data-rebill-vault="${s.vaultId}"
              >
                Rebill Vaulted Card Now
              </button>
            </div>
          </div>
        `
          )
          .join('');
      }

      // Render Transactions Ledger
      if (transactions.length === 0) {
        debugTransactionsList.innerHTML =
          '<div class="debug-card"><p class="debug-section-desc" style="margin:0">No transactions recorded yet.</p></div>';
      } else {
        debugTransactionsList.innerHTML = transactions
          .map(
            (t, idx) => `
          <div class="debug-card ${
            highlightTxId && t.txId === highlightTxId ? 'is-new-rebill' : ''
          }">
            <div class="debug-card-top">
              <div class="debug-badge-row">
                <span class="debug-tag ${
                  t.type === 'REBILL' ? 'is-rebill' : 'is-initial'
                }">${t.type === 'REBILL' ? 'MIT REBILL' : 'INITIAL'}</span>
                <span class="debug-tag is-completed">${
                  t.status || 'COMPLETED'
                }</span>
                <span style="font-size:12px;color:#545d68">${formatFrequencyBadge(
                  t.frequency
                )}</span>
              </div>
              <span class="debug-amount-strong">$${Number(
                t.amount || 0
              ).toFixed(2)} USD</span>
            </div>
            <div class="debug-meta-grid">
              <div class="debug-meta-item">
                <strong>Capture ID</strong>
                <code>${t.captureId}</code>
              </div>
              <div class="debug-meta-item">
                <strong>Order ID</strong>
                <code>${t.orderId}</code>
              </div>
              <div class="debug-meta-item">
                <strong>Card / Vault</strong>
                <span>${t.cardBrand || 'CARD'} •••• ${
              t.cardLast4 || '1111'
            } ${t.vaultId ? `(<code>${t.vaultId}</code>)` : ''}</span>
              </div>
              <div class="debug-meta-item">
                <strong>Fee / Net</strong>
                <span>${
                  t.paypalFee
                    ? `Fee $${t.paypalFee} · Net $${t.netAmount}`
                    : 'Pending settlement'
                }</span>
              </div>
              <div class="debug-meta-item">
                <strong>Donor / Visitor</strong>
                <span>${t.donorName || 'Generous Supporter'} (${
              t.visitorId || 'v-000001'
            })</span>
              </div>
              <div class="debug-meta-item">
                <strong>Meta CAPI / Geo</strong>
                <code>M:${t.capiMeta || 'OK'} · ${
              t.location || 'Local (DEV)'
            }</code>
              </div>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;color:#64748b">
              <span>${new Date(t.createdAt).toLocaleString()}</span>
              <button
                type="button"
                class="debug-mini-link"
                data-preview-tx-index="${idx}"
              >
                View Receipt Popup
              </button>
            </div>
          </div>
        `
          )
          .join('');
      }

      // Attach Rebill handlers
      debugSchedulesList
        .querySelectorAll('[data-rebill-schedule]')
        .forEach((btn) => {
          btn.addEventListener('click', async () => {
            const scheduleId = btn.getAttribute('data-rebill-schedule');
            const vaultId = btn.getAttribute('data-rebill-vault');
            const amtInput = document.getElementById(
              `rebill-amt-${scheduleId}`
            );
            const customAmt = amtInput ? amtInput.value : '1.00';

            btn.disabled = true;
            btn.textContent = 'Charging Vault Token...';
            debugAlertBox.hidden = true;

            try {
              const r = await fetch('/api/vault/charge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  scheduleId,
                  vaultId,
                  amount: customAmt,
                }),
              });
              const result = await r.json();
              if (!r.ok) {
                throw new Error(result.error || 'Rebill failed.');
              }
              const tx = result.transaction;
              showDebugAlert(
                `Rebill succeeded! Charged $${tx.amount} USD against Vault ID ${tx.vaultId} (New Capture ID: ${tx.captureId}).`,
                'success'
              );
              await fetchAndRenderDebugStore(tx.txId);
            } catch (err) {
              showDebugAlert(`Rebill failed: ${err.message}`, 'error');
              btn.disabled = false;
              btn.textContent = 'Rebill Vaulted Card Now';
            }
          });
        });

      // Attach Receipt Popup preview handlers
      debugTransactionsList
        .querySelectorAll('[data-preview-tx-index]')
        .forEach((btn) => {
          btn.addEventListener('click', () => {
            const idx = Number(btn.getAttribute('data-preview-tx-index'));
            if (transactions[idx]) {
              openThankYouModal(transactions[idx]);
            }
          });
        });
    } catch (err) {
      console.error('Failed to load debug transactions:', err);
    }
  }

  async function init() {
    updateSegmentedSlider();
    updateUI();
    try {
      const res = await fetch('/api/config');
      const config = await res.json();
      state.clientId = config.clientId;
      state.currency = config.currency || 'USD';
      state.feeRatePercent = config.feeRatePercent ?? 5.4;
      state.flatFee = config.flatFee ?? 0.3;
      state.visitorId = config.visitorId || null;
      state.ipAddress = config.ipAddress || null;
      state.device = config.device || null;
      state.location = config.location || null;
      updateUI();

      if (window.Tracking) {
        await window.Tracking.init();
      }
      await fetchAndRenderDebugStore();
      await ensurePayPalSdkAndMount('capture');
    } catch (err) {
      showStatus('Failed to load donation configuration.', 'error');
    }
  }

  init();
})();
