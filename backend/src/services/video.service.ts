import fs from 'fs';
import path from 'path';
import { prisma } from '../utils/prisma.js';

// Video render server runs on the host (outside Docker)
const RENDER_SERVER = process.env.VIDEO_RENDER_URL || 'http://host.docker.internal:3099';
const VIMEO_TOKEN = process.env.VIMEO_ACCESS_TOKEN || '';
const VIDEOS_DIR = path.resolve(process.cwd(), 'uploads', 'videos');

// Ensure videos directory (used as temp) exists
try {
  if (!fs.existsSync(VIDEOS_DIR)) {
    fs.mkdirSync(VIDEOS_DIR, { recursive: true });
  }
} catch (err) {
  console.warn('Could not create videos dir:', err);
}

export async function renderQuoteVideo(quoteId: string, props: any): Promise<void> {
  const response = await fetch(`${RENDER_SERVER}/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quoteId, props }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Render server error: ${err}`);
  }
}

export async function getVideoStatus(quoteId: string): Promise<'rendering' | 'done' | 'error' | 'none'> {
  try {
    const response = await fetch(`${RENDER_SERVER}/status/${quoteId}`);
    if (!response.ok) return 'none';
    const data = await response.json() as any;
    return data.status || 'none';
  } catch {
    return 'none';
  }
}

export function getVideoUrl(quoteId: string): string {
  return `${RENDER_SERVER}/video/${quoteId}`;
}

/**
 * Upload video to Vimeo using tus resumable upload.
 * Returns the Vimeo video URI (e.g. /videos/123456789) or null on failure.
 */
async function uploadToVimeo(filePath: string, title: string): Promise<string | null> {
  if (!VIMEO_TOKEN) {
    console.error('VIMEO_ACCESS_TOKEN not configured');
    return null;
  }

  const fileSize = fs.statSync(filePath).size;

  // Step 1: Create the video entry on Vimeo
  const createRes = await fetch('https://api.vimeo.com/me/videos', {
    method: 'POST',
    headers: {
      'Authorization': `bearer ${VIMEO_TOKEN}`,
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.vimeo.*+json;version=3.4',
    },
    body: JSON.stringify({
      upload: {
        approach: 'tus',
        size: fileSize,
      },
      name: title,
      privacy: { view: 'anybody' },
      embed: {
        buttons: { like: false, watchlater: false, share: false },
        logos: { vimeo: false },
        title: { name: 'show', owner: 'hide', portrait: 'hide' },
      },
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    console.error('Vimeo create video failed:', err);
    return null;
  }

  const videoData = await createRes.json() as any;
  const uploadLink = videoData.upload?.upload_link;
  const videoUri = videoData.uri; // e.g. /videos/123456789

  if (!uploadLink) {
    console.error('No upload_link in Vimeo response');
    return null;
  }

  // Step 2: Upload the file via tus
  const fileBuffer = fs.readFileSync(filePath);
  const uploadRes = await fetch(uploadLink, {
    method: 'PATCH',
    headers: {
      'Tus-Resumable': '1.0.0',
      'Upload-Offset': '0',
      'Content-Type': 'application/offset+octet-stream',
    },
    body: fileBuffer,
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    console.error('Vimeo tus upload failed:', err);
    return null;
  }

  return videoUri;
}

/**
 * Get Vimeo embed/player URL from a video URI like /videos/123456789
 */
function vimeoPlayerUrl(videoUri: string): string {
  const videoId = videoUri.replace('/videos/', '');
  return `https://player.vimeo.com/video/${videoId}`;
}

/**
 * Download video from render server, upload to Vimeo, save URL in DB.
 * Removes local temp file after upload.
 */
export async function persistVideo(quoteId: string, institutionName?: string): Promise<string | null> {
  try {
    const videoUrl = getVideoUrl(quoteId);
    const response = await fetch(videoUrl);
    if (!response.ok || !response.body) return null;

    // Save to temp file (use /tmp as fallback)
    const tempDir = fs.existsSync(VIDEOS_DIR) ? VIDEOS_DIR : '/tmp';
    const tempPath = path.join(tempDir, `${quoteId}.mp4`);
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(tempPath, buffer);

    // Upload to Vimeo
    const title = `הצעת מחיר - ${institutionName || quoteId}`;
    const videoUri = await uploadToVimeo(tempPath, title);

    // Clean up temp file
    try { fs.unlinkSync(tempPath); } catch { /* ignore */ }

    if (!videoUri) {
      console.error('Vimeo upload failed, falling back to local path');
      // Fallback: keep local file
      fs.writeFileSync(tempPath, buffer);
      await prisma.quote.update({
        where: { id: quoteId },
        data: { videoPath: tempPath },
      });
      return tempPath;
    }

    const playerUrl = vimeoPlayerUrl(videoUri);

    // Save Vimeo URL in DB
    await prisma.quote.update({
      where: { id: quoteId },
      data: { videoPath: playerUrl },
    });

    console.log(`Video for quote ${quoteId} uploaded to Vimeo: ${playerUrl}`);
    return playerUrl;
  } catch (err) {
    console.error(`Failed to persist video for quote ${quoteId}:`, err);
    return null;
  }
}

/**
 * Get the video URL for a quote. Returns Vimeo player URL or local path.
 */
export async function getPersistedVideoPath(quoteId: string): Promise<string | null> {
  try {
    const quote = await prisma.quote.findUnique({
      where: { id: quoteId },
      select: { videoPath: true },
    });
    if (!quote?.videoPath) return null;

    // If it's a Vimeo URL, return as-is
    if (quote.videoPath.startsWith('https://')) {
      return quote.videoPath;
    }

    // Local file fallback
    if (fs.existsSync(quote.videoPath)) {
      return quote.videoPath;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Check if a video path is a Vimeo URL (vs local file)
 */
export function isVimeoUrl(videoPath: string): boolean {
  return videoPath.startsWith('https://player.vimeo.com/') || videoPath.startsWith('https://vimeo.com/');
}

// Track rendering status in memory (fallback)
const renderingStatus = new Map<string, 'rendering' | 'done' | 'error'>();

export function setRenderStatus(quoteId: string, status: 'rendering' | 'done' | 'error') {
  renderingStatus.set(quoteId, status);
}

export function getRenderStatus(quoteId: string): 'rendering' | 'done' | 'error' | 'none' {
  return renderingStatus.get(quoteId) || 'none';
}
