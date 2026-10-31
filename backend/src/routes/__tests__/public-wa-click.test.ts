import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    waClickRef: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from '../../utils/prisma.js';
import { isAllowedWaClickOrigin, publicWaClickRouter } from '../public-wa-click.js';

const db = prisma as any;

function makeApp() {
  const app = express();
  app.use('/api/public/wa-click', publicWaClickRouter);
  return app;
}

const payload = {
  code: 'K7Q2MZ',
  pageUrl: 'https://hai.tech/roblox?utm_source=google&utm_medium=cpc',
  pagePath: '/roblox',
  pageTitle: 'קורס רובלוקס',
  waNumber: '972533009742',
  prefill: 'היי, מעוניינים בקורס רובלוקס',
  utmSource: 'google',
  utmMedium: 'cpc',
  utmCampaign: 'roblox-oct',
  gclid: 'Cj0KCQ',
  referrer: 'https://www.google.com/',
  landingPath: '/roblox',
  firstTouch: { utmSource: 'google', utmMedium: 'cpc', gclid: 'Cj0KCQ', at: '2026-10-30T08:00:00.000Z', bogus: 'x' },
  clickedAt: '2026-10-31T09:00:00.000Z',
  unknownField: 'ignored',
};

describe('POST /api/public/wa-click', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.waClickRef.findUnique.mockResolvedValue(null);
    db.waClickRef.create.mockResolvedValue({});
  });

  it('accepts a sendBeacon text/plain JSON body and stores the click', async () => {
    const res = await request(makeApp())
      .post('/api/public/wa-click')
      .set('Origin', 'https://hai.tech')
      .set('Content-Type', 'text/plain;charset=UTF-8')
      .set('User-Agent', 'Mozilla/5.0 test')
      .set('X-Forwarded-For', '1.2.3.4, 10.0.0.1')
      .send(JSON.stringify(payload));

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('https://hai.tech');
    expect(db.waClickRef.create).toHaveBeenCalledTimes(1);
    const data = db.waClickRef.create.mock.calls[0][0].data;
    expect(data.code).toBe('K7Q2MZ');
    expect(data.utmCampaign).toBe('roblox-oct');
    expect(data.firstTouch).toEqual({ utmSource: 'google', utmMedium: 'cpc', gclid: 'Cj0KCQ', at: '2026-10-30T08:00:00.000Z' });
    expect(data.clickedAt).toEqual(new Date('2026-10-31T09:00:00.000Z'));
    expect(data).not.toHaveProperty('unknownField');
    expect(data.ipHash).toMatch(/^[a-f0-9]{64}$/);
    expect(data.ipHash).not.toContain('1.2.3.4');
    expect(data.userAgent).toBe('Mozilla/5.0 test');
  });

  it('accepts application/json too', async () => {
    const res = await request(makeApp())
      .post('/api/public/wa-click')
      .set('Origin', 'https://www.hai.tech')
      .send({ code: 'ABCDEF' });
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('https://www.hai.tech');
  });

  it('truncates long strings', async () => {
    await request(makeApp())
      .post('/api/public/wa-click')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ code: 'ABCDEF', pageTitle: 'x'.repeat(3000) }));
    expect(db.waClickRef.create.mock.calls[0][0].data.pageTitle).toHaveLength(500);
  });

  it('decodes URL-encoded Hebrew paths (and tolerates malformed encoding)', async () => {
    await request(makeApp())
      .post('/api/public/wa-click')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({
        code: 'ABCDEF',
        pagePath: '/%D7%A7%D7%95%D7%A8%D7%A1-%D7%A8%D7%95%D7%91%D7%9C%D7%95%D7%A7%D7%A1',
        landingPath: '/bad%E0%A4%A',
        firstTouch: { landingPath: '/%D7%A7%D7%95%D7%A8%D7%A1', at: '2026-10-30T08:00:00Z' },
      }));
    const data = db.waClickRef.create.mock.calls[0][0].data;
    expect(data.pagePath).toBe('/קורס-רובלוקס');
    expect(data.landingPath).toBe('/bad%E0%A4%A');
    expect(data.firstTouch.landingPath).toBe('/קורס');
  });

  it('rejects an invalid code', async () => {
    const res = await request(makeApp())
      .post('/api/public/wa-click')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ code: 'K7Q2M0' }));
    expect(res.status).toBe(400);
    expect(db.waClickRef.create).not.toHaveBeenCalled();
  });

  it('rejects a missing code and malformed JSON', async () => {
    const app = makeApp();
    expect((await request(app).post('/api/public/wa-click').set('Content-Type', 'text/plain').send('{}')).status).toBe(400);
    expect((await request(app).post('/api/public/wa-click').set('Content-Type', 'text/plain').send('not json')).status).toBe(400);
  });

  it('rejects payloads over 8KB', async () => {
    const res = await request(makeApp())
      .post('/api/public/wa-click')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ code: 'ABCDEF', prefill: 'x'.repeat(9000) }));
    expect(res.status).toBe(413);
  });

  it('does not overwrite an already-matched code', async () => {
    db.waClickRef.findUnique.mockResolvedValue({ id: 'r1', matchedConversationId: 'conv1' });
    const res = await request(makeApp()).post('/api/public/wa-click').send({ code: 'ABCDEF' });
    expect(res.status).toBe(204);
    expect(db.waClickRef.update).not.toHaveBeenCalled();
    expect(db.waClickRef.create).not.toHaveBeenCalled();
  });

  it('answers CORS preflight for allowed origins only', async () => {
    const ok = await request(makeApp())
      .options('/api/public/wa-click')
      .set('Origin', 'https://preview-123.hai-tech-website.pages.dev')
      .set('Access-Control-Request-Method', 'POST');
    expect(ok.status).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe('https://preview-123.hai-tech-website.pages.dev');

    const bad = await request(makeApp())
      .options('/api/public/wa-click')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('origin allow-list', () => {
    expect(isAllowedWaClickOrigin('https://hai.tech')).toBe(true);
    expect(isAllowedWaClickOrigin('https://www.hai.tech')).toBe(true);
    expect(isAllowedWaClickOrigin('https://hai-tech-website.pages.dev')).toBe(true);
    expect(isAllowedWaClickOrigin('https://abc.hai-tech-website.pages.dev')).toBe(true);
    expect(isAllowedWaClickOrigin('http://localhost:4321')).toBe(true);
    expect(isAllowedWaClickOrigin('https://hai.tech.evil.com')).toBe(false);
    expect(isAllowedWaClickOrigin('https://evilhai-tech-website.pages.dev')).toBe(false);
    expect(isAllowedWaClickOrigin(undefined)).toBe(false);
  });
});
