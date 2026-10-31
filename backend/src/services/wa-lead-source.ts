/**
 * WhatsApp lead-source attribution.
 *
 * Contract with the hai.tech website:
 *  - On every WhatsApp-button click the site generates a 6-char ref code from the alphabet
 *    ABCDEFGHJKMNPQRSTUVWXYZ23456789, appends "🔹<CODE>" to the prefilled WhatsApp text and
 *    sends a beacon (POST /api/public/wa-click) with the click's attribution data.
 *  - When the lead's first WhatsApp message arrives we extract the code, match it to the
 *    stored click (wa_click_refs) and copy the source onto the conversation.
 */

import { prisma } from '../utils/prisma.js';

export const WA_REF_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const WA_REF_CODE_LENGTH = 6;
/** Days a click ref stays matchable after the beacon was received. */
export const WA_REF_MATCH_WINDOW_DAYS = 14;

// Tolerant: optional whitespace between the marker and the code; trailing "️" variation selector.
const WA_REF_PATTERN = /🔹️?\s*([A-HJ-NP-Z2-9]{6})(?![A-Za-z0-9])/u;
const WA_REF_PATTERN_GLOBAL = /🔹️?\s*[A-HJ-NP-Z2-9]{6}(?![A-Za-z0-9])/gu;

/** decodeURIComponent that never throws (Hebrew paths arrive percent-encoded from the site). */
export function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function isValidWaRefCode(code: unknown): code is string {
  return typeof code === 'string' && /^[A-HJ-NP-Z2-9]{6}$/.test(code);
}

/** Returns the ref code embedded in an inbound WhatsApp text, or null. */
export function extractWaRefCode(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = WA_REF_PATTERN.exec(text);
  return m ? m[1] : null;
}

