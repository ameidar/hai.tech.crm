import type { Response } from 'express';

const waSseClients = new Set<Response>();

export function addWaSseClient(res: Response): void {
  waSseClients.add(res);
}

export function removeWaSseClient(res: Response): void {
  waSseClients.delete(res);
}

export function broadcastWaSSE(event: string, data: unknown): void {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  waSseClients.forEach(client => {
    try {
      client.write(msg);
    } catch {}
  });
}
