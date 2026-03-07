/**
 * Social Media Routes — text gen, image gen (Gemini), publish to FB/IG
 */
import { Router, Request, Response } from 'express';
import { authenticate, managerOrAdmin } from '../middleware/auth';
import OpenAI from 'openai';

const router = Router();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const GEMINI_API_KEY = process.env.GOOGLE_AI_API_KEY || '';
const GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-image-preview';
const FB_PAGE_ID = process.env.FB_PAGE_ID || '124822734055754';
const FB_PAGE_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN || '';

// Platform-specific system prompts
const PLATFORM_PROMPTS: Record<string, string> = {
  facebook: `אתה מומחה לכתיבת תוכן פייסבוק עבור דרך ההייטק — עסק לחוגי תכנות לילדים בישראל.

עקרונות לפוסט פייסבוק מוצלח:
- שורה פותחת שמושכת תשומת לב מיידי
- טון שיחתי וחמים (לא פורמלי)
- סיפור / טיפ מועיל / שאלה שמזמינה תגובות
- אורך אידיאלי: 50-150 מילים
- אימוגי לפיזור חיובי
- CTA ברור בסוף ("כתבו לנו / שתפו / לחצו לינק")
- 3-5 hashtags בסוף בעברית ואנגלית
- שפה: עברית`,

  instagram: `אתה מומחה לכתיבת תוכן אינסטגרם עבור דרך ההייטק — עסק לחוגי תכנות לילדים בישראל.

עקרונות לפוסט אינסטגרם מוצלח:
- כיתוב קצר ומנצח (1-3 שורות לפני "more")
- הרבה אימוגי — אינסטגרם מצפה לזה
- 10-20 hashtags מגוונים (עברית + אנגלית)
- שפה ויזואלית — תאר את מה שרואים בתמונה
- CTA בסוף: "שמרו את הפוסט" / "תייגו חבר"
- שפה: עברית עם hashtags גם באנגלית`,

  linkedin: `אתה מומחה לכתיבת תוכן LinkedIn עבור דרך ההייטק — עסק לחוגי תכנות לילדים בישראל.
כתוב פוסטים שמניעים מעורבות גבוהה ב-LinkedIn.
- שורה ראשונה חזקה (hook)
- סיפור אישי / תובנה / נתון מפתיע
- פסקאות קצרות עם רווחים
- 3-5 hashtags בסוף (תמיד #דרךההייטק #HaiTech)
- Call to action בסוף
- אורך: 150-300 מילים
בסוף הוסף שורה: "🔗 linkedin.com/company/hai-tech-way"`,
};

