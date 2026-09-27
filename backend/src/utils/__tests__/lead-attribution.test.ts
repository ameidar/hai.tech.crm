import { describe, expect, it } from 'vitest';
import { extractLeadAttribution } from '../lead-attribution.js';

describe('extractLeadAttribution', () => {
  it('maps Meta/UTM fields into lead attribution fields', () => {
    const attribution = extractLeadAttribution({
      utm_source: 'facebook',
      utm_medium: 'paid_social',
      utm_campaign: 'Roblox Online 04/10',
      utm_content: 'existing-post',
      utm_term: 'parents-28-50',
      utm_id: '120250355091530297',
      ad_id: '120250355118240297',
      fbclid: 'IwAR-test',
    });

    expect(attribution).toEqual(expect.objectContaining({
      campaignId: '120250355091530297',
      campaignName: 'Roblox Online 04/10',
      adId: '120250355118240297',
      adName: 'existing-post',
      adsetName: 'parents-28-50',
      note: expect.stringContaining('utm_source=facebook'),
    }));
  });

  it('supports explicit Meta names over UTM fallbacks', () => {
    const attribution = extractLeadAttribution({
      campaign_name: 'Meta campaign',
      ad_name: 'Meta ad',
      adset_name: 'Meta ad set',
      utm_campaign: 'utm campaign',
      utm_content: 'utm content',
      utm_term: 'utm term',
    });

    expect(attribution.campaignName).toBe('Meta campaign');
    expect(attribution.adName).toBe('Meta ad');
    expect(attribution.adsetName).toBe('Meta ad set');
  });
});