/** Removes every "🔹CODE" token (and the blank line it leaves) so the bot never sees/echoes it. */
export function stripWaRefCode(text: string): string {
  if (!text || !text.includes('🔹')) return text;
  return text
    .replace(WA_REF_PATTERN_GLOBAL, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Splits an inbound text into the ref code and the text the CRM/bot should work with.
 * If the message consisted of nothing but the code, the raw text is kept (never store empty content).
 */
export function splitWaRefCode(text: string): { code: string | null; text: string } {
  const code = extractWaRefCode(text);
  if (!code) return { code: null, text };
  const stripped = stripWaRefCode(text);
  return { code, text: stripped || text };
}

// ============================================================
// Channel derivation
// ============================================================

export type LeadSourceChannel =
  | 'google_ads'
  | 'meta_ads'
  | 'meta_ctwa'
  | 'google_organic'
  | 'social_organic'
  | 'email'
  | 'whatsapp'
  | 'referral'
  | 'direct';

export const LEAD_SOURCE_CHANNELS: (LeadSourceChannel | 'unknown')[] = [
  'google_ads', 'meta_ads', 'meta_ctwa', 'google_organic', 'social_organic',
  'email', 'whatsapp', 'referral', 'direct', 'unknown',
];

export const LEAD_SOURCE_CHANNEL_LABELS: Record<LeadSourceChannel | 'unknown', string> = {
  google_ads: 'Google Ads',
  meta_ads: 'Meta Ads (אתר)',
  meta_ctwa: 'Meta Click-to-WhatsApp',
  google_organic: 'Google אורגני',
  social_organic: 'רשתות חברתיות אורגני',
  email: 'אימייל',
  whatsapp: 'וואטסאפ',
  referral: 'הפניה מאתר אחר',
  direct: 'ישיר',
  unknown: 'לא ידוע',
};

export interface AttributionTouch {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  fbclid?: string | null;
  referrer?: string | null;
  landingPath?: string | null;
  at?: string | null;
}

const PAID_MEDIUMS = new Set(['cpc', 'ppc', 'paid', 'paidsearch', 'paid_search', 'paid-search', 'paidsocial', 'paid_social', 'paid-social', 'cpm', 'ads', 'ad', 'display', 'sem']);
const META_SOURCES = new Set(['facebook', 'instagram', 'meta', 'fb', 'ig', 'facebook.com', 'instagram.com', 'an', 'msg', 'messenger']);
const GOOGLE_SOURCES = new Set(['google', 'google.com', 'googleads', 'google_ads', 'adwords', 'youtube']);
const SOCIAL_REFERRER_HOSTS = [
  'facebook.com', 'fb.com', 'fb.me', 'instagram.com', 't.co', 'twitter.com', 'x.com',
  'linkedin.com', 'lnkd.in', 'tiktok.com', 'youtube.com', 'youtu.be', 'pinterest.com', 'threads.net',
];
const INTERNAL_HOST_SUFFIXES = ['hai.tech', 'hai-tech-website.pages.dev'];

const lc = (v?: string | null) => (v || '').trim().toLowerCase();

function isPaidMedium(medium: string): boolean {
  return PAID_MEDIUMS.has(medium) || medium.startsWith('paid') || medium.includes('cpc');
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Hostname of an external referrer, or '' if missing/internal/unparseable. */
export function externalReferrerHost(referrer?: string | null): string {
  const raw = (referrer || '').trim();
  if (!raw) return '';
  let host = '';
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return '';
  }
  if (!host || INTERNAL_HOST_SUFFIXES.some(d => hostMatches(host, d))) return '';
  return host;
}

function isGoogleHost(host: string): boolean {
  // google.com, www.google.co.il, google.de, news.google.com …
  return /(^|\.)google\.[a-z.]+$/.test(host);
}

function hasSignal(t: AttributionTouch | null | undefined): boolean {
  if (!t) return false;
  return Boolean(
    t.utmSource || t.utmMedium || t.utmCampaign || t.gclid || t.gbraid || t.wbraid || t.fbclid || externalReferrerHost(t.referrer),
  );
}

/**
 * Picks the touch to attribute: the first touch when it carries any attribution signal,
 * otherwise the click-time fields.
 */
export function pickAttributionTouch(clickTouch: AttributionTouch, firstTouch?: AttributionTouch | null): AttributionTouch {
  if (firstTouch && hasSignal(firstTouch)) return firstTouch;
  return clickTouch;
}

/** Pure channel classification of a single touch. */
export function deriveTouchChannel(t: AttributionTouch): LeadSourceChannel {
  const source = lc(t.utmSource);
  const medium = lc(t.utmMedium);
  const refHost = externalReferrerHost(t.referrer);

  if (t.gclid || t.gbraid || t.wbraid) return 'google_ads';
  if (GOOGLE_SOURCES.has(source) && isPaidMedium(medium)) return 'google_ads';
  if (t.fbclid) return 'meta_ads';
  if (META_SOURCES.has(source) && isPaidMedium(medium)) return 'meta_ads';

  if (medium === 'email' || medium === 'e-mail' || medium === 'newsletter' || source === 'email' || source === 'newsletter') return 'email';
  if (medium === 'whatsapp' || source === 'whatsapp' || source === 'wa') return 'whatsapp';

  if (source || medium) {
    if (isPaidMedium(medium)) return 'referral'; // paid on an unknown network
    if (GOOGLE_SOURCES.has(source)) return 'google_organic';
    if (META_SOURCES.has(source) || SOCIAL_REFERRER_HOSTS.some(d => source === d || source === d.split('.')[0])) return 'social_organic';
    return 'referral';
  }

  if (refHost) {
    if (isGoogleHost(refHost)) return 'google_organic';
    if (SOCIAL_REFERRER_HOSTS.some(d => hostMatches(refHost, d))) return 'social_organic';
    return 'referral';
  }

  return 'direct';
}

/** Channel for a click ref: first touch (if it has a signal) else click-time fields. */
export function deriveLeadChannel(click: AttributionTouch & { firstTouch?: AttributionTouch | null }): LeadSourceChannel {
  return deriveTouchChannel(pickAttributionTouch(click, click.firstTouch));
}

/** Short human-readable summary stored in wa_conversations.referral_body. */
export function buildLeadSourceSummary(click: AttributionTouch & { firstTouch?: AttributionTouch | null }, channel: LeadSourceChannel): string {
  const t = pickAttributionTouch(click, click.firstTouch);
  const parts: string[] = [`ערוץ: ${LEAD_SOURCE_CHANNEL_LABELS[channel]} (${channel})`];
  if (t.utmSource || t.utmMedium) parts.push(`utm: ${t.utmSource || '-'} / ${t.utmMedium || '-'}`);
  if (t.utmCampaign) parts.push(`קמפיין: ${t.utmCampaign}`);
  const clickIds = [
    t.gclid ? 'gclid' : null,
    t.gbraid ? 'gbraid' : null,
    t.wbraid ? 'wbraid' : null,
    t.fbclid ? 'fbclid' : null,
  ].filter(Boolean);
  if (clickIds.length) parts.push(`מזהי קליק: ${clickIds.join(', ')}`);
  const refHost = externalReferrerHost(t.referrer);
  if (refHost) parts.push(`הפניה: ${refHost}`);
  if (t.landingPath) parts.push(`דף נחיתה: ${safeDecodeURIComponent(t.landingPath)}`);
  if (t === click.firstTouch && t.at) parts.push(`מגע ראשון: ${t.at}`);
  return parts.join(' | ').slice(0, 500);
}

// ============================================================
// Webhook matching
// ============================================================

export interface WebsiteAttributionResult {
  referralSourceType: 'website';
  referralSourceId: string;
  referralSourceUrl: string | null;
  referralHeadline: string | null;
  referralBody: string;
  leadSourceChannel: LeadSourceChannel;
}

function asTouch(v: unknown): AttributionTouch | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  return v as AttributionTouch;
}

/**
 * Matches a ref code to a recent, not-yet-claimed click and stamps the source on the conversation.
 * No-op (returns null) when the conversation already has a Meta referral or a source, or no click matches.
 */
export async function applyWebsiteAttribution(
  conv: { id: string; referralSourceType?: string | null },
  code: string,
  now: Date = new Date(),
): Promise<WebsiteAttributionResult | null> {
  if (!isValidWaRefCode(code)) return null;
  if (conv.referralSourceType) return null; // Meta CTWA referral (or earlier website match) wins

  const since = new Date(now.getTime() - WA_REF_MATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const ref = await prisma.waClickRef.findFirst({
    where: {
      code,
      createdAt: { gte: since },
      OR: [{ matchedConversationId: null }, { matchedConversationId: conv.id }],
    },
  });
  if (!ref) return null;

  // Atomic claim — a concurrent match for another conversation loses.
  const claimed = await prisma.waClickRef.updateMany({
    where: { id: ref.id, OR: [{ matchedConversationId: null }, { matchedConversationId: conv.id }] },
    data: { matchedConversationId: conv.id, matchedAt: now },
  });
  if (claimed.count === 0) return null;

  const click = { ...ref, firstTouch: asTouch(ref.firstTouch) };
  const channel = deriveLeadChannel(click);
  const result: WebsiteAttributionResult = {
    referralSourceType: 'website',
    referralSourceId: code,
    referralSourceUrl: ref.pageUrl || null,
    referralHeadline: (ref.utmCampaign || ref.pageTitle || null)?.slice(0, 300) ?? null,
    referralBody: buildLeadSourceSummary(click, channel),
    leadSourceChannel: channel,
  };

  await prisma.waConversation.update({ where: { id: conv.id }, data: result });
  return result;
}

// ============================================================
// Report: GET /api/wa/lead-sources
// ============================================================

export interface LeadSourceConversationRow {
  id: string;
  phone: string;
  channel: string | null;
  referralSourceType: string | null;
  referralHeadline: string | null;
  referralSourceUrl: string | null;
  registered: boolean;
}

export interface LeadSourceReport {
  from: string;
  to: string;
  totals: { leads: number; registered: number };
  channels: { channel: LeadSourceChannel | 'unknown'; label: string; leads: number; registered: number }[];
  topCampaigns: { campaign: string; channel: string; leads: number; registered: number }[];
  topPages: { page: string; leads: number; registered: number }[];
}

/** Effective channel of a conversation row (legacy Meta-referral rows without a stored channel → meta_ctwa). */
export function effectiveChannel(row: Pick<LeadSourceConversationRow, 'channel' | 'referralSourceType'>): LeadSourceChannel | 'unknown' {
  const c = (row.channel || '').trim();
  if (c && (LEAD_SOURCE_CHANNELS as string[]).includes(c)) return c as LeadSourceChannel;
  const t = (row.referralSourceType || '').trim();
  if (t && t !== 'website') return 'meta_ctwa';
  return 'unknown';
}

function pagePathOf(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return safeDecodeURIComponent(u.pathname || '/');
  } catch {
    return safeDecodeURIComponent(url).slice(0, 200);
  }
}

/** Pure aggregation of per-conversation rows into the report shape. */
export function aggregateLeadSources(rows: LeadSourceConversationRow[], from: string, to: string, topN = 10): LeadSourceReport {
  const byChannel = new Map<string, { leads: number; registered: number }>();
  for (const ch of LEAD_SOURCE_CHANNELS) byChannel.set(ch, { leads: 0, registered: 0 });
  const byCampaign = new Map<string, { campaign: string; channel: string; leads: number; registered: number }>();
  const byPage = new Map<string, { page: string; leads: number; registered: number }>();

  let registered = 0;
  for (const row of rows) {
    const ch = effectiveChannel(row);
    const agg = byChannel.get(ch)!;
    agg.leads += 1;
    if (row.registered) {
      agg.registered += 1;
      registered += 1;
    }

    const campaign = (row.referralHeadline || '').trim();
    if (campaign) {
      const key = `${ch}::${campaign}`;
      const c = byCampaign.get(key) || { campaign, channel: ch, leads: 0, registered: 0 };
      c.leads += 1;
      if (row.registered) c.registered += 1;
      byCampaign.set(key, c);
    }

    const page = row.referralSourceType === 'website' ? pagePathOf(row.referralSourceUrl) : null;
    if (page) {
      const p = byPage.get(page) || { page, leads: 0, registered: 0 };
      p.leads += 1;
      if (row.registered) p.registered += 1;
      byPage.set(page, p);
    }
  }

  const sortTop = <T extends { leads: number; registered: number }>(m: Map<string, T>) =>
    Array.from(m.values()).sort((a, b) => b.leads - a.leads || b.registered - a.registered).slice(0, topN);

  return {
    from,
    to,
    totals: { leads: rows.length, registered },
    channels: LEAD_SOURCE_CHANNELS.map(ch => ({
      channel: ch,
      label: LEAD_SOURCE_CHANNEL_LABELS[ch],
      ...byChannel.get(ch)!,
    })).filter(c => c.leads > 0 || c.channel === 'unknown'),
    topCampaigns: sortTop(byCampaign),
    topPages: sortTop(byPage),
  };
}

/**
 * Conversations started in [from, to] (Israel-time calendar days), each flagged `registered` when a customer
 * with the same normalized phone has a (non-deleted) registration created at/after the conversation start.
 */
export async function fetchLeadSourceRows(from: string, to: string): Promise<LeadSourceConversationRow[]> {
  return prisma.$queryRaw<LeadSourceConversationRow[]>`
    WITH conv AS (
      SELECT
        wc.id,
        wc.phone,
        wc.created_at,
        wc.lead_source_channel AS channel,
        wc.referral_source_type,
        wc.referral_headline,
        wc.referral_source_url,
        CASE
          WHEN regexp_replace(wc.phone, '\\D', '', 'g') LIKE '972%' THEN regexp_replace(wc.phone, '\\D', '', 'g')
          WHEN regexp_replace(wc.phone, '\\D', '', 'g') LIKE '0%' THEN '972' || substr(regexp_replace(wc.phone, '\\D', '', 'g'), 2)
          WHEN length(regexp_replace(wc.phone, '\\D', '', 'g')) = 9 THEN '972' || regexp_replace(wc.phone, '\\D', '', 'g')
          ELSE regexp_replace(wc.phone, '\\D', '', 'g')
        END AS norm_phone
      FROM wa_conversations wc
      WHERE ((wc.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jerusalem')::date BETWEEN ${from}::date AND ${to}::date
    ),
    cust_reg AS (
      SELECT
        CASE
          WHEN regexp_replace(c.phone, '\\D', '', 'g') LIKE '972%' THEN regexp_replace(c.phone, '\\D', '', 'g')
          WHEN regexp_replace(c.phone, '\\D', '', 'g') LIKE '0%' THEN '972' || substr(regexp_replace(c.phone, '\\D', '', 'g'), 2)
          WHEN length(regexp_replace(c.phone, '\\D', '', 'g')) = 9 THEN '972' || regexp_replace(c.phone, '\\D', '', 'g')
          ELSE regexp_replace(c.phone, '\\D', '', 'g')
        END AS norm_phone,
        MAX(r.created_at) AS last_reg_at
      FROM customers c
      JOIN students s ON s.customer_id = c.id AND s.deleted_at IS NULL
      JOIN registrations r ON r.student_id = s.id AND r.deleted_at IS NULL
      WHERE c.phone IS NOT NULL AND c.deleted_at IS NULL
      GROUP BY 1
    )
    SELECT
      conv.id,
      conv.phone,
      conv.channel,
      conv.referral_source_type AS "referralSourceType",
      conv.referral_headline AS "referralHeadline",
      conv.referral_source_url AS "referralSourceUrl",
      COALESCE(cust_reg.last_reg_at >= conv.created_at, false) AS registered
    FROM conv
    LEFT JOIN cust_reg ON cust_reg.norm_phone = conv.norm_phone AND conv.norm_phone <> ''
  `;
}