// POST /api/social/generate-text
router.post('/generate-text', authenticate, managerOrAdmin, async (req: Request, res: Response) => {
  const { direction, platform } = req.body;
  if (!direction?.trim()) return res.status(400).json({ error: 'direction required' });
  if (!platform || !PLATFORM_PROMPTS[platform]) return res.status(400).json({ error: 'platform must be: facebook, instagram, linkedin' });

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: PLATFORM_PROMPTS[platform] },
        { role: 'user', content: `כתוב פוסט על הנושא הבא:\n${direction}` },
      ],
      temperature: 0.8,
      max_tokens: 800,
    });
    const text = completion.choices[0]?.message?.content?.trim() || '';
    res.json({ text });
  } catch (err: any) {
    console.error('social generate-text error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/social/generate-image — uses Gemini 3.1 Flash Image
router.post('/generate-image', authenticate, managerOrAdmin, async (req: Request, res: Response) => {
  const { prompt, platform = 'general' } = req.body;
  if (!prompt?.trim()) return res.status(400).json({ error: 'prompt required' });
  if (!GEMINI_API_KEY) return res.status(503).json({ error: 'GOOGLE_AI_API_KEY not configured' });

  const platformHints: Record<string, string> = {
    facebook: 'bright, engaging, Facebook-style marketing image, 1200x630 ratio',
    instagram: 'square format 1:1, vibrant colors, Instagram aesthetic, professional',
    linkedin: 'professional, clean design, LinkedIn-appropriate, 1200x627 ratio',
    general: 'high quality, marketing image',
  };

  const fullPrompt = `Create a marketing image for "דרך ההייטק" (Hai-Tech Way) - a children's coding education company in Israel.
Style: ${platformHints[platform] || platformHints.general}
Content: ${prompt}
Always include: colorful, child-friendly, coding/technology theme, modern flat design`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: fullPrompt }] }],
          generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
        }),
      }
    );

    const data = await response.json() as any;
    if (!response.ok) throw new Error(data.error?.message || JSON.stringify(data));

    const parts = data.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((p: any) => p.inlineData);
    if (!imagePart) throw new Error('No image returned from Gemini');

    res.json({
      imageBase64: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType,
    });
  } catch (err: any) {
    console.error('social generate-image error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/social/publish/facebook — post text + optional image to FB page
router.post('/publish/facebook', authenticate, managerOrAdmin, async (req: Request, res: Response) => {
  const { text, imageBase64, mimeType } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'text required' });
  if (!FB_PAGE_TOKEN) return res.status(503).json({ error: 'FB_PAGE_ACCESS_TOKEN not configured' });

  try {
    let postId: string;

    if (imageBase64) {
      // Upload photo with caption
      const formData = new URLSearchParams();
      formData.append('caption', text);
      formData.append('access_token', FB_PAGE_TOKEN);
      // Upload as base64 URL
      const dataUrl = `data:${mimeType || 'image/png'};base64,${imageBase64}`;

      // Use native FormData (Node.js 18+)
      const fd = new FormData();
      const imgBuffer = Buffer.from(imageBase64, 'base64');
      fd.set('source', new Blob([imgBuffer], { type: mimeType || 'image/png' }), 'image.png');
      fd.set('caption', text);
      fd.set('access_token', FB_PAGE_TOKEN);

      const photoRes = await fetch(`https://graph.facebook.com/v18.0/${FB_PAGE_ID}/photos`, {
        method: 'POST',
        body: fd as any,
      });
      const photoData = await photoRes.json() as any;
      if (!photoRes.ok) throw new Error(photoData.error?.message || 'Photo upload failed');
      postId = photoData.post_id || photoData.id;
    } else {
      // Text-only post
      const feedRes = await fetch(`https://graph.facebook.com/v18.0/${FB_PAGE_ID}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, access_token: FB_PAGE_TOKEN }),
      });
      const feedData = await feedRes.json() as any;
      if (!feedRes.ok) throw new Error(feedData.error?.message || 'Post failed');
      postId = feedData.id;
    }

    res.json({ success: true, postId });
  } catch (err: any) {
    console.error('FB publish error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/social/facebook/status — check FB page connection
router.get('/facebook/status', authenticate, async (_req: Request, res: Response) => {
  if (!FB_PAGE_TOKEN) return res.json({ connected: false });
  try {
    const r = await fetch(`https://graph.facebook.com/v18.0/${FB_PAGE_ID}?fields=name,fan_count&access_token=${FB_PAGE_TOKEN}`);
    const d = await r.json() as any;
    if (!r.ok) return res.json({ connected: false, error: d.error?.message });
    res.json({ connected: true, pageName: d.name, fans: d.fan_count });
  } catch (err: any) {
    res.json({ connected: false, error: err.message });
  }
});

// GET /api/social/instagram/status — get IG business account info
router.get('/instagram/status', authenticate, async (_req: Request, res: Response) => {
  if (!FB_PAGE_TOKEN) return res.json({ connected: false });
  try {
    const r = await fetch(
      `https://graph.facebook.com/v18.0/${FB_PAGE_ID}?fields=instagram_business_account&access_token=${FB_PAGE_TOKEN}`
    );
    const d = await r.json() as any;
    if (!d.instagram_business_account?.id) return res.json({ connected: false, message: 'No Instagram Business account linked to this Facebook page' });
    const igId = d.instagram_business_account.id;
    const igR = await fetch(`https://graph.facebook.com/v18.0/${igId}?fields=name,username,followers_count&access_token=${FB_PAGE_TOKEN}`);
    const igD = await igR.json() as any;
    res.json({ connected: true, igUserId: igId, username: igD.username, name: igD.name, followers: igD.followers_count });
  } catch (err: any) {
    res.json({ connected: false, error: err.message });
  }
});

// POST /api/social/publish/instagram — post image + caption to IG
router.post('/publish/instagram', authenticate, managerOrAdmin, async (req: Request, res: Response) => {
  const { caption, imageBase64, mimeType, imageUrl } = req.body;
  if (!caption?.trim()) return res.status(400).json({ error: 'caption required' });
  if (!imageBase64 && !imageUrl) return res.status(400).json({ error: 'imageBase64 or imageUrl required' });
  if (!FB_PAGE_TOKEN) return res.status(503).json({ error: 'FB_PAGE_ACCESS_TOKEN not configured' });

  try {
    // Get IG user ID
    const pageR = await fetch(`https://graph.facebook.com/v18.0/${FB_PAGE_ID}?fields=instagram_business_account&access_token=${FB_PAGE_TOKEN}`);
    const pageD = await pageR.json() as any;
    const igId = pageD.instagram_business_account?.id;
    if (!igId) throw new Error('No Instagram Business account linked to Facebook page');

    // For IG, we need a public image URL. If base64, upload to FB first then use the URL.
    let publicImageUrl = imageUrl;
    if (imageBase64 && !imageUrl) {
      // Upload image to Facebook to get a URL
      // Use native FormData (Node.js 18+)
      const fd = new FormData();
      const imgBuffer = Buffer.from(imageBase64, 'base64');
      fd.set('source', new Blob([imgBuffer], { type: mimeType || 'image/png' }), 'image.png');
      fd.set('published', 'false'); // unpublished
      fd.set('access_token', FB_PAGE_TOKEN);
      const photoR = await fetch(`https://graph.facebook.com/v18.0/${FB_PAGE_ID}/photos`, {
        method: 'POST',
        body: fd as any,
      });
      const photoD = await photoR.json() as any;
      if (!photoR.ok) throw new Error(photoD.error?.message || 'Image upload failed');
      // Get the image URL
      const picR = await fetch(`https://graph.facebook.com/v18.0/${photoD.id}?fields=images&access_token=${FB_PAGE_TOKEN}`);
      const picD = await picR.json() as any;
      publicImageUrl = picD.images?.[0]?.source;
      if (!publicImageUrl) throw new Error('Could not get image URL after upload');
    }

    // Step 1: Create media container
    const containerR = await fetch(`https://graph.facebook.com/v18.0/${igId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: publicImageUrl, caption, access_token: FB_PAGE_TOKEN }),
    });
    const containerD = await containerR.json() as any;
    if (!containerR.ok) throw new Error(containerD.error?.message || 'Container creation failed');

    // Step 2: Publish
    const publishR = await fetch(`https://graph.facebook.com/v18.0/${igId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: containerD.id, access_token: FB_PAGE_TOKEN }),
    });
    const publishD = await publishR.json() as any;
    if (!publishR.ok) throw new Error(publishD.error?.message || 'Publish failed');

    res.json({ success: true, postId: publishD.id });
  } catch (err: any) {
    console.error('IG publish error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
