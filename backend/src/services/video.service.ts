// Video render server runs on the host (outside Docker)
const RENDER_SERVER = process.env.VIDEO_RENDER_URL || 'http://host.docker.internal:3099';

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

// Track rendering status in memory (fallback)
const renderingStatus = new Map<string, 'rendering' | 'done' | 'error'>();

export function setRenderStatus(quoteId: string, status: 'rendering' | 'done' | 'error') {
  renderingStatus.set(quoteId, status);
}

export function getRenderStatus(quoteId: string): 'rendering' | 'done' | 'error' | 'none' {
  return renderingStatus.get(quoteId) || 'none';
}
