import { Router, Request, Response } from 'express';
import { BetaAnalyticsDataClient } from '@google-analytics/data';
import { authenticate } from '../middleware/auth';

const router = Router();

// Lazy init — only when first request comes in
let gaClient: BetaAnalyticsDataClient | null = null;

function getGAClient(): BetaAnalyticsDataClient {
  if (!gaClient) {
    const saJson = process.env.GA_SERVICE_ACCOUNT_JSON;
    if (!saJson) throw new Error('GA_SERVICE_ACCOUNT_JSON not configured');
    const credentials = JSON.parse(saJson);
    gaClient = new BetaAnalyticsDataClient({ credentials });
  }
  return gaClient;
}

const PROPERTY_ID = process.env.GA_PROPERTY_ID || '399485645';

// Helper: format date for GA (YYYYMMDD → YYYY-MM-DD for display)
function formatDate(d: string) {
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

// GET /api/analytics/overview?days=30
router.get('/overview', authenticate, async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const client = getGAClient();

    const [report] = await client.runReport({
      property: `properties/${PROPERTY_ID}`,
      dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
      metrics: [
        { name: 'sessions' },
        { name: 'activeUsers' },
        { name: 'screenPageViews' },
        { name: 'bounceRate' },
        { name: 'averageSessionDuration' },
      ],
      dimensions: [{ name: 'date' }],
      orderBys: [{ dimension: { dimensionName: 'date' } }],
    });

    const rows = (report.rows || []).map(r => ({
      date: formatDate(r.dimensionValues![0].value!),
      sessions: parseInt(r.metricValues![0].value || '0'),
      users: parseInt(r.metricValues![1].value || '0'),
      pageviews: parseInt(r.metricValues![2].value || '0'),
      bounceRate: parseFloat(r.metricValues![3].value || '0'),
      avgDuration: parseFloat(r.metricValues![4].value || '0'),
    }));

    // Totals
    const totals = rows.reduce(
      (acc, r) => ({
        sessions: acc.sessions + r.sessions,
        users: acc.users + r.users,
        pageviews: acc.pageviews + r.pageviews,
      }),
      { sessions: 0, users: 0, pageviews: 0 }
    );

    res.json({ rows, totals });
  } catch (err: any) {
    console.error('GA overview error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/traffic-sources?days=30
router.get('/traffic-sources', authenticate, async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const client = getGAClient();

    const [report] = await client.runReport({
      property: `properties/${PROPERTY_ID}`,
      dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
      metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    });

    const channelLabels: Record<string, string> = {
      'Organic Search': '🔍 חיפוש אורגני',
      'Direct': '🔗 ישיר',
      'Paid Search': '💰 חיפוש ממומן',
      'Organic Social': '📱 סושיאל אורגני',
      'Paid Social': '💰 סושיאל ממומן',
      'Email': '📧 מייל',
      'Referral': '↗️ הפניות',
      'Display': '🖼️ Display',
      'Unassigned': '❓ לא ידוע',
    };

    const rows = (report.rows || []).map(r => {
      const channel = r.dimensionValues![0].value || 'Unassigned';
      return {
        channel,
        label: channelLabels[channel] || channel,
        sessions: parseInt(r.metricValues![0].value || '0'),
        users: parseInt(r.metricValues![1].value || '0'),
      };
    });

    res.json({ rows });
  } catch (err: any) {
    console.error('GA traffic sources error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/top-pages?days=30&limit=10
router.get('/top-pages', authenticate, async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const limit = parseInt(req.query.limit as string) || 10;
    const client = getGAClient();

    const [report] = await client.runReport({
      property: `properties/${PROPERTY_ID}`,
      dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
      metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }, { name: 'averageSessionDuration' }],
      dimensions: [{ name: 'pagePath' }, { name: 'pageTitle' }],
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
      limit,
    });

    const rows = (report.rows || []).map(r => ({
      path: r.dimensionValues![0].value || '/',
      title: r.dimensionValues![1].value || '',
      pageviews: parseInt(r.metricValues![0].value || '0'),
      users: parseInt(r.metricValues![1].value || '0'),
      avgDuration: parseFloat(r.metricValues![2].value || '0'),
    }));

    res.json({ rows });
  } catch (err: any) {
    console.error('GA top pages error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/devices?days=30
router.get('/devices', authenticate, async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const client = getGAClient();

    const [report] = await client.runReport({
      property: `properties/${PROPERTY_ID}`,
      dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
      metrics: [{ name: 'sessions' }],
      dimensions: [{ name: 'deviceCategory' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    });

    const deviceLabels: Record<string, string> = {
      'desktop': '🖥️ מחשב',
      'mobile': '📱 נייד',
      'tablet': '📟 טאבלט',
    };

    const rows = (report.rows || []).map(r => {
      const device = r.dimensionValues![0].value || '';
      return {
        device,
        label: deviceLabels[device] || device,
        sessions: parseInt(r.metricValues![0].value || '0'),
      };
    });

    res.json({ rows });
  } catch (err: any) {
    console.error('GA devices error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/realtime — active users in last 30 minutes
router.get('/realtime', authenticate, async (req: Request, res: Response) => {
  try {
    const client = getGAClient();

    const [report] = await client.runRealtimeReport({
      property: `properties/${PROPERTY_ID}`,
      metrics: [{ name: 'activeUsers' }],
      dimensions: [{ name: 'minutesAgo' }],
    });

    const totalActive = (report.rows || []).reduce(
      (sum, r) => sum + parseInt(r.metricValues![0].value || '0'), 0
    );

    // Also get breakdown by page
    const [pageReport] = await client.runRealtimeReport({
      property: `properties/${PROPERTY_ID}`,
      metrics: [{ name: 'activeUsers' }],
      dimensions: [{ name: 'unifiedPagePathScreen' }],
    });

    const byPage = (pageReport.rows || [])
      .map(r => ({
        path: r.dimensionValues![0].value || '/',
        users: parseInt(r.metricValues![0].value || '0'),
      }))
      .filter(r => r.users > 0)
      .sort((a, b) => b.users - a.users)
      .slice(0, 5);

    res.json({ activeUsers: totalActive, byPage });
  } catch (err: any) {
    console.error('GA realtime error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/geo?days=30&dimension=city|region|country
router.get('/geo', authenticate, async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const dimension = (req.query.dimension as string) || 'city';
    const limit = parseInt(req.query.limit as string) || 15;
    const client = getGAClient();

    const dimMap: Record<string, string> = {
      city: 'city',
      region: 'region',
      country: 'country',
    };
    const gaDimension = dimMap[dimension] || 'city';

    const [report] = await client.runReport({
      property: `properties/${PROPERTY_ID}`,
      dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
      metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
      dimensions: [{ name: gaDimension }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit,
    });

    const rows = (report.rows || [])
      .map(r => ({
        name: r.dimensionValues![0].value || '(לא ידוע)',
        sessions: parseInt(r.metricValues![0].value || '0'),
        users: parseInt(r.metricValues![1].value || '0'),
      }))
      .filter(r => r.name !== '(not set)');

    res.json({ rows, dimension });
  } catch (err: any) {
    console.error('GA geo error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
