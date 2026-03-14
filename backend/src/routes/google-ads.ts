/**
 * Google Ads REST API integration
 * Uses Google Ads REST API directly (no heavy npm package) to avoid
 * TypeScript compilation issues with generated types.
 */
import { Router } from 'express';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';

export const googleAdsRouter = Router();
googleAdsRouter.use(authenticate);

const API_VERSION = 'v18';

// ─── Auth helpers ─────────────────────────────────────────────────────────────

async function getAccessToken(): Promise<string> {
  const { GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_ADS_CLIENT_ID || !GOOGLE_ADS_CLIENT_SECRET || !GOOGLE_ADS_REFRESH_TOKEN) {
    throw new Error('Google Ads OAuth credentials missing in .env');
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_ADS_CLIENT_ID,
      client_secret: GOOGLE_ADS_CLIENT_SECRET,
      refresh_token: GOOGLE_ADS_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OAuth token error: ${err}`);
  }

  const data = await res.json() as { access_token: string };
  return data.access_token;
}

async function googleAdsQuery(query: string): Promise<any[]> {
  const { GOOGLE_ADS_CUSTOMER_ID, GOOGLE_ADS_DEVELOPER_TOKEN } = process.env;
  if (!GOOGLE_ADS_CUSTOMER_ID || !GOOGLE_ADS_DEVELOPER_TOKEN) {
    throw new Error('GOOGLE_ADS_CUSTOMER_ID or DEVELOPER_TOKEN missing');
  }

  const customerId = GOOGLE_ADS_CUSTOMER_ID.replace(/-/g, '');
  const accessToken = await getAccessToken();

  const res = await fetch(
    `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/googleAds:search`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'developer-token': GOOGLE_ADS_DEVELOPER_TOKEN,
      },
      body: JSON.stringify({ query }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Ads API error ${res.status}: ${err}`);
  }

  const data = await res.json() as { results?: any[] };
  return data.results || [];
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

    const results = await googleAdsQuery(`
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

    const data = results.map((r: any) => {
      const c = r.campaign;
      const m = r.metrics;
      const cost = Number((Number(m?.costMicros || 0) / 1_000_000).toFixed(2));
      const conversions = Number(m?.conversions || 0);
      return {
        id: String(c.id),
        name: c.name,
        status: c.status === 'ENABLED' ? 'active' : 'paused',
        channelType: c.advertisingChannelType || '',
        impressions: Number(m?.impressions || 0),
        clicks: Number(m?.clicks || 0),
        cost,
        conversions,
        ctr: Number(((m?.ctr || 0) * 100).toFixed(2)),
        avgCpc: Number((Number(m?.averageCpc || 0) / 1_000_000).toFixed(2)),
        costPerConversion: conversions > 0 ? Number((cost / conversions).toFixed(2)) : null,
      };
    });

    res.json(data);
  } catch (err: any) {
    console.error('[Google Ads] campaigns error:', err.message);
    next(err);
  }
});

// GET /api/google-ads/summary?days=30
googleAdsRouter.get('/summary', async (req, res, next) => {
  try {
    const days = Math.min(parseInt(req.query.days as string) || 30, 90);
    const period = `LAST_${days}_DAYS`;

    const results = await googleAdsQuery(`
      SELECT
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr,
        metrics.average_cpc
      FROM campaign
      WHERE segments.date DURING ${period}
        AND campaign.status != 'REMOVED'
    `);

    const totals = results.reduce(
      (acc: any, r: any) => {
        const m = r.metrics || {};
        return {
          impressions: acc.impressions + Number(m.impressions || 0),
          clicks: acc.clicks + Number(m.clicks || 0),
          cost: acc.cost + Number(m.costMicros || 0) / 1_000_000,
          conversions: acc.conversions + Number(m.conversions || 0),
        };
      },
      { impressions: 0, clicks: 0, cost: 0, conversions: 0 }
    );

    totals.cost = Number(totals.cost.toFixed(2));
    totals.ctr = totals.impressions > 0
      ? Number(((totals.clicks / totals.impressions) * 100).toFixed(2)) : 0;
    totals.avgCpc = totals.clicks > 0
      ? Number((totals.cost / totals.clicks).toFixed(2)) : 0;
    totals.costPerConversion = totals.conversions > 0
      ? Number((totals.cost / totals.conversions).toFixed(2)) : null;

    res.json({ ...totals, days });
  } catch (err: any) {
    console.error('[Google Ads] summary error:', err.message);
    next(err);
  }
});

// PATCH /api/google-ads/campaigns/:id/status — enable/pause
googleAdsRouter.patch('/campaigns/:id/status', managerOrAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['active', 'paused'].includes(status)) {
      return res.status(400).json({ error: 'status must be active or paused' });
    }

    const { GOOGLE_ADS_CUSTOMER_ID, GOOGLE_ADS_DEVELOPER_TOKEN } = process.env;
    const customerId = (GOOGLE_ADS_CUSTOMER_ID || '').replace(/-/g, '');
    const accessToken = await getAccessToken();

    const mutateRes = await fetch(
      `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/campaigns:mutate`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'developer-token': GOOGLE_ADS_DEVELOPER_TOKEN!,
        },
        body: JSON.stringify({
          operations: [{
            update: {
              resourceName: `customers/${customerId}/campaigns/${id}`,
              status: status === 'active' ? 'ENABLED' : 'PAUSED',
            },
            updateMask: 'status',
          }],
        }),
      }
    );

    if (!mutateRes.ok) {
      const err = await mutateRes.text();
      throw new Error(`Google Ads mutate error: ${err}`);
    }

    res.json({ success: true, id, status });
  } catch (err: any) {
    console.error('[Google Ads] status update error:', err.message);
    next(err);
  }
});
