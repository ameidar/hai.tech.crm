import { describe, it, expect } from 'vitest';
import {
  grossFromIncome,
  buildProformaSnapshot,
  applyProformaSnapshot,
  assertProformaAmountMatch,
  type ProformaSnapshot,
} from '../billing.js';
import type { CreateDocumentInput, MorningIncomeItem } from '../morning/documents.js';

const line = (over: Partial<MorningIncomeItem> = {}): MorningIncomeItem => ({
  description: 'בינה מלאכותית — מאי 2026',
  quantity: 30,
  price: 224.58,
  currency: 'ILS',
  vatType: 2,
  ...over,
});

const payload = (income: MorningIncomeItem[], vatType: 0 | 2 = 2): CreateDocumentInput => ({
  type: 320,
  client: { id: 'client-uuid' },
  income,
  vatType,
});

describe('grossFromIncome', () => {
  it('treats vatType 2 lines as VAT-inclusive (total = price × qty)', () => {
    expect(grossFromIncome([line({ vatType: 2 })])).toBe(6737.4);
  });

  it('adds 18% VAT on top for vatType 0 lines', () => {
    expect(grossFromIncome([line({ vatType: 0, price: 100, quantity: 2 })])).toBe(236);
  });

  it('treats vatType 1 (exempt) and undefined consistently', () => {
    expect(grossFromIncome([line({ vatType: 1, price: 100, quantity: 1 })])).toBe(100);
    // undefined falls back to "add VAT on top"
    expect(grossFromIncome([line({ vatType: undefined, price: 100, quantity: 1 })])).toBe(118);
  });

  it('sums mixed lines per their own vatType', () => {
    const total = grossFromIncome([
      line({ vatType: 2, price: 100, quantity: 1 }), // 100
      line({ vatType: 0, price: 100, quantity: 1 }), // 118
    ]);
    expect(total).toBe(218);
  });
});

describe('buildProformaSnapshot', () => {
  it('prefers Morning\'s authoritative gross over the computed one', () => {
    const snap = buildProformaSnapshot(payload([line()]), 6737.4);
    expect(snap.grossTotal).toBe(6737.4);
    expect(snap.income).toHaveLength(1);
    expect(snap.vatType).toBe(2);
  });

  it('falls back to computing the gross when Morning gives no amount', () => {
    const snap = buildProformaSnapshot(payload([line({ vatType: 0, price: 100, quantity: 1 })], 0));
    expect(snap.grossTotal).toBe(118);
  });
});

describe('applyProformaSnapshot', () => {
  it('overwrites the live lines with the frozen proforma lines', () => {
    const snap: ProformaSnapshot = {
      income: [line({ price: 224.58, quantity: 30, vatType: 2 })],
      vatType: 2,
      remarks: 'המחירים בחשבון זה כוללים מע״מ.',
      grossTotal: 6737.4,
    };
    // Live state drifted: someone changed the quantity to 31 after the proforma went out.
    const p = payload([line({ price: 224.58, quantity: 31, vatType: 2 })]);
    applyProformaSnapshot(p, snap);
    expect(p.income[0].quantity).toBe(30);
    expect(grossFromIncome(p.income)).toBe(6737.4);
    expect(p.remarks).toBe('המחירים בחשבון זה כוללים מע״מ.');
  });

  it('clears description when the snapshot has none', () => {
    const p = payload([line()]);
    p.description = 'stale title';
    applyProformaSnapshot(p, { income: [line()], vatType: 2, grossTotal: 6737.4 });
    expect(p.description).toBeUndefined();
  });

  it('is a no-op for legacy snapshots that hold only a gross total', () => {
    const p = payload([line({ quantity: 31 })]);
    applyProformaSnapshot(p, { grossTotal: 6737.4 });
    expect(p.income[0].quantity).toBe(31); // untouched — nothing to reuse
  });
});

describe('assertProformaAmountMatch', () => {
  const snap: ProformaSnapshot = { grossTotal: 6737.4 };

  it('throws when a downstream document total drifts from the proforma', () => {
    // Live lines recomputed to 31 meetings → 6962.0, must be refused.
    const p = payload([line({ quantity: 31, vatType: 2 })]);
    expect(() => assertProformaAmountMatch(p, snap, 'חשבונית מס/קבלה')).toThrow(/does not match/);
  });

  it('throws when the VAT flag flipped (same lines, different total)', () => {
    // Proforma was VAT-inclusive (6737.40). The cycle flag flipped, so the live payload now
    // adds 18% on top → 7950.13. Must be refused.
    const p = payload([line({ vatType: 0 })], 0);
    expect(() => assertProformaAmountMatch(p, snap, 'חשבונית מס/קבלה')).toThrow(/does not match/);
  });

  it('passes when the total matches within rounding tolerance', () => {
    const p = payload([line({ vatType: 2 })]);
    expect(() => assertProformaAmountMatch(p, snap, 'חשבונית מס/קבלה')).not.toThrow();
  });

  it('does not block when there is no proforma anchor to verify against', () => {
    const p = payload([line({ quantity: 999 })]);
    expect(() => assertProformaAmountMatch(p, null, 'חשבונית מס/קבלה')).not.toThrow();
  });

  it('reusing the snapshot guarantees the guard passes (end-to-end of the fix)', () => {
    const full: ProformaSnapshot = {
      income: [line({ quantity: 30, vatType: 2 })],
      vatType: 2,
      grossTotal: 6737.4,
    };
    // Drifted live state, then snapshot reuse, then guard — the path every downstream doc takes.
    const p = payload([line({ quantity: 31, vatType: 2 })]);
    applyProformaSnapshot(p, full);
    expect(() => assertProformaAmountMatch(p, full, 'חשבונית מס/קבלה')).not.toThrow();
    expect(grossFromIncome(p.income)).toBe(6737.4);
  });
});
