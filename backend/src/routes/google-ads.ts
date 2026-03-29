/**
 * Google Ads integration for HaiTech CRM.
 *
 * Uses google-ads-api npm package (same as Tosca Dashboard).
 * TypeScript types come from a lightweight stub (src/stubs/google-ads-api.ts)
 * to avoid compilation hanging on the package's enormous generated type definitions.
 * At runtime Node.js loads the real package from node_modules.
 */
import { Router } from 'express';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';
import { GoogleAdsApi } from 'google-ads-api';

export const googleAdsRouter = Router();
googleAdsRouter.use(authenticate);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns { startDate, endDate } strings in YYYY-MM-DD for Google Ads GAQL */
function getDateRange(days: number): { startDate: string; endDate: string } {
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() - 1); // yesterday (Google Ads data lags 1 day)
  const start = new Date(now);
  start.setDate(start.getDate() - days);
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  return { startDate: fmt(start), endDate: fmt(end) };
}

function getCustomer() {
  const {
    GOOGLE_ADS_DEVELOPER_TOKEN,
    GOOGLE_ADS_CLIENT_ID,
    GOOGLE_ADS_CLIENT_SECRET,
    GOOGLE_ADS_REFRESH_TOKEN,
    GOOGLE_ADS_CUSTOMER_ID,
  } = process.env;

  if (!GOOGLE_ADS_DEVELOPER_TOKEN || !GOOGLE_ADS_CLIENT_ID || !GOOGLE_ADS_CLIENT_SECRET
      || !GOOGLE_ADS_REFRESH_TOKEN || !GOOGLE_ADS_CUSTOMER_ID) {
    throw new Error('Google Ads credentials missing in .env');
  }

  const client = new GoogleAdsApi({
    client_id: GOOGLE_ADS_CLIENT_ID,
    client_secret: GOOGLE_ADS_CLIENT_SECRET,
    developer_token: GOOGLE_ADS_DEVELOPER_TOKEN,
  });

  return client.Customer({
    customer_id: GOOGLE_ADS_CUSTOMER_ID.replace(/-/g, ''),
    refresh_token: GOOGLE_ADS_REFRESH_TOKEN,
  });
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/google-ads/status
googleAdsRouter.get('/status', (_req, res) => {
  const configured = !!(
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
    process.env.GOOGLE_ADS_CLIENT_ID &&
    process.env.GOOGLE_ADS_CLIENT_SECRET &&
    process.env.GOOGLE_ADS_REFRESH_TOKEN &&
    process.env.GOOGLE_ADS_CUSTOMER_ID
  );
  res.json({ configured, customerId: process.env.GOOGLE_ADS_CUSTOMER_ID || null });
});

// GET /api/google-ads/campaigns?days=30
googleAdsRouter.get('/campaigns', async (req, res, next) => {
  try {
    const days = Math.min(parseInt(req.query.days as string) || 30, 365);
    const { startDate, endDate } = getDateRange(days);

    const customer = getCustomer();

    // Query 1: all campaigns (including paused with no recent activity)
    const campaignList = await customer.query(`
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type
      FROM campaign
      WHERE campaign.status != 'REMOVED'
      ORDER BY campaign.name ASC
      LIMIT 50
    `);

    // Query 2: metrics for the date range (only campaigns with activity)
    const metricsResults = await customer.query(`
      SELECT
        campaign.id,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr,
        metrics.average_cpc
      FROM campaign
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND campaign.status != 'REMOVED'
      ORDER BY metrics.cost_micros DESC
      LIMIT 50
    `);

    // Build metrics map by campaign id
    const metricsMap = new Map<string, Record<string, unknown>>();
    for (const r of metricsResults) {
      const rec = r as Record<string, unknown>;
      const c = rec['campaign'] as Record<string, unknown>;
      const id = String(c?.['id'] ?? '');
      if (id) metricsMap.set(id, rec['metrics'] as Record<string, unknown>);
    }

    const data = campaignList.map((r: Record<string, unknown>) => {
      const c = r['campaign'] as Record<string, unknown>;
      const id = String(c?.['id'] ?? '');
      const m = metricsMap.get(id) ?? {};
      const costMicros = Number((m as Record<string, unknown>)?.['costMicros'] ?? (m as Record<string, unknown>)?.['cost_micros'] ?? 0);
      const cost = Number((costMicros / 1_000_000).toFixed(2));
      const conversions = Number((m as Record<string, unknown>)?.['conversions'] ?? 0);
      const avgCpcMicros = Number((m as Record<string, unknown>)?.['averageCpc'] ?? (m as Record<string, unknown>)?.['average_cpc'] ?? 0);
      const statusVal = String(c?.['status'] ?? '');

      return {
        id,
        name: String(c?.['name'] ?? ''),
        status: (statusVal === 'ENABLED' || statusVal === '2') ? 'active' : 'paused',
        channelType: String(c?.['advertisingChannelType'] ?? c?.['advertising_channel_type'] ?? ''),
        impressions: Number((m as Record<string, unknown>)?.['impressions'] ?? 0),
        clicks: Number((m as Record<string, unknown>)?.['clicks'] ?? 0),
        cost,
        conversions,
        ctr: Number(((Number((m as Record<string, unknown>)?.['ctr'] ?? 0)) * 100).toFixed(2)),
        avgCpc: Number((avgCpcMicros / 1_000_000).toFixed(2)),
        costPerConversion: conversions > 0 ? Number((cost / conversions).toFixed(2)) : null,
      };
    });

    res.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Google Ads] campaigns error:', msg);
    next(err);
  }
});

