import { exec } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

const VIDEO_DIR = '/tmp/quote-videos';
const RENDER_SCRIPT = '/home/opc/clawd/projects/hai-tech-video/render-quote.sh';

export async function renderQuoteVideo(quoteId: string, props: any): Promise<string> {
  await fs.mkdir(VIDEO_DIR, { recursive: true });
  const outputPath = path.join(VIDEO_DIR, `${quoteId}.mp4`);
  const propsJson = JSON.stringify(props);

  return new Promise((resolve, reject) => {
    exec(
      `bash ${RENDER_SCRIPT} '${propsJson.replace(/'/g, "'\\''")}' '${outputPath}'`,
      { timeout: 120000 },
      (error, _stdout, _stderr) => {
        if (error) reject(error);
        else resolve(outputPath);
      }
    );
  });
}

export async function getVideoPath(quoteId: string): Promise<string | null> {
  const outputPath = path.join(VIDEO_DIR, `${quoteId}.mp4`);
  try {
    await fs.access(outputPath);
    return outputPath;
  } catch {
    return null;
  }
}

// Track rendering status in memory
const renderingStatus = new Map<string, 'rendering' | 'done' | 'error'>();

export function setRenderStatus(quoteId: string, status: 'rendering' | 'done' | 'error') {
  renderingStatus.set(quoteId, status);
}

export function getRenderStatus(quoteId: string): 'rendering' | 'done' | 'error' | 'none' {
  return renderingStatus.get(quoteId) || 'none';
}
