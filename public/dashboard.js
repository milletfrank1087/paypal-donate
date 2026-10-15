(function () {
  let dashboardData = null;
  let currentRange = 'today';
  let currentSubFilter = 'ALL';
  let currentTxFilter = 'ALL';
  let showFailedTx = true;
  let searchQuery = '';
  let createMode = 'card';
  let selectedSubForRebill = null;
  let selectedSubForDelete = null;

  function fmt(num) {
    const n = Number.parseFloat(num);
    if (!Number.isFinite(n)) return '$0.00';
    if (n < 0) {
      return '−$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtDateShort(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function getInitials(name) {
    const clean = String(name || 'Generous Supporter').trim();
    const parts = clean.split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return clean.slice(0, 2).toUpperCase();
  }

  function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    const bg =
      type === 'error'
        ? 'bg-[#df1b41]'
        : type === 'warning'
        ? 'bg-amber-600'
        : 'bg-[#00875a]';
    toast.className = `${bg} text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-2.5 text-xs font-semibold transition-all duration-200`;
    toast.innerHTML = `<span>${esc(message)}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 250);
    }, 4000);
  }

  function getRangeBounds(rangeKey) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (rangeKey === 'today') {
      return { start: startOfToday, end: now, label: 'Today' };
    }
    if (rangeKey === 'yesterday') {
      const yStart = new Date(startOfToday.getTime() - 86400000);
      const yEnd = new Date(startOfToday.getTime() - 1);
      return { start: yStart, end: yEnd, label: 'Yesterday' };
    }
    if (rangeKey === 'last7days') {
      return { start: new Date(startOfToday.getTime() - 6 * 86400000), end: now, label: 'Last 7 Days' };
    }
    if (rangeKey === 'last30days') {
      return { start: new Date(startOfToday.getTime() - 29 * 86400000), end: now, label: 'Last 30 Days' };
    }
    if (rangeKey === 'thisMonth') {
      return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now, label: 'This Month' };
    }
    return { start: null, end: null, label: 'All Settled Payments' };
  }

  function filterTransactionsByRange(txs) {
    const bounds = getRangeBounds(currentRange);
    if (!bounds.start) return txs;
    return txs.filter((t) => {
      const ts = new Date(t.createdAt).getTime();
      if (Number.isNaN(ts)) return true;
      return ts >= bounds.start.getTime() && ts <= bounds.end.getTime();
    });
  }

  function matchesSearch(item) {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (item.donorName || '').toLowerCase().includes(q) ||
      (item.donorEmail || '').toLowerCase().includes(q) ||
      (item.vaultId || '').toLowerCase().includes(q) ||
      (item.scheduleId || '').toLowerCase().includes(q) ||
      (item.captureId || '').toLowerCase().includes(q) ||
      (item.orderId || '').toLowerCase().includes(q) ||
      (item.cardLast4 || '').toLowerCase().includes(q) ||
      (item.utmCampaign || '').toLowerCase().includes(q)
    );
  }

  function renderOverview() {
    if (!dashboardData) return;
    const modeBadge = document.getElementById('paypal-mode-badge');
    if (modeBadge) {
      const isLive = dashboardData.paypalMode === 'live';
      modeBadge.textContent = isLive ? 'PAYPAL LIVE' : 'PAYPAL SANDBOX';
      modeBadge.className = isLive
        ? 'text-xs font-mono font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-[#00875a] border border-emerald-200'
        : 'text-xs font-mono font-semibold px-1.5 py-0.5 rounded bg-indigo-50 text-[#635bff] border border-indigo-100';
    }

    const allTxs = filterTransactionsByRange(dashboardData.transactions || []);
    const completedTxs = allTxs.filter((t) => t.status !== 'FAILED' && t.type !== 'FAILED');
    const failedTxs = allTxs.filter((t) => t.status === 'FAILED' || t.type === 'FAILED');

    let gross = 0;
    let fees = 0;
    let tips = 0;
    let net = 0;
    let rebillsGross = 0;
    let rebillsCount = 0;
    let initialGross = 0;
    let initialCount = 0;

    completedTxs.forEach((t) => {
      const amt = Number.parseFloat(t.amount) || 0;
      const fee = Number.parseFloat(t.paypalFee) || 0;
      const tip = Number.parseFloat(t.feeCovered) || 0;
      const rowNet =
        t.netAmount !== null && t.netAmount !== undefined
          ? Number.parseFloat(t.netAmount)
          : Math.max(0, amt - fee);
      gross += amt;
      fees += fee;
      tips += tip;
      net += rowNet;
      if (t.type === 'REBILL') {
        rebillsGross += amt;
        rebillsCount += 1;
      } else {
        initialGross += amt;
        initialCount += 1;
      }
    });

    const stats = dashboardData.stats || {};
    const bounds = getRangeBounds(currentRange);
    const marginPct = gross > 0 ? ((net / gross) * 100).toFixed(1) + '%' : '0.0%';
    const feePct = gross > 0 ? ((fees / gross) * 100).toFixed(1) + '%' : '0.0%';
    const aov = completedTxs.length > 0 ? gross / completedTxs.length : 0;

    const adRange = (dashboardData.adSpendByRange && dashboardData.adSpendByRange[currentRange]) || {
      spend: 0,
      metaPurchases: 0,
      metaValue: 0,
      campaigns: [],
    };
    const adSpend = Number(adRange.spend || 0);
    const trueProfit = net - adSpend;
    const realRoas = adSpend > 0 ? (gross / adSpend).toFixed(2) + 'x' : '—';
    const realCpa = adSpend > 0 && completedTxs.length > 0 ? fmt(adSpend / completedTxs.length) : '—';
    const trueMarginPct = gross > 0 ? ((trueProfit / gross) * 100).toFixed(1) + '%' : '0.0%';

    document.getElementById('hero-window').textContent = bounds.label;
    document.getElementById('hero-net').textContent = fmt(net);
    const heroLiquidEl = document.getElementById('hero-liquid-net');
    if (heroLiquidEl) heroLiquidEl.textContent = fmt(net);
    const heroAdSpendEl = document.getElementById('hero-ad-spend');
    if (heroAdSpendEl) heroAdSpendEl.textContent = fmt(adSpend);
    const heroSpendCardEl = document.getElementById('hero-spend-card');
    if (heroSpendCardEl) heroSpendCardEl.textContent = fmt(adSpend);
    const heroSpendSubEl = document.getElementById('hero-spend-sub');
    if (heroSpendSubEl) {
      heroSpendSubEl.textContent = `CPA ${realCpa} · ${(adRange.campaigns || []).length} Meta campaign${(adRange.campaigns || []).length === 1 ? '' : 's'}`;
    }
    const heroTrueProfitEl = document.getElementById('hero-true-profit');
    if (heroTrueProfitEl) {
      heroTrueProfitEl.textContent = fmt(trueProfit);
      heroTrueProfitEl.className = `text-4xl sm:text-6xl font-bold tracking-tight tabular-numbers ${trueProfit < 0 ? 'text-[#df1b41]' : 'text-[#00875a]'}`;
    }
    const heroRoasPillEl = document.getElementById('hero-roas-pill');
    if (heroRoasPillEl) {
      heroRoasPillEl.textContent = `ROAS ${realRoas}`;
    }
    document.getElementById('hero-mrr').textContent = fmt(stats.estimatedMonthlyRunRate || 0);
    document.getElementById('hero-mrr-sub').textContent = `${stats.activeSubscriptions || 0} active · ${stats.pausedSubscriptions || 0} paused`;
    document.getElementById('hero-margin').textContent = marginPct;
    document.getElementById('hero-txns').textContent = String(completedTxs.length);
    document.getElementById('hero-txns-sub').textContent = `${initialCount} initial · ${rebillsCount} rebills`;

    document.getElementById('wf-gross').textContent = fmt(gross);
    document.getElementById('wf-gross-count').textContent = `${completedTxs.length} txns`;
    document.getElementById('wf-tips').textContent = fmt(tips);

    document.getElementById('wf-fees').textContent = '−' + fmt(fees);
    document.getElementById('wf-fee-pct').textContent = feePct;
    document.getElementById('wf-aov').textContent = fmt(aov);

    document.getElementById('wf-rebills').textContent = fmt(rebillsGross);
    document.getElementById('wf-rebills-count').textContent = `${rebillsCount}`;
    document.getElementById('wf-initial').textContent = fmt(initialGross);

    document.getElementById('wf-net').textContent = fmt(net);
    document.getElementById('wf-margin-badge').textContent = marginPct;

    const wfSpendEl = document.getElementById('wf-spend');
    if (wfSpendEl) wfSpendEl.textContent = '−' + fmt(adSpend);
    const wfRoasEl = document.getElementById('wf-roas-badge');
    if (wfRoasEl) wfRoasEl.textContent = `ROAS ${realRoas}`;
    const wfCpaEl = document.getElementById('wf-cpa');
    if (wfCpaEl) wfCpaEl.textContent = `${realCpa} (${adRange.metaPurchases || 0} Meta px)`;

    const wfTrueProfitEl = document.getElementById('wf-true-profit');
    if (wfTrueProfitEl) {
      wfTrueProfitEl.textContent = fmt(trueProfit);
      wfTrueProfitEl.className = `text-lg sm:text-2xl lg:text-3xl font-bold tabular-numbers truncate ${trueProfit < 0 ? 'text-[#df1b41]' : 'text-[#00875a]'}`;
    }
    const wfTrueMarginEl = document.getElementById('wf-true-margin-badge');
    if (wfTrueMarginEl) wfTrueMarginEl.textContent = trueMarginPct;
    document.getElementById('wf-cadence-split').textContent = `${fmt(stats.weeklyRecurringVolume || 0)}/wk · ${fmt(stats.monthlyRecurringVolume || 0)}/mo`;

    const allSubs = dashboardData.schedules || [];
    const activeSubsCount = allSubs.filter((s) => (s.status || 'ACTIVE').toUpperCase() === 'ACTIVE').length;
    const pausedSubsCount = allSubs.filter((s) => (s.status || 'ACTIVE').toUpperCase() === 'PAUSED').length;

    document.getElementById('badge-sub-all').textContent = String(allSubs.length);
    document.getElementById('badge-sub-active').textContent = String(activeSubsCount);
    document.getElementById('badge-sub-paused').textContent = String(pausedSubsCount);
    document.getElementById('subs-count-badge').textContent = `${allSubs.length} Vaulted`;

    document.getElementById('txns-count-badge').textContent = `${completedTxs.length} Completed`;
    const failedBadge = document.getElementById('txns-failed-badge');
    if (failedTxs.length > 0) {
      failedBadge.textContent = `${failedTxs.length} Failed`;
      failedBadge.classList.remove('hidden');
    } else {
      failedBadge.classList.add('hidden');
    }

    renderAdCampaignsTable(completedTxs, adRange);
    renderSubscriptionsTable();
    renderTransactionsTable(allTxs);
  }

  function renderAdCampaignsTable(completedTxs, adRange) {
    const tbody = document.getElementById('ad-campaigns-tbody');
    if (!tbody) return;
    const campaigns = adRange?.campaigns || [];
    const byCamp = new Map();

    for (const c of campaigns) {
      byCamp.set(String(c.campaignId), {
        campaignId: String(c.campaignId),
        name: c.name || c.campaignId,
        status: c.status || 'ACTIVE',
        pixelId: c.pixelId || null,
        spend: Number(c.spend || 0),
        metaPurchases: Number(c.metaPurchases || 0),
        count: 0,
        gross: 0,
        fees: 0,
        net: 0,
      });
    }

    for (const t of completedTxs || []) {
      const cid = String(t.utmCampaign || 'direct');
      if (!byCamp.has(cid)) {
        byCamp.set(cid, {
          campaignId: cid,
          name: cid === 'direct' ? 'Direct / Untracked' : cid,
          status: cid === 'direct' ? 'DIRECT' : 'ACTIVE',
          pixelId: null,
          spend: 0,
          metaPurchases: 0,
          count: 0,
          gross: 0,
          fees: 0,
          net: 0,
        });
      }
      const row = byCamp.get(cid);
      const amt = Number.parseFloat(t.amount) || 0;
      const fee = Number.parseFloat(t.paypalFee) || 0;
      const rowNet =
        t.netAmount !== null && t.netAmount !== undefined
          ? Number.parseFloat(t.netAmount)
          : Math.max(0, amt - fee);
      row.count += 1;
      row.gross += amt;
      row.fees += fee;
      row.net += rowNet;
    }

    const rows = [...byCamp.values()].sort((a, b) => (b.spend - a.spend) || (b.gross - a.gross));
    const badgeEl = document.getElementById('ads-count-badge');
    if (badgeEl) badgeEl.textContent = `${rows.length} Campaign${rows.length === 1 ? '' : 's'}`;

    if (rows.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="10" class="text-center py-6 text-slate-400 text-xs font-sans">No Meta campaigns or attributed donations in this window.</td></tr>';
      return;
    }

    tbody.innerHTML = rows
      .map((r) => {
        const trueProfit = r.net - r.spend;
        const cpa = r.spend > 0 && r.count > 0 ? fmt(r.spend / r.count) : '—';
        const roas = r.spend > 0 ? (r.gross / r.spend).toFixed(2) + 'x' : '—';
        const st = String(r.status || 'ACTIVE').toUpperCase();
        const stBadge =
          st === 'ACTIVE'
            ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#edf9f3] text-[#00875a] border border-[#c2ecd7]">● ACTIVE</span>'
            : `<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600">${esc(st)}</span>`;

        return `
          <tr>
            <td class="sticky-col font-sans">
              <div class="font-semibold text-[#061b31] text-xs">${esc(r.name)}</div>
              <div class="text-[11px] text-slate-400 font-mono">ID: ${esc(r.campaignId)}${r.pixelId ? ` · Pixel: ${esc(r.pixelId)}` : ''}</div>
            </td>
            <td class="font-sans">${stBadge}</td>
            <td class="text-right font-bold text-[#061b31]">${r.count}</td>
            <td class="text-right font-bold text-[#061b31]">${fmt(r.gross)}</td>
            <td class="text-right text-[#df1b41]">−${fmt(r.fees)}</td>
            <td class="text-right font-bold text-[#00875a]">${fmt(r.net)}</td>
            <td class="text-right font-bold text-amber-600">−${fmt(r.spend)}</td>
            <td class="text-right font-bold ${trueProfit < 0 ? 'text-[#df1b41]' : 'text-[#00875a]'}">${fmt(trueProfit)}</td>
            <td class="text-right text-slate-700">${cpa}</td>
            <td class="text-right font-bold text-[#635bff]">${roas}</td>
          </tr>
        `;
      })
      .join('');
  }

  function renderSubscriptionsTable() {
    const tbody = document.getElementById('subscriptions-tbody');
    const subs = (dashboardData?.schedules || []).filter((s) => {
      const st = (s.status || 'ACTIVE').toUpperCase();
      if (currentSubFilter !== 'ALL' && st !== currentSubFilter) return false;
      return matchesSearch(s);
    });

    if (subs.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="8" class="text-center py-8 text-slate-400 text-xs">No matching subscriptions or vaulted donors found.</td></tr>';
      return;
    }

    tbody.innerHTML = subs
      .map((s) => {
        const st = (s.status || 'ACTIVE').toUpperCase();
        const isPaused = st === 'PAUSED';
        const statusBadge = isPaused
          ? '<span class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800">⏸ Paused</span>'
          : '<span class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#edf9f3] text-[#00875a] border border-[#c2ecd7]">● Active</span>';

        const campLabel = s.utmCampaign && s.utmCampaign !== 'direct' ? s.utmCampaign : null;

        return `
          <tr>
            <td class="sticky-col cursor-pointer" onclick="openCustomerDetail('${esc(s.scheduleId)}')">
              <div class="flex items-center gap-2.5">
                <div class="w-8 h-8 rounded-full bg-[#635bff]/10 text-[#635bff] flex items-center justify-center font-bold text-xs shrink-0">${esc(getInitials(s.donorName))}</div>
                <div>
                  <div class="font-semibold text-[#061b31] hover:text-[#635bff] transition-colors">${esc(s.donorName || 'Generous Supporter')}</div>
                  <div class="text-[11px] text-slate-400">${esc(s.donorEmail || s.location || 'No email')} ${campLabel ? `<span class="ml-1 px-1.5 py-0.2 rounded bg-indigo-50 text-[#635bff] font-mono text-[10px]">${esc(campLabel)}</span>` : ''}</div>
                </div>
              </div>
            </td>
            <td>
              <div class="flex flex-col gap-1">
                <span class="text-xs font-semibold text-[#061b31]">💳 ${esc(s.cardBrand || 'VISA')} •••• ${esc(s.cardLast4 || '1111')} <span class="text-slate-400 font-normal">${s.cardExpiry ? `(${esc(s.cardExpiry)})` : ''}</span></span>
                <div>
                  <button type="button" onclick="copyText('${esc(s.vaultId)}')" class="copy-pill" title="Click to copy PayPal Vault Token ID">
                    <span>🔄 ${esc(s.vaultId)}</span>
                  </button>
                </div>
              </div>
            </td>
            <td>
              <div class="flex items-center gap-1.5">
                <input type="number" id="plan-amt-${esc(s.scheduleId)}" value="${esc(s.amount)}" min="1" step="0.01" class="inline-input" />
                <select id="plan-freq-${esc(s.scheduleId)}" class="inline-select">
                  <option value="WEEK" ${s.frequency === 'WEEK' ? 'selected' : ''}>Weekly</option>
                  <option value="MONTH" ${s.frequency === 'MONTH' ? 'selected' : ''}>Monthly</option>
                  <option value="ONE_TIME" ${s.frequency === 'ONE_TIME' ? 'selected' : ''}>One-Time Vault</option>
                </select>
                <button type="button" onclick="savePlanInline('${esc(s.scheduleId)}')" class="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-[#061b31] text-[11px] font-semibold transition-colors">Save</button>
              </div>
            </td>
            <td class="text-right tabular-numbers">
              <div class="font-bold text-[#00875a]">${fmt(s.totalDonated)}</div>
              <div class="text-[11px] text-slate-400">Net ${fmt(s.totalNet)}</div>
            </td>
            <td class="text-right tabular-numbers">
              <span class="font-semibold text-[#061b31]">${s.rebillCount || 0}</span>
              <span class="text-[11px] text-slate-400 block">${s.donationCount || 1} total</span>
            </td>
            <td class="text-xs text-slate-500 font-mono whitespace-nowrap">${esc(fmtDateShort(s.lastBilledAt || s.createdAt))}</td>
            <td>${statusBadge}</td>
            <td class="text-right whitespace-nowrap">
              <div class="inline-flex items-center gap-1.5">
                <button type="button" onclick="openRebillModal('${esc(s.scheduleId)}')" class="px-2.5 py-1.5 rounded-md bg-[#635bff] hover:bg-[#533afd] text-white text-xs font-semibold shadow-xs transition-all">
                  ⚡ Rebill
                </button>
                <button type="button" onclick="toggleSubPause('${esc(s.scheduleId)}', '${esc(st)}')" class="px-2.5 py-1.5 rounded-md border border-gray-200 hover:bg-slate-50 text-xs font-semibold ${isPaused ? 'text-[#00875a]' : 'text-amber-700'}">
                  ${isPaused ? '▶ Resume' : '⏸ Pause'}
                </button>
                <button type="button" onclick="openDeleteModal('${esc(s.scheduleId)}')" class="p-1.5 rounded-md border border-gray-200 hover:bg-red-50 text-[#df1b41]" title="Remove subscription">
                  🗑
                </button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  function renderTransactionsTable(rangeTxs) {
    const tbody = document.getElementById('transactions-tbody');
    const filtered = (rangeTxs || []).filter((t) => {
      const isFailed = t.status === 'FAILED' || t.type === 'FAILED';
      if (isFailed && !showFailedTx) return false;
      if (currentTxFilter === 'INITIAL' && (t.type === 'REBILL' || isFailed)) return false;
      if (currentTxFilter === 'REBILL' && t.type !== 'REBILL') return false;
      return matchesSearch(t);
    });

    if (filtered.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="9" class="text-center py-8 text-slate-400 text-xs">No transactions in this view.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered
      .map((t) => {
        const isFailed = t.status === 'FAILED' || t.type === 'FAILED';
        const isRebill = t.type === 'REBILL';
        const amt = Number.parseFloat(t.amount) || 0;
        const fee = Number.parseFloat(t.paypalFee) || 0;
        const net =
          t.netAmount !== null && t.netAmount !== undefined
            ? Number.parseFloat(t.netAmount)
            : Math.max(0, amt - fee);

        const typeBadge = isFailed
          ? `<span class="px-2 py-0.5 rounded bg-red-50 text-[#df1b41] border border-red-200 font-bold text-[10px]">DECLINED (${esc(t.processorResponseCode || 'ERR')})</span>`
          : isRebill
          ? '<span class="px-2 py-0.5 rounded bg-indigo-50 text-[#635bff] border border-indigo-100 font-bold text-[10px]">🔄 MIT REBILL</span>'
          : '<span class="px-2 py-0.5 rounded bg-emerald-50 text-[#00875a] border border-emerald-100 font-bold text-[10px]">INITIAL DONATION</span>';

        return `
          <tr class="${isFailed ? 'bg-red-50/40' : ''}">
            <td class="sticky-col font-sans">
              <div class="font-semibold text-[#061b31] text-xs">${esc(t.donorName || 'Generous Supporter')}</div>
              <div class="text-[11px] text-slate-400">${esc(t.location || 'US')}</div>
            </td>
            <td class="font-sans">${typeBadge}</td>
            <td><span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px]">${esc(t.utmCampaign || 'direct')}</span></td>
            <td>${esc(t.cardBrand || 'VISA')} ${t.cardLast4 ? '•••• ' + esc(t.cardLast4) : ''}</td>
            <td class="text-right font-bold ${isFailed ? 'text-[#df1b41] line-through' : 'text-[#061b31]'}">${fmt(amt)}</td>
            <td class="text-right text-[#df1b41]">${isFailed ? '—' : '−' + fmt(fee)}</td>
            <td class="text-right font-bold ${isFailed ? 'text-slate-400' : 'text-[#00875a]'}">${isFailed ? '—' : fmt(net)}</td>
            <td>
              <span class="text-[11px] text-slate-600">${esc(t.captureId || t.orderId || '—')}</span>
              ${t.vaultId ? `<span class="block text-[10px] text-[#635bff]">vault: ${esc(t.vaultId)}</span>` : ''}
            </td>
            <td class="text-right text-slate-500 whitespace-nowrap">${esc(fmtDateShort(t.createdAt))}</td>
          </tr>
        `;
      })
      .join('');
  }

  async function refreshDashboard(forceAds = false) {
    const btn = document.getElementById('refresh-btn');
    const icon = document.getElementById('refresh-icon');
    const label = document.getElementById('refresh-btn-label');
    if (btn) btn.disabled = true;
    if (icon) icon.classList.add('animate-spin');
    if (label && forceAds) label.textContent = 'Syncing…';
    try {
      const url = forceAds ? '/api/dashboard?force_ads=1' : '/api/dashboard';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load dashboard data');
      dashboardData = await res.json();
      document.getElementById('last-updated-label').textContent =
        'Updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      renderOverview();
      if (forceAds) showToast('Synced latest PayPal & Meta Ad Spend');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
      if (icon) icon.classList.remove('animate-spin');
      if (label) label.textContent = 'Refresh';
    }
  }

  window.refreshDashboard = refreshDashboard;

  window.selectRange = function (rangeKey) {
    currentRange = rangeKey;
    document.querySelectorAll('#range-pills .stripe-pill').forEach((btn) => {
      const active = btn.getAttribute('data-range') === rangeKey;
      btn.classList.toggle('active', active);
      btn.classList.toggle('inactive', !active);
    });
    renderOverview();
  };

  window.selectSubFilter = function (filterKey) {
    currentSubFilter = filterKey;
    document.querySelectorAll('#sub-status-pills .stripe-pill').forEach((btn) => {
      const active = btn.getAttribute('data-subfilter') === filterKey;
      btn.classList.toggle('active', active);
      btn.classList.toggle('inactive', !active);
    });
    renderSubscriptionsTable();
  };

  window.selectTxFilter = function (filterKey) {
    currentTxFilter = filterKey;
    document.querySelectorAll('[data-txfilter]').forEach((btn) => {
      const active = btn.getAttribute('data-txfilter') === filterKey;
      btn.classList.toggle('active', active);
      btn.classList.toggle('inactive', !active);
    });
    renderOverview();
  };

  window.toggleShowFailed = function (checked) {
    showFailedTx = Boolean(checked);
    renderOverview();
  };

  window.handleSearch = function (val) {
    searchQuery = String(val || '').trim();
    renderOverview();
  };

  window.copyText = function (txt) {
    if (!txt) return;
    navigator.clipboard.writeText(txt).then(() => {
      showToast(`Copied ${txt} to clipboard`);
    });
  };

  window.savePlanInline = async function (scheduleId) {
    const amtInput = document.getElementById(`plan-amt-${scheduleId}`);
    const freqSelect = document.getElementById(`plan-freq-${scheduleId}`);
    if (!amtInput || !freqSelect) return;

    try {
      const res = await fetch(`/api/subscriptions/${encodeURIComponent(scheduleId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amtInput.value,
          frequency: freqSelect.value,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update plan');
      showToast(`Saved plan ($${data.schedule.amount} / ${data.schedule.frequency})`);
      await refreshDashboard();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  window.toggleSubPause = async function (scheduleId, currentStatus) {
    const nextStatus = currentStatus === 'PAUSED' ? 'ACTIVE' : 'PAUSED';
    try {
      const res = await fetch(`/api/subscriptions/${encodeURIComponent(scheduleId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update status');
      showToast(`Subscription ${nextStatus === 'PAUSED' ? 'paused' : 'resumed'}`);
      await refreshDashboard();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // Rebill Modal
  window.openRebillModal = function (scheduleId) {
    const sub = (dashboardData?.schedules || []).find((s) => s.scheduleId === scheduleId);
    if (!sub) return;
    selectedSubForRebill = sub;
    document.getElementById('rebill-customer-info').innerHTML = `
      <div class="flex items-center justify-between">
        <span class="font-bold text-[#061b31] text-sm">${esc(sub.donorName)}</span>
        <span class="font-mono text-xs text-[#00875a] font-bold">Total donated: ${fmt(sub.totalDonated)}</span>
      </div>
      <div class="text-slate-500">Card: <b>${esc(sub.cardBrand)} •••• ${esc(sub.cardLast4)}</b> · Vault ID: <code class="text-[#635bff] font-mono">${esc(sub.vaultId)}</code></div>
    `;
    document.getElementById('rebill-amount-input').value = sub.amount || '25.00';
    document.getElementById('rebill-modal').classList.remove('hidden');
  };

  window.closeRebillModal = function () {
    document.getElementById('rebill-modal').classList.add('hidden');
    selectedSubForRebill = null;
  };

  window.confirmRebillCharge = async function () {
    if (!selectedSubForRebill) return;
    const amountVal = document.getElementById('rebill-amount-input').value;
    const btn = document.getElementById('rebill-confirm-btn');
    btn.disabled = true;
    btn.textContent = 'Charging PayPal Vault…';

    try {
      const res = await fetch('/api/vault/charge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId: selectedSubForRebill.scheduleId,
          vaultId: selectedSubForRebill.vaultId,
          amount: amountVal,
          frequency: selectedSubForRebill.frequency,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'MIT rebill failed');
      showToast(`Charged ${fmt(data.transaction.amount)} to ${selectedSubForRebill.donorName} (Capture ${data.transaction.captureId})`);
      closeRebillModal();
      await refreshDashboard();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '⚡ Charge Card Now';
    }
  };

  // Customer Detail Modal
  window.openCustomerDetail = function (scheduleId) {
    const sub = (dashboardData?.schedules || []).find((s) => s.scheduleId === scheduleId);
    if (!sub) return;
    document.getElementById('detail-modal-title').textContent = sub.donorName || 'Generous Supporter';
    document.getElementById('detail-modal-subtitle').textContent = `${sub.scheduleId} · Vault Token: ${sub.vaultId}`;

    const payments = sub.payments || [];
    document.getElementById('detail-modal-body').innerHTML = `
      <div class="grid grid-cols-3 gap-3">
        <div class="p-3.5 rounded-lg bg-[#edf9f3] border border-[#c2ecd7] text-center">
          <p class="text-xl font-bold text-[#00875a] tabular-numbers">${fmt(sub.totalDonated)}</p>
          <p class="text-[11px] text-slate-600">Total Gross Donated</p>
        </div>
        <div class="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-center">
          <p class="text-xl font-bold text-[#061b31] tabular-numbers">${fmt(sub.totalNet)}</p>
          <p class="text-[11px] text-slate-500">Total Net (After Fees)</p>
        </div>
        <div class="p-3.5 rounded-lg bg-indigo-50/60 border border-indigo-100 text-center">
          <p class="text-xl font-bold text-[#635bff] tabular-numbers">${sub.rebillCount || 0} rebills</p>
          <p class="text-[11px] text-slate-500">${sub.donationCount || 1} total charges</p>
        </div>
      </div>

      <div class="p-4 rounded-lg bg-[#f8fafd] border border-slate-200 space-y-1.5 text-xs">
        <div class="flex justify-between"><span class="text-slate-400">PayPal Vault Token ID:</span> <span class="font-mono font-bold text-[#635bff]">${esc(sub.vaultId)}</span></div>
        <div class="flex justify-between"><span class="text-slate-400">Payment Method:</span> <span class="font-semibold text-[#061b31]">${esc(sub.cardBrand)} •••• ${esc(sub.cardLast4)} (exp ${esc(sub.cardExpiry || '—')})</span></div>
        <div class="flex justify-between"><span class="text-slate-400">Network Transaction Ref:</span> <span class="font-mono text-slate-700">${esc(sub.lastNetworkReferenceId || '—')}</span></div>
        <div class="flex justify-between"><span class="text-slate-400">Location &amp; Device:</span> <span class="text-slate-700">${esc(sub.location || '—')} · ${esc(sub.device || '—')}</span></div>
        <div class="flex justify-between"><span class="text-slate-400">Campaign Attribution:</span> <span class="font-mono text-slate-700">${esc(sub.utmCampaign || 'direct')}</span></div>
      </div>

      <div>
        <h4 class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2.5">Charge History (${payments.length})</h4>
        <div class="space-y-2">
          ${payments
            .map(
              (p) => `
            <div class="p-3 rounded-lg border border-slate-200 flex items-center justify-between text-xs">
              <div>
                <span class="font-bold text-[#061b31] tabular-numbers">${fmt(p.amount)}</span>
                <span class="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold ${p.type === 'REBILL' ? 'bg-indigo-50 text-[#635bff]' : 'bg-emerald-50 text-[#00875a]'}">${p.type === 'REBILL' ? 'MIT REBILL' : 'INITIAL'}</span>
                <div class="text-[11px] text-slate-400 font-mono mt-0.5">Capture ${esc(p.captureId)} · ${esc(fmtDateShort(p.createdAt))}</div>
              </div>
              <div class="text-right font-mono">
                <div class="text-[#00875a] font-bold">Net ${fmt(p.netAmount || p.amount)}</div>
                <div class="text-[11px] text-[#df1b41]">Fee −${fmt(p.paypalFee || 0)}</div>
              </div>
            </div>
          `
            )
            .join('')}
        </div>
      </div>
    `;

    document.getElementById('detail-modal').classList.remove('hidden');
  };

  window.closeDetailModal = function () {
    document.getElementById('detail-modal').classList.add('hidden');
  };

  // Delete Modal
  window.openDeleteModal = function (scheduleId) {
    const sub = (dashboardData?.schedules || []).find((s) => s.scheduleId === scheduleId);
    if (!sub) return;
    selectedSubForDelete = sub;
    document.getElementById('delete-sub-info').innerHTML = `
      <div class="font-bold">${esc(sub.donorName)} (${fmt(sub.amount)} / ${esc(sub.frequency)})</div>
      <div class="font-mono text-[11px]">Schedule: ${esc(sub.scheduleId)} · Vault: ${esc(sub.vaultId)}</div>
    `;
    document.getElementById('delete-modal').classList.remove('hidden');
  };

  window.closeDeleteModal = function () {
    document.getElementById('delete-modal').classList.add('hidden');
    selectedSubForDelete = null;
  };

  window.confirmDeleteSub = async function () {
    if (!selectedSubForDelete) return;
    const btn = document.getElementById('delete-confirm-btn');
    btn.disabled = true;
    btn.textContent = 'Removing…';

    try {
      const res = await fetch(`/api/subscriptions/${encodeURIComponent(selectedSubForDelete.scheduleId)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete subscription');
      showToast(`Removed subscription ${selectedSubForDelete.scheduleId}`);
      closeDeleteModal();
      await refreshDashboard();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Remove Subscription';
    }
  };

  // Create Subscription Modal
  window.openCreateSubModal = function () {
    document.getElementById('create-sub-error').classList.add('hidden');
    document.getElementById('create-sub-modal').classList.remove('hidden');
  };

  window.closeCreateSubModal = function () {
    document.getElementById('create-sub-modal').classList.add('hidden');
  };

  window.switchCreateMode = function (mode) {
    createMode = mode;
    const isCard = mode === 'card';
    document.getElementById('mode-card-btn').className = `flex-1 stripe-pill ${isCard ? 'active' : 'inactive'} text-center`;
    document.getElementById('mode-vault-btn').className = `flex-1 stripe-pill ${!isCard ? 'active' : 'inactive'} text-center`;
    document.getElementById('create-card-fields').classList.toggle('hidden', !isCard);
    document.getElementById('create-vault-fields').classList.toggle('hidden', isCard);
  };

  document.getElementById('create-sub-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('create-sub-error');
    const submitBtn = document.getElementById('create-sub-submit-btn');
    errEl.classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.textContent = createMode === 'card' ? 'Vaulting & Capturing…' : 'Saving…';

    try {
      const payload = {
        mode: createMode,
        donorName: document.getElementById('sub-donor-name').value,
        donorEmail: document.getElementById('sub-donor-email').value || null,
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
      if (!res.ok) throw new Error(data.error || 'Could not create subscription');

      showToast(`Created subscription ${data.schedule.scheduleId} (Vault ${data.schedule.vaultId})`);
      closeCreateSubModal();
      await refreshDashboard();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Subscription';
    }
  });

  window.exportSubscriptionsCSV = function () {
    const subs = dashboardData?.schedules || [];
    const headers = [
      'Schedule ID',
      'Donor Name',
      'Email',
      'Status',
      'Plan Amount',
      'Frequency',
      'Vault Token ID',
      'Card Brand',
      'Card Last4',
      'Total Gross Donated',
      'Total Net',
      'Rebill Count',
      'Campaign',
      'Created At',
      'Last Billed At',
    ];
    const rows = subs.map((s) => [
      s.scheduleId,
      s.donorName || '',
      s.donorEmail || '',
      s.status || 'ACTIVE',
      s.amount || '0.00',
      s.frequency || 'MONTH',
      s.vaultId || '',
      s.cardBrand || '',
      s.cardLast4 || '',
      s.totalDonated || 0,
      s.totalNet || 0,
      s.rebillCount || 0,
      s.utmCampaign || 'direct',
      s.createdAt || '',
      s.lastBilledAt || '',
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `subscriptions-cockpit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeRebillModal();
      closeDetailModal();
      closeCreateSubModal();
      closeDeleteModal();
    }
  });

  refreshDashboard();
})();
