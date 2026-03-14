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

// ─── Helper ───────────────────────────────────────────────────────────────────

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
    const days = Math.min(parseInt(req.query.days as string) || 30, 90);
    const period = `LAST_${days}_DAYS`;

    const customer = getCustomer();
    const results = await customer.query(`
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr,
        metrics.average_cpc
      FROM campaign
      WHERE segments.date DURING ${period}
        AND campaign.status != 'REMOVED'
      ORDER BY metrics.cost_micros DESC
      LIMIT 50
    `);

    const data = results.map((r: Record<string, unknown>) => {
      const c = r['campaign'] as Record<string, unknown>;
      const m = r['metrics'] as Record<string, unknown>;
      const costMicros = Number(m?.['costMicros'] ?? m?.['cost_micros'] ?? 0);
      const cost = Number((costMicros / 1_000_000).toFixed(2));
      const conversions = Number(m?.['conversions'] ?? 0);
      const avgCpcMicros = Number(m?.['averageCpc'] ?? m?.['average_cpc'] ?? 0);
      const statusVal = String(c?.['status'] ?? '');

      return {
        id: String(c?.['id'] ?? ''),
        name: String(c?.['name'] ?? ''),
        status: (statusVal === 'ENABLED' || statusVal === '2') ? 'active' : 'paused',
        channelType: String(c?.['advertisingChannelType'] ?? c?.['advertising_channel_type'] ?? ''),
        impressions: Number(m?.['impressions'] ?? 0),
        clicks: Number(m?.['clicks'] ?? 0),
        cost,
        conversions,
        ctr: Number(((Number(m?.['ctr'] ?? 0)) * 100).toFixed(2)),
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
    const days = Math.min(parseInt(req.query.days as string) || 30, 90);
    const period = `LAST_${days}_DAYS`;

    const customer = getCustomer();
    const results = await customer.query(`
      SELECT
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions
      FROM campaign
      WHERE segments.date DURING ${period}
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
