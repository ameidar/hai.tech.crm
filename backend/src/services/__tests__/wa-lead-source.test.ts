import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    waClickRef: { findFirst: vi.fn(), updateMany: vi.fn() },
    waConversation: { update: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

import { prisma } from '../../utils/prisma.js';
import {
  aggregateLeadSources,
  applyWebsiteAttribution,
  buildLeadSourceSummary,
  deriveLeadChannel,
  deriveTouchChannel,
  effectiveChannel,
  extractWaRefCode,
  isValidWaRefCode,
  splitWaRefCode,
  stripWaRefCode,
} from '../wa-lead-source.js';

const db = prisma as any;

describe('ref code extraction / stripping', () => {
  it('extracts the code from the last line', () => {
    expect(extractWaRefCode('היי, מעוניינים בקורס רובלוקס\n🔹K7Q2MZ')).toBe('K7Q2MZ');
  });

  it('tolerates whitespace and the emoji variation selector', () => {
    expect(extractWaRefCode('hello 🔹 K7Q2MZ')).toBe('K7Q2MZ');
    expect(extractWaRefCode('hello\n🔹️K7Q2MZ ')).toBe('K7Q2MZ');
  });

  it('rejects codes with excluded letters, wrong length or without the marker', () => {
    expect(extractWaRefCode('🔹K7Q2MI')).toBeNull(); // I not in alphabet
    expect(extractWaRefCode('🔹K7Q2M0')).toBeNull(); // 0 not in alphabet
    expect(extractWaRefCode('🔹K7Q2M')).toBeNull(); // too short
    expect(extractWaRefCode('🔹K7Q2MZA')).toBeNull(); // too long
    expect(extractWaRefCode('K7Q2MZ')).toBeNull(); // no marker
    expect(extractWaRefCode('')).toBeNull();
    expect(extractWaRefCode(null)).toBeNull();
  });

  it('validates codes', () => {
    expect(isValidWaRefCode('K7Q2MZ')).toBe(true);
    expect(isValidWaRefCode('k7q2mz')).toBe(false);
    expect(isValidWaRefCode('K7Q2MO')).toBe(false);
    expect(isValidWaRefCode(123)).toBe(false);
  });

  it('strips the token and the trailing line', () => {
    expect(stripWaRefCode('היי, מעוניינים בקורס רובלוקס\n🔹K7Q2MZ')).toBe('היי, מעוניינים בקורס רובלוקס');
    expect(stripWaRefCode('a 🔹K7Q2MZ b')).toBe('a b');
    expect(stripWaRefCode('no code here')).toBe('no code here');
  });

  it('splitWaRefCode keeps raw text when the message is only the code', () => {
    expect(splitWaRefCode('שלום\n🔹K7Q2MZ')).toEqual({ code: 'K7Q2MZ', text: 'שלום' });
    expect(splitWaRefCode('🔹K7Q2MZ')).toEqual({ code: 'K7Q2MZ', text: '🔹K7Q2MZ' });
    expect(splitWaRefCode('שלום')).toEqual({ code: null, text: 'שלום' });
  });
});

describe('channel derivation', () => {
  it('google ads via click ids or paid utm', () => {
    expect(deriveTouchChannel({ gclid: 'x' })).toBe('google_ads');
    expect(deriveTouchChannel({ gbraid: 'x' })).toBe('google_ads');
    expect(deriveTouchChannel({ wbraid: 'x' })).toBe('google_ads');
    expect(deriveTouchChannel({ utmSource: 'google', utmMedium: 'cpc' })).toBe('google_ads');
    expect(deriveTouchChannel({ utmSource: 'Google', utmMedium: 'PPC' })).toBe('google_ads');
  });

  it('meta ads via fbclid or paid social utm', () => {
    expect(deriveTouchChannel({ fbclid: 'x' })).toBe('meta_ads');
    expect(deriveTouchChannel({ utmSource: 'facebook', utmMedium: 'paid' })).toBe('meta_ads');
    expect(deriveTouchChannel({ utmSource: 'instagram', utmMedium: 'cpc' })).toBe('meta_ads');
    expect(deriveTouchChannel({ utmSource: 'meta', utmMedium: 'paid_social' })).toBe('meta_ads');
  });

  it('organic referrers', () => {
    expect(deriveTouchChannel({ referrer: 'https://www.google.co.il/' })).toBe('google_organic');
    expect(deriveTouchChannel({ referrer: 'https://l.facebook.com/l.php?u=x' })).toBe('social_organic');
    expect(deriveTouchChannel({ referrer: 'https://www.instagram.com/' })).toBe('social_organic');
    expect(deriveTouchChannel({ referrer: 'https://t.co/abc' })).toBe('social_organic');
    expect(deriveTouchChannel({ referrer: 'https://www.linkedin.com/feed' })).toBe('social_organic');
    expect(deriveTouchChannel({ referrer: 'https://some-blog.co.il/post' })).toBe('referral');
  });

  it('email / whatsapp via utm_medium', () => {
    expect(deriveTouchChannel({ utmSource: 'newsletter', utmMedium: 'email' })).toBe('email');
    expect(deriveTouchChannel({ utmSource: 'broadcast', utmMedium: 'whatsapp' })).toBe('whatsapp');
  });

  it('direct when nothing (internal referrer counts as nothing)', () => {
    expect(deriveTouchChannel({})).toBe('direct');
    expect(deriveTouchChannel({ referrer: 'https://hai.tech/courses' })).toBe('direct');
    expect(deriveTouchChannel({ referrer: 'https://www.hai.tech/' })).toBe('direct');
  });

  it('click ids win over referrer', () => {
    expect(deriveTouchChannel({ gclid: 'x', referrer: 'https://www.google.com/' })).toBe('google_ads');
  });

  it('prefers firstTouch when it carries a signal, else click-time fields', () => {
    expect(deriveLeadChannel({ referrer: 'https://www.google.com/', firstTouch: { gclid: 'abc', at: '2026-10-01T00:00:00Z' } })).toBe('google_ads');
    expect(deriveLeadChannel({ fbclid: 'x', firstTouch: { at: '2026-10-01T00:00:00Z' } })).toBe('meta_ads');
    expect(deriveLeadChannel({ firstTouch: null })).toBe('direct');
  });

  it('summary mentions channel, utm, click ids and landing path', () => {
    const s = buildLeadSourceSummary({ utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'roblox', gclid: 'x', landingPath: '/roblox' }, 'google_ads');
    expect(s).toContain('google_ads');
    expect(s).toContain('google / cpc');
    expect(s).toContain('gclid');
    expect(s).toContain('/roblox');
  });
});

describe('applyWebsiteAttribution', () => {
  beforeEach(() => vi.clearAllMocks());

  const ref = {
    id: 'ref1',
    code: 'K7Q2MZ',
    pageUrl: 'https://hai.tech/roblox?utm_source=google',
    pageTitle: 'קורס רובלוקס',
    utmSource: 'google',
    utmMedium: 'cpc',
    utmCampaign: 'roblox-oct',
    gclid: 'abc',
    firstTouch: null,
    landingPath: '/roblox',
  };

  it('matches a recent unclaimed ref and stamps the conversation', async () => {
    db.waClickRef.findFirst.mockResolvedValue(ref);
    db.waClickRef.updateMany.mockResolvedValue({ count: 1 });
    db.waConversation.update.mockResolvedValue({});
    const now = new Date('2026-10-31T10:00:00Z');

    const result = await applyWebsiteAttribution({ id: 'conv1', referralSourceType: null }, 'K7Q2MZ', now);

    expect(result).toMatchObject({
      referralSourceType: 'website',
      referralSourceId: 'K7Q2MZ',
      referralSourceUrl: ref.pageUrl,
      referralHeadline: 'roblox-oct',
      leadSourceChannel: 'google_ads',
    });
    const where = db.waClickRef.findFirst.mock.calls[0][0].where;
    expect(where.code).toBe('K7Q2MZ');
    expect(where.createdAt.gte.toISOString()).toBe('2026-10-17T10:00:00.000Z');
    expect(where.OR).toEqual([{ matchedConversationId: null }, { matchedConversationId: 'conv1' }]);
    expect(db.waClickRef.updateMany.mock.calls[0][0].data).toEqual({ matchedConversationId: 'conv1', matchedAt: now });
    expect(db.waConversation.update).toHaveBeenCalledWith({ where: { id: 'conv1' }, data: result });
  });

  it('falls back to pageTitle for the headline', async () => {
    db.waClickRef.findFirst.mockResolvedValue({ ...ref, utmCampaign: null });
    db.waClickRef.updateMany.mockResolvedValue({ count: 1 });
    const result = await applyWebsiteAttribution({ id: 'conv1' }, 'K7Q2MZ');
    expect(result?.referralHeadline).toBe('קורס רובלוקס');
  });

  it('skips conversations that already have a Meta referral', async () => {
    const result = await applyWebsiteAttribution({ id: 'conv1', referralSourceType: 'ad' }, 'K7Q2MZ');
    expect(result).toBeNull();
    expect(db.waClickRef.findFirst).not.toHaveBeenCalled();
  });

  it('returns null when no ref matches', async () => {
    db.waClickRef.findFirst.mockResolvedValue(null);
    expect(await applyWebsiteAttribution({ id: 'conv1' }, 'K7Q2MZ')).toBeNull();
    expect(db.waConversation.update).not.toHaveBeenCalled();
  });

  it('returns null when another conversation claimed the ref concurrently', async () => {
    db.waClickRef.findFirst.mockResolvedValue(ref);
    db.waClickRef.updateMany.mockResolvedValue({ count: 0 });
    expect(await applyWebsiteAttribution({ id: 'conv1' }, 'K7Q2MZ')).toBeNull();
    expect(db.waConversation.update).not.toHaveBeenCalled();
  });
});

describe('lead-source report aggregation', () => {
  it('maps legacy Meta referrals to meta_ctwa and empty to unknown', () => {
    expect(effectiveChannel({ channel: null, referralSourceType: 'ad' })).toBe('meta_ctwa');
    expect(effectiveChannel({ channel: null, referralSourceType: null })).toBe('unknown');
    expect(effectiveChannel({ channel: 'google_ads', referralSourceType: 'website' })).toBe('google_ads');
    expect(effectiveChannel({ channel: 'bogus', referralSourceType: null })).toBe('unknown');
  });

  it('aggregates channels, campaigns and website pages', () => {
    const base = { phone: '972500000000', referralSourceType: null, referralHeadline: null, referralSourceUrl: null, registered: false };
    const report = aggregateLeadSources([
      { ...base, id: '1', channel: 'google_ads', referralSourceType: 'website', referralHeadline: 'roblox', referralSourceUrl: 'https://hai.tech/roblox?x=1', registered: true },
      { ...base, id: '2', channel: 'google_ads', referralSourceType: 'website', referralHeadline: 'roblox', referralSourceUrl: 'https://hai.tech/roblox' },
      { ...base, id: '3', channel: null, referralSourceType: 'ad', referralHeadline: 'Meta ad' },
      { ...base, id: '4', channel: null },
    ], '2026-10-01', '2026-10-31');

    expect(report.totals).toEqual({ leads: 4, registered: 1 });
    const byCh = Object.fromEntries(report.channels.map(c => [c.channel, c]));
    expect(byCh.google_ads).toMatchObject({ leads: 2, registered: 1 });
    expect(byCh.meta_ctwa).toMatchObject({ leads: 1, registered: 0 });
    expect(byCh.unknown).toMatchObject({ leads: 1 });
    expect(byCh.direct).toBeUndefined();
    expect(report.topCampaigns[0]).toEqual({ campaign: 'roblox', channel: 'google_ads', leads: 2, registered: 1 });
    expect(report.topPages).toEqual([{ page: '/roblox', leads: 2, registered: 1 }]);
  });
});
