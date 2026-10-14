(function () {
  let dashboardData = {
    stats: {},
    schedules: [],
    transactions: [],
    serverLogs: [],
    capiEvents: [],
    visitors: [],
  };

  let subFilter = 'ALL';
  let txFilter = 'ALL';

  // DOM Elements
  const dashAlert = document.getElementById('dash-alert');
  const dashModeBadge = document.getElementById('dash-mode-badge');
  const kpiTotalDonated = document.getElementById('kpi-total-donated');
  const kpiNetSubtext = document.getElementById('kpi-net-subtext');
  const kpiActiveSubs = document.getElementById('kpi-active-subs');
  const kpiMrrSubtext = document.getElementById('kpi-mrr-subtext');
  const kpiRebillsTotal = document.getElementById('kpi-rebills-total');
  const kpiRebillsCount = document.getElementById('kpi-rebills-count');
  const kpiVisitorsCount = document.getElementById('kpi-visitors-count');
  const kpiCapiSubtext = document.getElementById('kpi-capi-subtext');

  const subscriptionsList = document.getElementById('subscriptions-list');
  const transactionsList = document.getElementById('transactions-list');
  const serverLogsBox = document.getElementById('server-logs-box');
  const logsCountBadge = document.getElementById('logs-count-badge');
  const capiEventsList = document.getElementById('capi-events-list');
  const capiCountBadge = document.getElementById('capi-count-badge');
  const visitorsList = document.getElementById('visitors-list');
  const visitorsCountBadge = document.getElementById('visitors-count-badge');

  // Create Subscription Modal Elements
  const createSubModal = document.getElementById('create-sub-modal');
  const openCreateSubBtn = document.getElementById('open-create-sub-btn');
  const closeCreateSubBtn = document.getElementById('close-create-sub-btn');
  const cancelCreateSubBtn = document.getElementById('cancel-create-sub-btn');
  const createSubForm = document.getElementById('create-sub-form');
  const subCreateModeInput = document.getElementById('sub-create-mode');
  const createModeCardFields = document.getElementById('create-mode-card-fields');
  const createModeVaultFields = document.getElementById('create-mode-vault-fields');
  const submitCreateSubBtn = document.getElementById('submit-create-sub-btn');
  const refreshDashBtn = document.getElementById('refresh-dash-btn');

  function showAlert(msg, type = 'success') {
    dashAlert.hidden = false;
    dashAlert.className = `dash-alert ${
      type === 'error' ? 'is-error' : 'is-success'
    }`;
    dashAlert.innerHTML = `<span>${msg}</span><button type="button" style="background:none;border:none;font-size:16px;cursor:pointer" onclick="this.parentElement.hidden=true">&times;</button>`;
  }

  function formatFreqLabel(freq) {
    if (freq === 'WEEK') return 'WEEKLY';
    if (freq === 'MONTH') return 'MONTHLY';
    return 'ONE-TIME';
  }

  function renderKPIs() {
    const s = dashboardData.stats || {};
    const cfg = dashboardData.trackingConfig || {};

    dashModeBadge.textContent = (
      dashboardData.paypalMode || 'sandbox'
    ).toUpperCase();

    kpiTotalDonated.textContent = `$${Number(s.totalDonated || 0).toFixed(2)}`;
    kpiNetSubtext.textContent = `Net after fees: $${Number(
      s.netTotal || 0
    ).toFixed(2)} (${s.totalTransactions || 0} total tx)`;

    kpiActiveSubs.textContent = `${s.activeSubscriptions || 0} active`;
    kpiMrrSubtext.textContent = `Est. Run Rate: $${Number(
      s.estimatedMonthlyRunRate || 0
    ).toFixed(2)} / mo (${s.pausedSubscriptions || 0} paused)`;

    kpiRebillsTotal.textContent = `$${Number(s.rebillsTotal || 0).toFixed(2)}`;
    kpiRebillsCount.textContent = `${
      s.totalRebills || 0
    } MIT recurring capture(s)`;

    kpiVisitorsCount.textContent = `${s.uniqueVisitors || 0} visitor(s)`;
    kpiCapiSubtext.textContent = cfg.enabled
      ? `Meta Pixel ${cfg.fbPixelId || ''} · Donate CAPI ON`
      : 'Tracking Disabled';
  }

  function renderSubscriptions() {
    const allSubs = dashboardData.schedules || [];
    const filtered = allSubs.filter((s) => {
      const st = (s.status || 'ACTIVE').toUpperCase();
      if (subFilter === 'ALL') return true;
      return st === subFilter;
    });

    if (filtered.length === 0) {
      subscriptionsList.innerHTML =
        '<div class="dash-empty">No subscriptions match this filter. Click <strong>+ Create Subscription</strong> or complete a Weekly/Monthly card donation.</div>';
      return;
    }

    subscriptionsList.innerHTML = filtered
      .map((s) => {
        const status = (s.status || 'ACTIVE').toUpperCase();
        const statusClass =
          status === 'PAUSED'
            ? 'is-paused'
            : status === 'CANCELLED'
            ? 'is-cancelled'
            : 'is-active';
        const isPaused = status === 'PAUSED';

        return `
        <div class="dash-item-card ${isPaused ? 'is-paused' : ''}" data-sub-card="${
          s.scheduleId
        }">
          <div class="dash-card-top">
            <div class="dash-badges">
              <span class="dash-tag ${statusClass}">${status}</span>
              <span class="dash-tag is-vaulted">${formatFreqLabel(
                s.frequency
              )}</span>
              <strong style="font-size:14px;color:#001435">${
                s.donorName || 'Generous Supporter'
              }</strong>
              <span style="font-size:12px;color:#64748b">· ${
                s.cardBrand || 'VISA'
              } •••• ${s.cardLast4 || '1111'} (${
          s.cardExpiry || '2028-12'
        })</span>
            </div>
            <span class="dash-amount-badge">$${Number(s.amount || 0).toFixed(
              2
            )} USD / ${s.frequency === 'WEEK' ? 'wk' : 'mo'}</span>
          </div>

          <div class="dash-meta-grid">
            <div class="dash-meta-cell">
              <strong>PayPal Vault Token ID</strong>
              <code>${s.vaultId}</code>
            </div>
            <div class="dash-meta-cell">
              <strong>Customer / Schedule ID</strong>
              <code>${s.customerId || 'N/A'} · ${s.scheduleId}</code>
            </div>
            <div class="dash-meta-cell">
              <strong>Network Ref (${s.networkName || 'VISA'})</strong>
              <code>${s.lastNetworkReferenceId || 'Initial'}</code>
            </div>
            <div class="dash-meta-cell">
              <strong>MIT Rebills Executed</strong>
              <span>${s.rebillCount || 0} charge(s)</span>
            </div>
            <div class="dash-meta-cell">
              <strong>Last Billed At</strong>
              <span>${
                s.lastBilledAt
                  ? new Date(s.lastBilledAt).toLocaleString()
                  : 'Not billed yet'
              }</span>
            </div>
            <div class="dash-meta-cell">
              <strong>Donor GeoIP / Device</strong>
              <span>${s.location || 'Local'} · ${s.device || 'desktop'}</span>
            </div>
          </div>

          <div class="dash-sub-controls">
            <div class="dash-rebill-group">
              <label class="dash-input-prefix" title="Amount (USD)">
                <span>$</span>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  value="${Number(s.amount || 1).toFixed(2)}"
                  id="sub-amt-${s.scheduleId}"
                />
              </label>
              <select class="dash-select-sm" id="sub-freq-${s.scheduleId}">
                <option value="WEEK" ${
                  s.frequency === 'WEEK' ? 'selected' : ''
                }>Weekly</option>
                <option value="MONTH" ${
                  s.frequency === 'MONTH' ? 'selected' : ''
                }>Monthly</option>
              </select>
              <button
                type="button"
                class="dash-action-btn is-charge"
                data-charge-sub="${s.scheduleId}"
                data-charge-vault="${s.vaultId}"
              >
                Charge MIT Rebill Now
              </button>
            </div>

            <div class="dash-sub-actions">
              <button
                type="button"
                class="dash-action-btn"
                data-save-sub="${s.scheduleId}"
                title="Save updated amount and cadence"
              >
                Save Plan
              </button>
              <button
                type="button"
                class="dash-action-btn"
                data-toggle-pause="${s.scheduleId}"
                data-current-status="${status}"
              >
                ${status === 'PAUSED' ? 'Resume' : 'Pause'}
              </button>
              <button
                type="button"
                class="dash-action-btn is-danger"
                data-delete-sub="${s.scheduleId}"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      `;
      })
      .join('');

    // Bind Charge MIT Rebill
    subscriptionsList
      .querySelectorAll('[data-charge-sub]')
      .forEach((btn) => {
        btn.addEventListener('click', async () => {
          const scheduleId = btn.getAttribute('data-charge-sub');
          const vaultId = btn.getAttribute('data-charge-vault');
          const amtEl = document.getElementById(`sub-amt-${scheduleId}`);
          const freqEl = document.getElementById(`sub-freq-${scheduleId}`);
          const amount = amtEl ? amtEl.value : '1.00';
          const frequency = freqEl ? freqEl.value : 'WEEK';

          btn.disabled = true;
          btn.textContent = 'Charging Vault...';

          try {
            const res = await fetch('/api/vault/charge', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ scheduleId, vaultId, amount, frequency }),
            });
            const data = await res.json();
            if (!res.ok) {
              throw new Error(data.error || 'MIT rebill failed.');
            }
            showAlert(
              `MIT Rebill succeeded! Captured $${data.transaction.amount} USD on Vault Token ${data.transaction.vaultId} (Capture ID: ${data.transaction.captureId}).`,
              'success'
            );
            await fetchDashboard();
          } catch (err) {
            showAlert(`MIT Rebill failed: ${err.message}`, 'error');
            btn.disabled = false;
            btn.textContent = 'Charge MIT Rebill Now';
          }
        });
      });

    // Bind Save Plan (update amount / frequency)
    subscriptionsList.querySelectorAll('[data-save-sub]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const scheduleId = btn.getAttribute('data-save-sub');
        const amtEl = document.getElementById(`sub-amt-${scheduleId}`);
        const freqEl = document.getElementById(`sub-freq-${scheduleId}`);
        btn.disabled = true;
        try {
          const res = await fetch(
            `/api/subscriptions/${encodeURIComponent(scheduleId)}`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                amount: amtEl ? amtEl.value : undefined,
                frequency: freqEl ? freqEl.value : undefined,
              }),
            }
          );
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Update failed.');
          showAlert(
            `Updated subscription ${scheduleId} to $${data.schedule.amount} USD (${formatFreqLabel(
              data.schedule.frequency
            )}).`,
            'success'
          );
          await fetchDashboard();
        } catch (err) {
          showAlert(err.message, 'error');
          btn.disabled = false;
        }
      });
    });

    // Bind Pause / Resume
    subscriptionsList
      .querySelectorAll('[data-toggle-pause]')
      .forEach((btn) => {
        btn.addEventListener('click', async () => {
          const scheduleId = btn.getAttribute('data-toggle-pause');
          const cur = btn.getAttribute('data-current-status');
          const nextStatus = cur === 'PAUSED' ? 'ACTIVE' : 'PAUSED';
          btn.disabled = true;
          try {
            const res = await fetch(
              `/api/subscriptions/${encodeURIComponent(scheduleId)}`,
              {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: nextStatus }),
              }
            );
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Status update failed.');
            showAlert(
              `Subscription ${scheduleId} is now ${data.schedule.status}.`,
              'success'
            );
            await fetchDashboard();
          } catch (err) {
            showAlert(err.message, 'error');
            btn.disabled = false;
          }
        });
      });

    // Bind Remove / Delete Subscription
    subscriptionsList.querySelectorAll('[data-delete-sub]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const scheduleId = btn.getAttribute('data-delete-sub');
        btn.disabled = true;
        try {
          const res = await fetch(
            `/api/subscriptions/${encodeURIComponent(scheduleId)}`,
            { method: 'DELETE' }
          );
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Delete failed.');
          showAlert(
            `Removed subscription ${scheduleId} (Vault ID: ${data.removed.vaultId}).`,
            'success'
          );
          await fetchDashboard();
        } catch (err) {
          showAlert(err.message, 'error');
          btn.disabled = false;
        }
      });
    });
  }

  function renderTransactions() {
    const allTx = dashboardData.transactions || [];
    const filtered = allTx.filter((t) => {
      if (txFilter === 'ALL') return true;
      return (t.type || 'INITIAL') === txFilter;
    });

    if (filtered.length === 0) {
      transactionsList.innerHTML =
        '<div class="dash-empty">No transactions match this filter.</div>';
      return;
    }

    transactionsList.innerHTML = filtered
      .map((t) => {
        const isRebill = t.type === 'REBILL';
        return `
        <div class="dash-item-card">
          <div class="dash-card-top">
            <div class="dash-badges">
              <span class="dash-tag ${
                isRebill ? 'is-rebill' : 'is-initial'
              }">${isRebill ? 'MIT REBILL' : 'INITIAL DONATION'}</span>
              <span class="dash-tag is-active">${
                t.status || 'COMPLETED'
              }</span>
              <strong style="font-size:13px">${
                t.donorName || 'Generous Supporter'
              }</strong>
              <span style="font-size:12px;color:#64748b">· ${formatFreqLabel(
                t.frequency
              )}</span>
            </div>
            <span class="dash-amount-badge">$${Number(t.amount || 0).toFixed(
              2
            )} USD</span>
          </div>

          <div class="dash-meta-grid">
            <div class="dash-meta-cell">
              <strong>PayPal Capture ID</strong>
              <code>${t.captureId}</code>
            </div>
            <div class="dash-meta-cell">
              <strong>PayPal Order ID</strong>
              <code>${t.orderId}</code>
            </div>
            <div class="dash-meta-cell">
              <strong>Payment Method / Vault</strong>
              <span>${t.cardBrand || 'CARD'} •••• ${
          t.cardLast4 || '1111'
        } ${t.vaultId ? `(<code>${t.vaultId}</code>)` : ''}</span>
            </div>
            <div class="dash-meta-cell">
              <strong>PayPal Fee / Net</strong>
              <span>${
                t.paypalFee
                  ? `Fee $${t.paypalFee} · Net $${t.netAmount}`
                  : 'Gross $' + t.amount
              }</span>
            </div>
            <div class="dash-meta-cell">
              <strong>Donate CAPI Event</strong>
              <code>M:${t.capiMeta || '-'} · ${
          t.donateEventId || t.purchaseEventId || 'Renewal'
        }</code>
            </div>
            <div class="dash-meta-cell">
              <strong>Timestamp &amp; GeoIP</strong>
              <span>${new Date(t.createdAt).toLocaleString()} · ${
          t.location || 'Local'
        }</span>
            </div>
          </div>
        </div>
      `;
      })
      .join('');
  }

  function renderTelemetry() {
    const logs = dashboardData.serverLogs || [];
    logsCountBadge.textContent = `${logs.length} lines`;
    serverLogsBox.textContent =
      logs.length === 0
        ? 'No server journey logs recorded yet.'
        : logs.map((l) => l.raw || l.line || '').join('\n');

    const events = dashboardData.capiEvents || [];
    capiCountBadge.textContent = `${events.length} events`;
    if (events.length === 0) {
      capiEventsList.innerHTML =
        '<div class="dash-empty">No CAPI events fired yet.</div>';
    } else {
      capiEventsList.innerHTML = events
        .slice(0, 25)
        .map(
          (ev) => `
          <div class="dash-compact-row">
            <div>
              <strong>${ev.eventName}</strong>
              ${ev.value ? `<span>· $${Number(ev.value).toFixed(2)}</span>` : ''}
              <div style="font-size:11px;color:#64748b"><code>${ev.id}</code></div>
            </div>
            <div style="text-align:right">
              <span class="dash-tag ${
                ev.meta === '✓' ? 'is-active' : 'is-paused'
              }">M:${ev.meta} · T:${ev.tiktok}</span>
              <div style="font-size:11px;color:#64748b;margin-top:2px">${
                ev.city ? `${ev.city}, ${ev.countryCode}` : ev.ip || ''
              }</div>
            </div>
          </div>
        `
        )
        .join('');
    }

    const vis = dashboardData.visitors || [];
    visitorsCountBadge.textContent = `${vis.length} visitors`;
    if (vis.length === 0) {
      visitorsList.innerHTML =
        '<div class="dash-empty">No visitor sessions yet.</div>';
    } else {
      visitorsList.innerHTML = vis
        .slice(0, 25)
        .map(
          (v) => `
          <div class="dash-compact-row">
            <div>
              <code>${v.id}</code> · <strong>${
            v.city ? `${v.city}, ${v.country}` : v.country || 'Local'
          }</strong>
              <div style="font-size:11px;color:#64748b">${v.ip || ''} · ${
            v.device || 'desktop'
          }</div>
            </div>
            <span class="dash-tag is-vaulted">${
              v.Donated ? 'DONOR' : 'VISITOR'
            }</span>
          </div>
        `
        )
        .join('');
    }
  }

  async function fetchDashboard() {
    try {
      const res = await fetch('/api/dashboard');
      dashboardData = await res.json();
      renderKPIs();
      renderSubscriptions();
      renderTransactions();
      renderTelemetry();
    } catch (err) {
      showAlert(`Failed to load dashboard data: ${err.message}`, 'error');
    }
  }

  // Filter Pills
  document
    .querySelectorAll('#sub-filter-group .dash-pill')
    .forEach((btn) => {
      btn.addEventListener('click', () => {
        subFilter = btn.getAttribute('data-sub-filter');
        document
          .querySelectorAll('#sub-filter-group .dash-pill')
          .forEach((b) => b.classList.toggle('is-active', b === btn));
        renderSubscriptions();
      });
    });

  document
    .querySelectorAll('#tx-filter-group .dash-pill')
    .forEach((btn) => {
      btn.addEventListener('click', () => {
        txFilter = btn.getAttribute('data-tx-filter');
        document
          .querySelectorAll('#tx-filter-group .dash-pill')
          .forEach((b) => b.classList.toggle('is-active', b === btn));
        renderTransactions();
      });
    });

  // Create Subscription Modal Controls
  openCreateSubBtn.addEventListener('click', () => {
    createSubModal.hidden = false;
  });

  function closeCreateModal() {
    createSubModal.hidden = true;
  }

  closeCreateSubBtn.addEventListener('click', closeCreateModal);
  cancelCreateSubBtn.addEventListener('click', closeCreateModal);
  createSubModal.addEventListener('click', (e) => {
    if (e.target === createSubModal) closeCreateModal();
  });

  document.querySelectorAll('[data-create-mode]').forEach((tab) => {
    tab.addEventListener('click', () => {
      const mode = tab.getAttribute('data-create-mode');
      subCreateModeInput.value = mode;
      document
        .querySelectorAll('[data-create-mode]')
        .forEach((t) => t.classList.toggle('is-active', t === tab));
      createModeCardFields.hidden = mode !== 'card';
      createModeVaultFields.hidden = mode !== 'vault';
    });
  });

  document.querySelectorAll('[data-fill-card]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById('sub-card-number').value =
        btn.getAttribute('data-fill-card');
      document.getElementById('sub-card-expiry').value =
        btn.getAttribute('data-fill-exp');
      document.getElementById('sub-card-cvv').value =
        btn.getAttribute('data-fill-cvv');
    });
  });

  createSubForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const mode = subCreateModeInput.value;
    submitCreateSubBtn.disabled = true;
    submitCreateSubBtn.textContent =
      mode === 'card'
        ? 'Vaulting Card & Capturing on PayPal...'
        : 'Creating Subscription...';

    try {
      const payload = {
        mode,
        donorName: document.getElementById('sub-donor-name').value,
        donorEmail: document.getElementById('sub-donor-email').value,
        amount: document.getElementById('sub-amount').value,
        frequency: document.getElementById('sub-frequency').value,
        cardNumber: document.getElementById('sub-card-number').value,
        cardExpiry: document.getElementById('sub-card-expiry').value,
        cardCvv: document.getElementById('sub-card-cvv').value,
        vaultId: document.getElementById('sub-vault-id').value,
        cardBrand: document.getElementById('sub-card-brand').value,
        cardLast4: document.getElementById('sub-card-last4').value,
      };

      const res = await fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create subscription.');
      }

      closeCreateModal();
      showAlert(
        `Created subscription ${data.schedule.scheduleId} ($${data.schedule.amount} USD / ${
          data.schedule.frequency === 'WEEK' ? 'week' : 'month'
        } · Vault ID: ${data.schedule.vaultId}).`,
        'success'
      );
      await fetchDashboard();
    } catch (err) {
      showAlert(err.message, 'error');
    } finally {
      submitCreateSubBtn.disabled = false;
      submitCreateSubBtn.textContent = 'Create Subscription';
    }
  });

  refreshDashBtn.addEventListener('click', fetchDashboard);

  fetchDashboard();
})();
