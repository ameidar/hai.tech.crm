type LeadAttributionSource = Record<string, unknown>;

export interface LeadAttribution {
  campaignId?: string | null;
  campaignName?: string | null;
  adId?: string | null;
  adName?: string | null;
  adsetName?: string | null;
  formId?: string | null;
  note?: string | null;
}

const PARAM_LABELS: Record<string, string> = {
  utm_source: 'utm_source',
  utm_medium: 'utm_medium',
  utm_campaign: 'utm_campaign',
  utm_content: 'utm_content',
  utm_term: 'utm_term',
  fbclid: 'fbclid',
};

function clean(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  return text || null;
}

function first(source: LeadAttributionSource, keys: string[]): string | null {
  for (const key of keys) {
    const value = clean(source[key]);
    if (value) return value;
  }
  return null;
}

export function extractLeadAttribution(source: LeadAttributionSource): LeadAttribution {
  const utmSource = first(source, ['utm_source', 'utmSource']);
  const utmMedium = first(source, ['utm_medium', 'utmMedium']);
  const utmCampaign = first(source, ['utm_campaign', 'utmCampaign']);
  const utmContent = first(source, ['utm_content', 'utmContent']);
  const utmTerm = first(source, ['utm_term', 'utmTerm']);
  const fbclid = first(source, ['fbclid']);

  const rawNoteParts = [
    ['utm_source', utmSource],
    ['utm_medium', utmMedium],
    ['utm_campaign', utmCampaign],
    ['utm_content', utmContent],
    ['utm_term', utmTerm],
    ['fbclid', fbclid],
  ] as const;

  const noteValues = rawNoteParts
    .filter(([, value]) => value)
    .map(([key, value]) => `${PARAM_LABELS[key]}=${value}`);

  return {
    campaignId: first(source, ['metaCampaignId', 'fbCampaignId', 'campaign_id', 'campaignIdMeta', 'utm_id']),
    campaignName: first(source, ['campaignName', 'campaign_name']) || utmCampaign,
    adId: first(source, ['adId', 'ad_id', 'metaAdId', 'fbAdId']),
    adName: first(source, ['adName', 'ad_name']) || utmContent,
    adsetName: first(source, ['adsetName', 'adset_name', 'adSetName']) || utmTerm,
    formId: first(source, ['formId', 'form_id']),
    note: noteValues.length > 0 ? `ייחוס פרסום: ${noteValues.join(' | ')}` : null,
  };
}
