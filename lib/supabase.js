const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

const supabase =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

function isSupabaseConfigured() {
  return Boolean(supabase);
}

function scheduleToRow(s) {
  return {
    schedule_id: s.scheduleId,
    status: s.status || 'ACTIVE',
    vault_id: s.vaultId,
    vault_status: s.vaultStatus || 'VAULTED',
    customer_id: s.customerId || null,
    donor_name: s.donorName || 'Generous Supporter',
    donor_email: s.donorEmail || null,
    visitor_id: s.visitorId || null,
    ip_address: s.ipAddress || null,
    location: s.location || null,
    device: s.device || null,
    frequency: s.frequency || 'MONTH',
    amount: Number.parseFloat(s.amount) || 0,
    currency: s.currency || 'USD',
    card_brand: s.cardBrand || null,
    card_last4: s.cardLast4 || null,
    card_expiry: s.cardExpiry || null,
    initial_order_id: s.initialOrderId || null,
    initial_capture_id: s.initialCaptureId || null,
    last_network_reference_id: s.lastNetworkReferenceId || null,
    network_name: s.networkName || null,
    utm_campaign: s.utmCampaign || null,
    utm_source: s.utmSource || null,
    utm_medium: s.utmMedium || null,
    utm_content: s.utmContent || null,
    fbclid: s.fbclid || null,
    notes: s.notes || null,
    rebill_count: Number.parseInt(s.rebillCount, 10) || 0,
    created_at: s.createdAt || new Date().toISOString(),
    last_billed_at: s.lastBilledAt || null,
  };
}

function rowToSchedule(r) {
  return {
    scheduleId: r.schedule_id,
    status: r.status || 'ACTIVE',
    vaultId: r.vault_id,
    vaultStatus: r.vault_status || 'VAULTED',
    customerId: r.customer_id || null,
    donorName: r.donor_name || 'Generous Supporter',
    donorEmail: r.donor_email || null,
    visitorId: r.visitor_id || null,
    ipAddress: r.ip_address || null,
    location: r.location || null,
    device: r.device || null,
    frequency: r.frequency || 'MONTH',
    amount: Number(r.amount || 0).toFixed(2),
    currency: r.currency || 'USD',
    cardBrand: r.card_brand || null,
    cardLast4: r.card_last4 || null,
    cardExpiry: r.card_expiry || '',
    initialOrderId: r.initial_order_id || null,
    initialCaptureId: r.initial_capture_id || null,
    lastNetworkReferenceId: r.last_network_reference_id || null,
    networkName: r.network_name || null,
    utmCampaign: r.utm_campaign || null,
    utmSource: r.utm_source || null,
    utmMedium: r.utm_medium || null,
    utmContent: r.utm_content || null,
    fbclid: r.fbclid || null,
    notes: r.notes || '',
    rebillCount: Number.parseInt(r.rebill_count, 10) || 0,
    createdAt: r.created_at,
    lastBilledAt: r.last_billed_at || null,
  };
}

function txToRow(t) {
  return {
    tx_id: t.txId,
    type: t.type || 'INITIAL',
    status: t.status || 'COMPLETED',
    schedule_id: t.scheduleId || null,
    order_id: t.orderId || null,
    capture_id: t.captureId || null,
    frequency: t.frequency || 'ONE_TIME',
    amount: Number.parseFloat(t.amount) || 0,
    base_amount: Number.parseFloat(t.baseAmount ?? t.amount) || 0,
    fee_covered: Number.parseFloat(t.feeCovered) || 0,
    paypal_fee:
      t.paypalFee !== null && t.paypalFee !== undefined
        ? Number.parseFloat(t.paypalFee)
        : null,
    net_amount:
      t.netAmount !== null && t.netAmount !== undefined
        ? Number.parseFloat(t.netAmount)
        : null,
    currency: t.currency || 'USD',
    donor_name: t.donorName || null,
    donor_email: t.donorEmail || null,
    payment_source: t.paymentSource || 'card',
    card_brand: t.cardBrand || null,
    card_last4: t.cardLast4 || null,
    card_expiry: t.cardExpiry || null,
    vault_id: t.vaultId || null,
    vault_status: t.vaultStatus || null,
    customer_id: t.customerId || null,
    network_reference_id: t.networkReferenceId || null,
    network_name: t.networkName || null,
    processor_response_code: t.processorResponseCode || null,
    failure_reason: t.failureReason || null,
    visitor_id: t.visitorId || null,
    ip_address: t.ipAddress || null,
    location: t.location || null,
    device: t.device || null,
    utm_campaign: t.utmCampaign || null,
    utm_source: t.utmSource || null,
    utm_medium: t.utmMedium || null,
    utm_content: t.utmContent || null,
    fbclid: t.fbclid || null,
    donate_event_id: t.donateEventId || null,
    capi_meta: t.capiMeta || null,
    capi_tiktok: t.capiTiktok || null,
    raw_response: t.rawResponse || null,
    created_at: t.createdAt || new Date().toISOString(),
  };
}

