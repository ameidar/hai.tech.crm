import { describe, expect, it } from 'vitest';
import { describeMetaStatusError } from '../meta-status-error.js';

describe('describeMetaStatusError', () => {
  it('prefers error_data.details and prefixes the code', () => {
    expect(describeMetaStatusError({
      status: 'failed',
      errors: [{ code: 131049, title: 'This message was not delivered to maintain healthy ecosystem engagement.', error_data: { details: 'In order to maintain a healthy ecosystem engagement, the message failed to be delivered.' } }],
    })).toEqual({ code: 131049, message: '131049: In order to maintain a healthy ecosystem engagement, the message failed to be delivered.' });
  });

  it('falls back to title, and handles missing errors', () => {
    expect(describeMetaStatusError({ errors: [{ code: 131026, title: 'Message undeliverable' }] }))
      .toEqual({ code: 131026, message: '131026: Message undeliverable' });
    expect(describeMetaStatusError({ status: 'failed' })).toEqual({ code: null, message: null });
  });
});
