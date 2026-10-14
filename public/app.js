(function () {
  const state = {
    clientId: '',
    currency: 'USD',
    feeRatePercent: 5.4,
    flatFee: 0.3,
    frequency: 'ONE_TIME', // 'ONE_TIME' | 'WEEK' | 'MONTH'
    rawInput: '',
    amount: 0,
    coverFees: false,
    isFocused: false,
    showValidationError: false,
    validationErrorMessage: '',
    cardDrawerOpen: false,
    sdkModeLoaded: null,
    sdkLoadingPromise: null,
    cardFieldsEligible: false,
    cardFieldsInstance: null,
    lastFeeFormatted: '$0.00 USD',
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

  // Thank You Receipt Modal DOM Elements
  const tyModalBackdrop = document.getElementById('thank-you-modal-backdrop');
  const tyModalClose = document.getElementById('ty-modal-close');
  const tyModalSubtitle = document.getElementById('ty-modal-subtitle');
  const tyModalAmount = document.getElementById('ty-modal-amount');
  const tyModalTypeBadge = document.getElementById('ty-modal-type-badge');
  const tyRcptStatus = document.getElementById('ty-rcpt-status');
  const tyRcptCapture = document.getElementById('ty-rcpt-capture');
  const tyRcptOrder = document.getElementById('ty-rcpt-order');
  const tyRcptCard = document.getElementById('ty-rcpt-card');
  const tyRcptTime = document.getElementById('ty-rcpt-time');
  const tyDoneBtn = document.getElementById('ty-done-btn');

  /**
   * Exact fee calculation from reference page:
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
      return 'Please enter a valid card number.';
    }
    if (raw.includes('CARD_TYPE_NOT_SUPPORTED')) {
      return 'This card type is not supported. Please try Visa, Mastercard, or American Express.';
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

    // 3. Update Cover Fee amount text with micro-highlight when value changes
    const fee = calculateFee(state.amount);
    const nextFeeFormatted = formatUSDStandard(fee);
    if (feeAmountEl.textContent !== nextFeeFormatted) {
      feeAmountEl.textContent = nextFeeFormatted;
      feeAmountEl.classList.add('is-fee-updated');
      setTimeout(() => {
        feeAmountEl.classList.remove('is-fee-updated');
      }, 240);
    }

    // 4. Update Recurring sublabel & disclaimer
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

    // 5. Update Card Submit label
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

  function triggerErrorShake() {
    amountErrorRow.hidden = true;
    void amountErrorRow.offsetWidth;
    amountErrorRow.hidden = false;
  }

  function validateDonationAmount() {
    if (!Number.isFinite(state.amount) || state.amount <= 0) {
      state.showValidationError = true;
      state.validationErrorMessage = 'Amount is required';
      updateUI();
      triggerErrorShake();
      amountInput.focus();
      return false;
    }
    if (state.amount < 1) {
      state.showValidationError = true;
      state.validationErrorMessage = '$1 minimum donation';
      updateUI();
      triggerErrorShake();
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

  // Segmented controller tabs
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
    const amt = getFinalAmountNumber().toFixed(2);

    if (state.frequency === 'WEEK' || state.frequency === 'MONTH') {
      const period = state.frequency === 'WEEK' ? 'weekly' : 'monthly';
      return `Thank you! Your $${amt} USD ${period} recurring donation is active (Transaction ID: ${captureId}).`;
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
        },
        onCancel: () => {
          if (window.Tracking) {
            window.Tracking.trackPaymentEvent(
              'modal_close',
              'closed PayPal popup window without paying',
              getFinalAmountNumber() || null,
              'paypal'
            );
          }
        },
        onError: (err) => {
          const rawErr = String(err?.message || err || 'PayPal checkout error');
          showStatus(
            err?.message || 'PayPal checkout encountered an error.',
            'error'
          );
          if (window.Tracking) {
            window.Tracking.trackPaymentEvent(
              'paypal_error',
              rawErr.slice(0, 220),
              getFinalAmountNumber() || null,
              'paypal'
            );
          }
        },
      });

      if (ppBtn.isEligible()) {
        await ppBtn.render('#paypal-sdk-button-overlay');
      }

      // 2. Mount Minimal-Friction 3-Field CardFields
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
              if (
                !statusBanner.hidden &&
                statusBanner.classList.contains('is-error')
              ) {
                clearStatus();
              }
            },
          },
          createOrder: async () => {
            activeAttemptStart = Date.now();
            state.errorReportedForAttempt = false;
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
          },
          onError: (err) => {
            const rawErr = String(err?.message || err || '').replace(/\s+/g, ' ');
            const msg = formatCardErrorMessage(err);
            showStatus(msg, 'error');
            if (!state.errorReportedForAttempt && window.Tracking) {
              state.errorReportedForAttempt = true;
              const detailPayload =
                rawErr && rawErr !== msg
                  ? `${msg} [${rawErr.slice(0, 180)}]`
                  : msg;
              window.Tracking.trackPaymentEvent(
                'card_error',
                detailPayload,
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
        } else if (window.Tracking) {
          window.Tracking.trackPaymentEvent(
            'sdk_error',
            'PayPal CardFields isEligible() returned false for this device/merchant',
            null,
            'card'
          );
        }
      }
    } catch (err) {
      const errMsg = err?.message || 'Unable to initialize PayPal SDK.';
      showStatus(errMsg, 'error');
      if (window.Tracking) {
        window.Tracking.trackPaymentEvent('sdk_error', errMsg, null, 'sdk');
      }
    }
  }

  // Submit handler for the 3-field minimal CardFields form
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

      state.errorReportedForAttempt = false;
      cardFieldsSubmitBtn.disabled = true;
      cardSubmitLabel.innerHTML =
        '<span class="btn-spinner" aria-hidden="true"></span>Processing...';
      await state.cardFieldsInstance.submit({
        cardholderName: 'Generous Supporter',
      });
    } catch (err) {
      const msg = formatCardErrorMessage(err);
      showStatus(msg, 'error');
      if (!state.errorReportedForAttempt && window.Tracking) {
        state.errorReportedForAttempt = true;
        const rawErr = String(err?.message || err || '').replace(/\s+/g, ' ');
        window.Tracking.trackPaymentEvent(
          'card_error',
          rawErr && rawErr !== msg ? `${msg} [${rawErr.slice(0, 180)}]` : msg,
          getFinalAmountNumber() || null,
          'card'
        );
      }
    } finally {
      cardFieldsSubmitBtn.disabled = false;
      updateUI();
    }
  });

  // Clean Consumer Receipt Modal
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

    if (tx.frequency === 'WEEK' || tx.frequency === 'MONTH') {
      tyModalTypeBadge.textContent = formatFrequencyBadge(tx.frequency);
      tyModalSubtitle.textContent =
        'Your recurring donation is active. Thank you for your ongoing generosity!';
    } else {
      tyModalTypeBadge.textContent = 'ONE-TIME';
      tyModalSubtitle.textContent =
        'Your contribution directly supports life-saving surgery for Help my baby.';
    }

    tyRcptStatus.textContent = tx.status || 'COMPLETED';
    tyRcptCapture.textContent = tx.captureId || 'N/A';
    tyRcptOrder.textContent = tx.orderId || 'N/A';
    tyRcptCard.textContent = tx.cardLast4
      ? `${tx.cardBrand || 'CARD'} •••• ${tx.cardLast4}`
      : tx.cardBrand || 'PayPal';

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
      updateUI();

      if (window.Tracking) {
        await window.Tracking.init();
      }
      await ensurePayPalSdkAndMount('capture');
    } catch (_err) {
      showStatus('Failed to load donation configuration.', 'error');
    }
  }

  init();
})();