function rowToTx(r) {
  return {
    txId: r.tx_id,
    type: r.type || 'INITIAL',
    status: r.status || 'COMPLETED',
    scheduleId: r.schedule_id || null,
    orderId: r.order_id || null,
    captureId: r.capture_id || null,
    frequency: r.frequency || 'ONE_TIME',
    amount: Number(r.amount || 0).toFixed(2),
    baseAmount: Number(r.base_amount ?? r.amount ?? 0).toFixed(2),
    feeCovered: Number(r.fee_covered || 0).toFixed(2),
    paypalFee:
      r.paypal_fee !== null && r.paypal_fee !== undefined
        ? Number(r.paypal_fee).toFixed(2)
        : null,
    netAmount:
      r.net_amount !== null && r.net_amount !== undefined
        ? Number(r.net_amount).toFixed(2)
        : null,
    currency: r.currency || 'USD',
    donorName: r.donor_name || 'Generous Supporter',
    donorEmail: r.donor_email || null,
    paymentSource: r.payment_source || 'card',
    cardBrand: r.card_brand || null,
    cardLast4: r.card_last4 || null,
    cardExpiry: r.card_expiry || null,
    vaultId: r.vault_id || null,
    vaultStatus: r.vault_status || null,
    customerId: r.customer_id || null,
    networkReferenceId: r.network_reference_id || null,
    networkName: r.network_name || null,
    processorResponseCode: r.processor_response_code || null,
    failureReason: r.failure_reason || null,
    visitorId: r.visitor_id || null,
    ipAddress: r.ip_address || null,
    location: r.location || null,
    device: r.device || null,
    utmCampaign: r.utm_campaign || null,
    utmSource: r.utm_source || null,
    utmMedium: r.utm_medium || null,
    utmContent: r.utm_content || null,
    fbclid: r.fbclid || null,
    donateEventId: r.donate_event_id || null,
    capiMeta: r.capi_meta || null,
    capiTiktok: r.capi_tiktok || null,
    createdAt: r.created_at,
  };
}

async function hydrateStoreFromSupabase() {
  if (!supabase) return null;
  try {
    const [{ data: schedRows, error: schedErr }, { data: txRows, error: txErr }] =
      await Promise.all([
        supabase
          .from('paypal_donate_schedules')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(1000),
        supabase
          .from('paypal_donate_transactions')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(2000),
      ]);

    if (schedErr) {
      console.error('[supabase] hydrate schedules error:', schedErr.message);
      return null;
    }
    if (txErr) {
      console.error('[supabase] hydrate transactions error:', txErr.message);
      return null;
    }

    return {
      schedules: (schedRows || []).map(rowToSchedule),
      transactions: (txRows || []).map(rowToTx),
    };
  } catch (err) {
    console.error('[supabase] hydrate exception:', err.message);
    return null;
  }
}

async function upsertScheduleInSupabase(schedule) {
  if (!supabase || !schedule?.scheduleId) return;
  try {
    const { error } = await supabase
      .from('paypal_donate_schedules')
      .upsert(scheduleToRow(schedule), { onConflict: 'schedule_id' });
    if (error) {
      console.error('[supabase] upsert schedule error:', error.message);
    }
  } catch (err) {
    console.error('[supabase] upsert schedule exception:', err.message);
  }
}

async function deleteScheduleInSupabase(scheduleId) {
  if (!supabase || !scheduleId) return;
  try {
    const { error } = await supabase
      .from('paypal_donate_schedules')
      .delete()
      .eq('schedule_id', scheduleId);
    if (error) {
      console.error('[supabase] delete schedule error:', error.message);
    }
  } catch (err) {
    console.error('[supabase] delete schedule exception:', err.message);
  }
}

async function upsertTransactionInSupabase(tx) {
  if (!supabase || !tx?.txId) return;
  try {
    const { error } = await supabase
      .from('paypal_donate_transactions')
      .upsert(txToRow(tx), { onConflict: 'tx_id' });
    if (error) {
      console.error('[supabase] upsert transaction error:', error.message);
    }
  } catch (err) {
    console.error('[supabase] upsert transaction exception:', err.message);
  }
}

async function logEventInSupabase(evt) {
  if (!supabase || !evt?.eventType) return;
  try {
    const { error } = await supabase.from('paypal_donate_events').insert({
      visitor_id: evt.visitorId || null,
      event_type: evt.eventType,
      amount: evt.amount ? Number.parseFloat(evt.amount) : null,
      currency: evt.currency || 'USD',
      payment_method: evt.paymentMethod || null,
      details: evt.details ? String(evt.details).slice(0, 500) : null,
      ip_address: evt.ipAddress || null,
      country: evt.country || null,
      device: evt.device || null,
      source_url: evt.sourceUrl || null,
      capi_meta: evt.capiMeta || null,
      capi_tiktok: evt.capiTiktok || null,
      extra: evt.extra || null,
    });
    if (error) {
      console.error('[supabase] insert event error:', error.message);
    }
  } catch (err) {
    console.error('[supabase] insert event exception:', err.message);
  }
}

async function resetSupabaseTables() {
  if (!supabase) return { ok: true, supabase: false };
  try {
    await Promise.all([
      supabase.from('paypal_donate_transactions').delete().neq('tx_id', '__NONE__'),
      supabase.from('paypal_donate_schedules').delete().neq('schedule_id', '__NONE__'),
      supabase.from('paypal_donate_events').delete().gte('id', 0),
    ]);
    return { ok: true, supabase: true };
  } catch (err) {
    console.error('[supabase] reset tables error:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  supabase,
  isSupabaseConfigured,
  hydrateStoreFromSupabase,
  upsertScheduleInSupabase,
  deleteScheduleInSupabase,
  upsertTransactionInSupabase,
  logEventInSupabase,
  resetSupabaseTables,
};
