import { Router } from 'express';
import { GoogleAdsApi, enums } from 'google-ads-api';
import { authenticate, managerOrAdmin } from '../middleware/auth.js';

export const googleAdsRouter = Router();
googleAdsRouter.use(authenticate);

function getClient() {
  const {
    GOOGLE_ADS_DEVELOPER_TOKEN,
    GOOGLE_ADS_CLIENT_ID,
    GOOGLE_ADS_CLIENT_SECRET,
  } = process.env;
  if (!GOOGLE_ADS_DEVELOPER_TOKEN || !GOOGLE_ADS_CLIENT_ID || !GOOGLE_ADS_CLIENT_SECRET) {
    throw new Error('Google Ads credentials missing in .env');
  }
  return new GoogleAdsApi({
    client_id: GOOGLE_ADS_CLIENT_ID,
    client_secret: GOOGLE_ADS_CLIENT_SECRET,
    developer_token: GOOGLE_ADS_DEVELOPER_TOKEN,
  });
}

function getCustomer() {
  const client = getClient();
  const customerId = (process.env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/-/g, '');
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  if (!customerId || !refreshToken) throw new Error('GOOGLE_ADS_CUSTOMER_ID or REFRESH_TOKEN missing');
  return client.Customer({ customer_id: customerId, refresh_token: refreshToken });
}

// GET /api/google-ads/status
googleAdsRouter.get('/status', (req, res) => {
  const configured = !!(
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
    process.env.GOOGLE_ADS_CLIENT_ID &&
    process.env.GOOGLE_ADS_CLIENT_SECRET &&
    process.env.GOOGLE_ADS_REFRESH_TOKEN &&
    process.env.GOOGLE_ADS_CUSTOMER_ID
  );
  res.json({
    configured,
    customerId: process.env.GOOGLE_ADS_CUSTOMER_ID || null,
  });
});

// GET /api/google-ads/campaigns?days=30
googleAdsRouter.get('/campaigns', async (req, res, next) => {
  try {
    const days = Math.min(parseInt(req.query.days as string) || 30, 90);
    const customer = getCustomer();

    const campaigns = await customer.query(`
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign.campaign_budget,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr,
        metrics.average_cpc
      FROM campaign
      WHERE segments.date DURING LAST_${days}_DAYS
        AND campaign.status != 'REMOVED'
      ORDER BY metrics.cost_micros DESC
      LIMIT 50
    `);

    const data = campaigns.map((c: any) => ({
      id: String(c.campaign.id),
      name: c.campaign.name,
      status: c.campaign.status === enums.CampaignStatus.ENABLED ? 'active' : 'paused',
      channelType: c.campaign.advertising_channel_type,
      impressions: Number(c.metrics.impressions || 0),
      clicks: Number(c.metrics.clicks || 0),
      cost: Number((Number(c.metrics.cost_micros || 0) / 1_000_000).toFixed(2)),
      conversions: Number(c.metrics.conversions || 0),
      ctr: Number(((c.metrics.ctr || 0) * 100).toFixed(2)),
      avgCpc: Number((Number(c.metrics.average_cpc || 0) / 1_000_000).toFixed(2)),
      costPerConversion:
        c.metrics.conversions > 0
          ? Number(
              (
                (Number(c.metrics.cost_micros || 0) / 1_000_000) /
                Number(c.metrics.conversions)
              ).toFixed(2)
            )
          : null,
    }));

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
    const customer = getCustomer();

    const rows = await customer.query(`
      SELECT
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr,
        metrics.average_cpc
      FROM campaign
      WHERE segments.date DURING LAST_${days}_DAYS
        AND campaign.status != 'REMOVED'
    `);

    const totals = rows.reduce(
      (acc: any, r: any) => ({
        impressions: acc.impressions + Number(r.metrics.impressions || 0),
        clicks: acc.clicks + Number(r.metrics.clicks || 0),
        cost: acc.cost + Number(r.metrics.cost_micros || 0) / 1_000_000,
        conversions: acc.conversions + Number(r.metrics.conversions || 0),
      }),
      { impressions: 0, clicks: 0, cost: 0, conversions: 0 }
    );

    totals.cost = Number(totals.cost.toFixed(2));
    totals.ctr = totals.impressions > 0
      ? Number(((totals.clicks / totals.impressions) * 100).toFixed(2))
      : 0;
    totals.avgCpc = totals.clicks > 0
      ? Number((totals.cost / totals.clicks).toFixed(2))
      : 0;
    totals.costPerConversion = totals.conversions > 0
      ? Number((totals.cost / totals.conversions).toFixed(2))
      : null;

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
    const { status } = req.body; // 'active' | 'paused'

    if (!['active', 'paused'].includes(status)) {
      return res.status(400).json({ error: 'status must be active or paused' });
    }

    const customer = getCustomer();
    const gStatus = status === 'active'
      ? enums.CampaignStatus.ENABLED
      : enums.CampaignStatus.PAUSED;

    await customer.campaigns.update([
      {
        resource_name: `customers/${(process.env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/-/g, '')}/campaigns/${id}`,
        status: gStatus,
      },
    ]);

    res.json({ success: true, id, status });
  } catch (err: any) {
    console.error('[Google Ads] status update error:', err.message);
    next(err);
  }
});
