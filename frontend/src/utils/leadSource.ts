// Lead-source channel labels — mirror backend/src/services/wa-lead-source.ts (LEAD_SOURCE_CHANNEL_LABELS).
export const LEAD_SOURCE_LABELS: Record<string, string> = {
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

export function leadSourceLabel(channel?: string | null): string {
  if (!channel) return LEAD_SOURCE_LABELS.unknown;
  return LEAD_SOURCE_LABELS[channel] || channel;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Path (decoded, for Hebrew slugs) of a source URL, or the raw value if it isn't a URL. */
export function sourcePagePath(url?: string | null): string {
  if (!url) return '';
  try {
    return safeDecode(new URL(url).pathname || '/');
  } catch {
    return safeDecode(url);
  }
}