// GET /api/google-ads/summary?days=30
googleAdsRouter.get('/summary', async (req, res, next) => {
  try {
    const days = Math.min(parseInt(req.query.days as string) || 30, 365);
    const { startDate, endDate } = getDateRange(days);

    const customer = getCustomer();
    const results = await customer.query(`
      SELECT
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions
      FROM campaign
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND campaign.status != 'REMOVED'
    `);

    const totals = results.reduce(
      (acc: { impressions: number; clicks: number; cost: number; conversions: number },
       r: Record<string, unknown>) => {
        const m = r['metrics'] as Record<string, unknown> | undefined;
        return {
          impressions: acc.impressions + Number(m?.['impressions'] ?? 0),
          clicks: acc.clicks + Number(m?.['clicks'] ?? 0),
          cost: acc.cost + Number(m?.['costMicros'] ?? m?.['cost_micros'] ?? 0) / 1_000_000,
          conversions: acc.conversions + Number(m?.['conversions'] ?? 0),
        };
      },
      { impressions: 0, clicks: 0, cost: 0, conversions: 0 }
    );

    const cost = Number(totals.cost.toFixed(2));
    const ctr = totals.impressions > 0
      ? Number(((totals.clicks / totals.impressions) * 100).toFixed(2)) : 0;
    const avgCpc = totals.clicks > 0
      ? Number((cost / totals.clicks).toFixed(2)) : 0;
    const costPerConversion = totals.conversions > 0
      ? Number((cost / totals.conversions).toFixed(2)) : null;

    res.json({ impressions: totals.impressions, clicks: totals.clicks, cost, conversions: totals.conversions, ctr, avgCpc, costPerConversion, days });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Google Ads] summary error:', msg);
    next(err);
  }
});

// GET /api/google-ads/daily?days=30 — daily conversions + clicks + cost for all campaigns
googleAdsRouter.get('/daily', async (req, res, next) => {
  try {
    const days = Math.min(parseInt(req.query.days as string) || 30, 365);
    const { startDate, endDate } = getDateRange(days);

    const customer = getCustomer();
    const results = await customer.query(`
      SELECT
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions
      FROM campaign
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND campaign.status != 'REMOVED'
      ORDER BY segments.date ASC
    `);

    // Aggregate by date across all campaigns
    const byDate = new Map<string, { impressions: number; clicks: number; cost: number; conversions: number }>();
    for (const r of results) {
      const rec = r as Record<string, unknown>;
      const s = rec['segments'] as Record<string, unknown>;
      const m = rec['metrics'] as Record<string, unknown>;
      const date = String(s?.['date'] ?? '');
      if (!date) continue;
      const existing = byDate.get(date) ?? { impressions: 0, clicks: 0, cost: 0, conversions: 0 };
      byDate.set(date, {
        impressions: existing.impressions + Number(m?.['impressions'] ?? 0),
        clicks: existing.clicks + Number(m?.['clicks'] ?? 0),
        cost: existing.cost + Number(m?.['costMicros'] ?? m?.['cost_micros'] ?? 0) / 1_000_000,
        conversions: existing.conversions + Number(m?.['conversions'] ?? 0),
      });
    }

    const data = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, metrics]) => ({
        date,
        impressions: metrics.impressions,
        clicks: metrics.clicks,
        cost: Number(metrics.cost.toFixed(2)),
        conversions: Number(metrics.conversions.toFixed(2)),
      }));

    res.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Google Ads] daily error:', msg);
    next(err);
  }
});

