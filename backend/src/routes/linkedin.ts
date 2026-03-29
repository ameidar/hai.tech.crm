import { Router, Request, Response } from 'express';
import { authenticate, managerOrAdmin } from '../middleware/auth';
import { prisma } from '../utils/prisma.js';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const router = Router();

const CLIENT_ID = process.env.LINKEDIN_CLIENT_ID || '';
const CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.LINKEDIN_REDIRECT_URI || 'https://crm.orma-ai.com/api/linkedin/callback';

const SCOPES = ['openid', 'profile', 'email', 'w_member_social'];

// Helper: get config value from bot_config table
async function getConfig(key: string): Promise<string | null> {
  try {
    const rows = await prisma.$queryRaw<{ value: string }[]>`
      SELECT value FROM bot_config WHERE key = ${key} LIMIT 1
    `;
    return rows[0]?.value || null;
  } catch {
    return null;
  }
}

// Helper: save config value to bot_config table
async function setConfig(key: string, value: string): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO bot_config (key, value, updated_at, updated_by)
    VALUES (${key}, ${value}, NOW(), 'system')
    ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = NOW()
  `;
}

// Helper: get LinkedIn token
async function getToken(): Promise<{ accessToken: string; expiresAt: string; sub: string; name?: string; email?: string } | null> {
  const raw = await getConfig('linkedin_token');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// GET /api/linkedin/auth — redirect to LinkedIn OAuth (public; LinkedIn handles user auth)
router.get('/auth', (_req: Request, res: Response) => {
  if (!CLIENT_ID) {
    return res.status(503).json({ error: 'LinkedIn not configured (LINKEDIN_CLIENT_ID missing)' });
  }
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

    await setConfig('linkedin_token', JSON.stringify({
      accessToken: tokenData.access_token,
      expiresAt: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
      sub: profile.sub,
      name: profile.name,
      email: profile.email,
    }));

    res.redirect('/linkedin?connected=1');
  } catch (err: any) {
    console.error('LinkedIn callback error:', err.message);
    res.redirect(`/linkedin?error=${encodeURIComponent(err.message)}`);
  }
});

// GET /api/linkedin/status — check if connected
router.get('/status', authenticate, async (_req: Request, res: Response) => {
  if (!CLIENT_ID) {
    return res.json({ connected: false, notConfigured: true });
  }
  const token = await getToken();
  if (!token) return res.json({ connected: false });
  const isExpired = new Date(token.expiresAt) < new Date();
  res.json({
    connected: !isExpired,
    expired: isExpired,
    name: token.name,
    email: token.email,
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

    const postRes = await fetch('https://api.linkedin.com/v2/ugcPosts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenData.accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify(body),
    });

    const data = await postRes.json() as any;
    if (!postRes.ok) throw new Error(data.message || JSON.stringify(data));

    // Save post to history
    const existingRaw = await getConfig('linkedin_posts');
    const existing = existingRaw ? JSON.parse(existingRaw) : [];
    const updated = [{ id: data.id, text: text.slice(0, 100), createdAt: new Date().toISOString(), status: 'published' }, ...existing].slice(0, 20);
    await setConfig('linkedin_posts', JSON.stringify(updated));

    res.json({ success: true, postId: data.id });
  } catch (err: any) {
    console.error('LinkedIn post error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/linkedin/posts — list saved posts
router.get('/posts', authenticate, async (_req: Request, res: Response) => {
  const raw = await getConfig('linkedin_posts');
  const posts = raw ? JSON.parse(raw) : [];
  res.json({ posts });
});

// GET /api/linkedin/profile — get connected user profile
router.get('/profile', authenticate, async (_req: Request, res: Response) => {
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
router.delete('/disconnect', authenticate, managerOrAdmin, async (_req: Request, res: Response) => {
  try {
    await prisma.$executeRaw`DELETE FROM bot_config WHERE key IN ('linkedin_token', 'linkedin_posts')`;
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/linkedin/generate — AI-powered LinkedIn post generator
router.post('/generate', authenticate, managerOrAdmin, async (req: Request, res: Response) => {
  const { direction, tone = 'professional' } = req.body;
  if (!direction?.trim()) return res.status(400).json({ error: 'direction required' });

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `אתה מומחה לכתיבת תוכן LinkedIn עבור דרך ההייטק — עסק לחוגי תכנות לילדים בישראל.
כתוב פוסטים שמניעים מעורבות גבוהה ב-LinkedIn.

עקרונות לפוסט LinkedIn מוצלח:
- שורה ראשונה חזקה שגורמת לאנשים ללחוץ "see more" (hook)
- סיפור אישי / תובנה / נתון מפתיע
- פסקאות קצרות (1-2 שורות) עם רווחים
- 3-5 hashtags רלוונטיים בסוף (תמיד כולל #דרךההייטק #HaiTech)
- Call to action בסוף (שאלה לקהל / הזמנה לפעולה)
- אורך אידיאלי: 150-300 מילים
- שפה: עברית (אלא אם המשתמש ביקש אחרת)
- טון: ${tone}

חשוב: בסוף כל פוסט הוסף שורה: "🔗 linkedin.com/company/hai-tech-way"
(זה מתייג את דף החברה של דרך ההייטק בלינקדאין)`
        },
        {
          role: 'user',
          content: `כתוב לי פוסט LinkedIn על הנושא הבא:\n${direction}`
        }
      ],
      temperature: 0.8,
      max_tokens: 800,
    });

    const post = completion.choices[0]?.message?.content?.trim() || '';
    res.json({ post });
  } catch (err: any) {
    console.error('LinkedIn generate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
