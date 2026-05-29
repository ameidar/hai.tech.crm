import { describe, expect, it } from 'vitest';
import { getInstitutionalOrdersListParams } from './InstitutionalOrders';

describe('InstitutionalOrders list query params', () => {
  it('does not require linked cycles so newly-created draft orders are visible', () => {
    const params = getInstitutionalOrdersListParams('', 1);

    expect(params).toEqual({
      status: undefined,
      page: 1,
      limit: 50,
    });
    expect(params).not.toHaveProperty('withCycles');
    expect(params).not.toHaveProperty('withRelevantCycles');
  });

  it('preserves explicit status filters without adding cycle filters', () => {
    const params = getInstitutionalOrdersListParams('draft', 2);

    expect(params).toEqual({
      status: 'draft',
      page: 2,
      limit: 50,
    });
    expect(params).not.toHaveProperty('withCycles');
  });
});