// GET /api/google-ads/campaigns/:id?days=30 — campaign detail
googleAdsRouter.get('/campaigns/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const days = Math.min(parseInt(req.query.days as string) || 30, 365);
    const { startDate, endDate } = getDateRange(days);

    const customer = getCustomer();

    // 1. Basic campaign info
    const campaignResults = await customer.query(`
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign_budget.amount_micros
      FROM campaign
      WHERE campaign.id = ${id}
      LIMIT 1
    `);

    if (!campaignResults.length) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const cr = campaignResults[0] as Record<string, unknown>;
    const c = cr['campaign'] as Record<string, unknown>;
    const cb = cr['campaign_budget'] as Record<string, unknown>;
    const statusVal = String(c?.['status'] ?? '');

    // 2. Ad groups
    const adGroupResults = await customer.query(`
      SELECT
        ad_group.id,
        ad_group.name,
        ad_group.status,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions
      FROM ad_group
      WHERE campaign.id = ${id}
        AND segments.date BETWEEN '${startDate}' AND '${endDate}'
      ORDER BY metrics.cost_micros DESC
      LIMIT 20
    `);

    // 3. Daily metrics
    const dailyResults = await customer.query(`
      SELECT
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions
      FROM campaign
      WHERE campaign.id = ${id}
        AND segments.date BETWEEN '${startDate}' AND '${endDate}'
      ORDER BY segments.date ASC
    `);

    // Aggregate overall metrics from daily rows
    let totalImpressions = 0, totalClicks = 0, totalCostMicros = 0, totalConversions = 0;
    const dailyMetrics = dailyResults.map((r: Record<string, unknown>) => {
      const m = r['metrics'] as Record<string, unknown>;
      const s = r['segments'] as Record<string, unknown>;
      const imp = Number(m?.['impressions'] ?? 0);
      const clk = Number(m?.['clicks'] ?? 0);
      const cst = Number(m?.['costMicros'] ?? m?.['cost_micros'] ?? 0);
      const conv = Number(m?.['conversions'] ?? 0);
      totalImpressions += imp;
      totalClicks += clk;
      totalCostMicros += cst;
      totalConversions += conv;
      return {
        date: String(s?.['date'] ?? ''),
        impressions: imp,
        clicks: clk,
        cost: Number((cst / 1_000_000).toFixed(2)),
        conversions: conv,
      };
    });

    const cost = Number((totalCostMicros / 1_000_000).toFixed(2));
    const ctr = totalImpressions > 0 ? Number(((totalClicks / totalImpressions) * 100).toFixed(2)) : 0;
    const avgCpc = totalClicks > 0 ? Number((cost / totalClicks).toFixed(2)) : 0;

    const adGroups = adGroupResults.map((r: Record<string, unknown>) => {
      const ag = r['ad_group'] as Record<string, unknown>;
      const m = r['metrics'] as Record<string, unknown>;
      const agCostMicros = Number(m?.['costMicros'] ?? m?.['cost_micros'] ?? 0);
      return {
        id: String(ag?.['id'] ?? ''),
        name: String(ag?.['name'] ?? ''),
        status: String(ag?.['status'] ?? ''),
        impressions: Number(m?.['impressions'] ?? 0),
        clicks: Number(m?.['clicks'] ?? 0),
        cost: Number((agCostMicros / 1_000_000).toFixed(2)),
        conversions: Number(m?.['conversions'] ?? 0),
      };
    });

    const budgetMicros = Number(cb?.['amountMicros'] ?? cb?.['amount_micros'] ?? 0);

    res.json({
      id: String(c?.['id'] ?? ''),
      name: String(c?.['name'] ?? ''),
      status: (statusVal === 'ENABLED' || statusVal === '2') ? 'active' : 'paused',
      channelType: String(c?.['advertisingChannelType'] ?? c?.['advertising_channel_type'] ?? ''),
      budget: Number((budgetMicros / 1_000_000).toFixed(2)),
      impressions: totalImpressions,
      clicks: totalClicks,
      cost,
      conversions: totalConversions,
      ctr,
      avgCpc,
      costPerConversion: totalConversions > 0 ? Number((cost / totalConversions).toFixed(2)) : null,
      adGroups,
      dailyMetrics,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Google Ads] campaign detail error:', msg);
    next(err);
  }
});

// PATCH /api/google-ads/campaigns/:id/status — enable/pause
googleAdsRouter.patch('/campaigns/:id/status', managerOrAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body as { status: string };

    if (!['active', 'paused'].includes(status)) {
      return res.status(400).json({ error: 'status must be active or paused' });
    }

    const customer = getCustomer();
    const customerId = (process.env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/-/g, '');
    const newStatus = status === 'active' ? 2 : 3; // 2=ENABLED, 3=PAUSED

    await customer.mutateResources([{
      _resource: 'Campaign',
      resource_name: `customers/${customerId}/campaigns/${id}`,
      status: newStatus,
    }]);

    res.json({ success: true, id, status });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Google Ads] status update error:', msg);
    next(err);
  }
});
