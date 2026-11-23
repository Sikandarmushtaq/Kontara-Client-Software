import { describe, expect, it } from 'vitest';
import { allowedTransition, calculateTotals, percentToBps, priceToMinor } from '@/lib/estimate-money';

describe('minor-unit input parsing', () => {
  it('parses dollars without floating point drift', () => {
    expect(priceToMinor('0.01')).toBe(1);
    expect(priceToMinor('500')).toBe(50000);
    expect(priceToMinor('12.34')).toBe(1234);
  });
  it('rejects excessive precision, negatives, unsafe price and malformed input', () => {
    for (const input of ['-1', '0.001', '1e3', '1000001', 'abc', '']) expect(priceToMinor(input)).toBeNull();
  });
  it('parses tax percentage exactly to basis points', () => {
    expect(percentToBps('10')).toBe(1000);
    expect(percentToBps('7.25')).toBe(725);
    expect(percentToBps('100')).toBe(10000);
    expect(percentToBps('100.01')).toBeNull();
    expect(percentToBps('1.234')).toBeNull();
  });
});

describe('money calculation and lifecycle', () => {
  it('matches the database for the client test case', () => {
    expect(calculateTotals([
      { quantity: 1, unit_amount_minor: 50000 },
      { quantity: 1, unit_amount_minor: 80000 },
    ], 1000)).toEqual({ subtotal_minor: 130000, tax_minor: 13000, total_minor: 143000 });
  });
  it('rounds half-up and avoids IEEE754 money addition errors', () => {
    expect(calculateTotals([{quantity:1, unit_amount_minor:1}], 5000).tax_minor).toBe(1);
    expect(calculateTotals([{quantity:3, unit_amount_minor:10}], 0).subtotal_minor).toBe(30);
  });
  it('rejects invalid limits and supports high valid totals', () => {
    expect(() => calculateTotals([{ quantity: 0, unit_amount_minor: 10 }], 100)).toThrow();
    expect(() => calculateTotals([{ quantity: 1, unit_amount_minor: 1 }], -1)).toThrow();
    const result = calculateTotals(Array.from({length:50}, () => ({quantity:10000, unit_amount_minor:100000000})), 10000);
    expect(result.total_minor).toBe(100_000_000_000_000);
  });
  it('enforces valid lifecycle and distinct permissions', () => {
    expect(allowedTransition('draft','sent',true,false)).toBe(true);
    expect(allowedTransition('sent','accepted',true,false)).toBe(false);
    expect(allowedTransition('sent','accepted',false,true)).toBe(true);
    expect(allowedTransition('sent','rejected',false,true)).toBe(true);
    expect(allowedTransition('accepted','draft',true,true)).toBe(false);
    expect(allowedTransition('draft','accepted',true,true)).toBe(false);
  });
});
