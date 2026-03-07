import { Router, Request, Response } from 'express';
import { authenticate, managerOrAdmin } from '../middleware/auth';
import { prisma } from '../utils/prisma.js';
// fetch is available globally in Node.js 18+

const router = Router();

const CLIENT_ID = process.env.LINKEDIN_CLIENT_ID!;
const CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET!;
const REDIRECT_URI = process.env.LINKEDIN_REDIRECT_URI || 'https://crm.orma-ai.com/api/linkedin/callback';
const COMPANY_ID = process.env.LINKEDIN_COMPANY_ID || 'hai-tech-way';

const SCOPES = ['openid', 'profile', 'email', 'w_member_social'];

// Helper: get token from DB
async function getToken(): Promise<{ accessToken: string; expiresAt: Date; sub: string } | null> {
  const row = await prisma.botConfig.findUnique({ where: { key: 'linkedin_token' } });
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

// Helper: save token to DB
async function saveToken(data: object) {
  await prisma.botConfig.upsert({
    where: { key: 'linkedin_token' },
    update: { value: JSON.stringify(data), updatedAt: new Date(), updatedBy: 'system' },
    create: { key: 'linkedin_token', value: JSON.stringify(data), updatedBy: 'system' },
  });
}

// GET /api/linkedin/auth — redirect to LinkedIn OAuth
router.get('/auth', authenticate, managerOrAdmin, (req: Request, res: Response) => {
  const state = Math.random().toString(36).slice(2);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES.join(' '),
    state,
  });
  res.redirect(`https://www.linkedin.com/oauth/v2/authorization?${params}`);
});

// GET /api/linkedin/callback — OAuth callback
router.get('/callback', async (req: Request, res: Response) => {
  const { code, error } = req.query as Record<string, string>;
  if (error || !code) {
    return res.redirect(`/linkedin?error=${encodeURIComponent(error || 'cancelled')}`);
  }
  try {
    // Exchange code for token
    const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }).toString(),
    });
    const tokenData = await tokenRes.json() as any;
    if (!tokenData.access_token) throw new Error(tokenData.error_description || 'Token exchange failed');

    // Get user profile
    const profileRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileRes.json() as any;

    await saveToken({
      accessToken: tokenData.access_token,
      expiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
      sub: profile.sub,
      name: profile.name,
      email: profile.email,
    });

    res.redirect('/linkedin?connected=1');
  } catch (err: any) {
    console.error('LinkedIn callback error:', err.message);
    res.redirect(`/linkedin?error=${encodeURIComponent(err.message)}`);
  }
});

// GET /api/linkedin/status — check if connected
router.get('/status', authenticate, async (req: Request, res: Response) => {
  const token = await getToken();
  if (!token) return res.json({ connected: false });
  const isExpired = new Date(token.expiresAt) < new Date();
  res.json({
    connected: !isExpired,
    expired: isExpired,
    name: (token as any).name,
    email: (token as any).email,
    expiresAt: token.expiresAt,
  });
});

// POST /api/linkedin/post — create a text post
router.post('/post', authenticate, managerOrAdmin, async (req: Request, res: Response) => {
  const { text, visibility = 'PUBLIC' } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'text required' });

  const tokenData = await getToken();
  if (!tokenData) return res.status(401).json({ error: 'LinkedIn not connected' });
  if (new Date(tokenData.expiresAt) < new Date()) return res.status(401).json({ error: 'LinkedIn token expired' });

  try {
    const body = {
      author: `urn:li:person:${tokenData.sub}`,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text },
          shareMediaCategory: 'NONE',
        },
      },
      visibility: {
        'com.linkedin.ugc.MemberNetworkVisibility': visibility,
      },
    };

    const res2 = await fetch('https://api.linkedin.com/v2/ugcPosts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenData.accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify(body),
    });

    const data = await res2.json() as any;
    if (!res2.ok) throw new Error(data.message || JSON.stringify(data));

    // Save to DB
    await prisma.botConfig.upsert({
      where: { key: 'linkedin_posts' },
      update: { value: JSON.stringify([{ id: data.id, text: text.slice(0, 100), createdAt: new Date(), status: 'published' }, ...JSON.parse((await prisma.botConfig.findUnique({ where: { key: 'linkedin_posts' } }))?.value || '[]').slice(0, 19)]), updatedAt: new Date(), updatedBy: 'system' },
      create: { key: 'linkedin_posts', value: JSON.stringify([{ id: data.id, text: text.slice(0, 100), createdAt: new Date(), status: 'published' }]), updatedBy: 'system' },
    });

    res.json({ success: true, postId: data.id });
  } catch (err: any) {
    console.error('LinkedIn post error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/linkedin/posts — list saved posts
router.get('/posts', authenticate, async (req: Request, res: Response) => {
  const row = await prisma.botConfig.findUnique({ where: { key: 'linkedin_posts' } });
  const posts = row ? JSON.parse(row.value) : [];
  res.json({ posts });
});

// GET /api/linkedin/profile — get connected user profile
router.get('/profile', authenticate, async (req: Request, res: Response) => {
  const tokenData = await getToken();
  if (!tokenData) return res.status(401).json({ error: 'not connected' });
  try {
    const profileRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.accessToken}` },
    });
    const profile = await profileRes.json();
    res.json(profile);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/linkedin/disconnect
router.delete('/disconnect', authenticate, managerOrAdmin, async (req: Request, res: Response) => {
  await prisma.botConfig.deleteMany({ where: { key: { in: ['linkedin_token', 'linkedin_posts'] } } });
  res.json({ success: true });
});

export default router;
