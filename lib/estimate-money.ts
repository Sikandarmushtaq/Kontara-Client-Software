/** Safe decimal entry parsing for the supported TWO-decimal currencies only. */
export const TWO_DECIMAL_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'PKR'] as const;
export type TwoDecimalCurrency = (typeof TWO_DECIMAL_CURRENCIES)[number];
const moneyInput = /^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/;
const percentInput = /^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/;

export function priceToMinor(raw: string): number | null {
  const value = raw.trim();
  if (!moneyInput.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return minor <= 100_000_000n ? Number(minor) : null;
}

export function percentToBps(raw: string): number | null {
  const value = raw.trim();
  if (!percentInput.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return bps <= 10_000 ? bps : null;
}

export function calculateTotals(lines: ReadonlyArray<{ quantity: number; unit_amount_minor: number }>, taxRateBps: number) {
  if (!Number.isInteger(taxRateBps) || taxRateBps < 0 || taxRateBps > 10_000) {
    throw new RangeError('Invalid tax rate');
  }
  if (lines.length < 1 || lines.length > 50) throw new RangeError('Invalid line count');
  let subtotalMinor = 0n;
  for (const line of lines) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 10_000 ||
        !Number.isSafeInteger(line.unit_amount_minor) || line.unit_amount_minor < 0 || line.unit_amount_minor > 100_000_000) {
      throw new RangeError('Invalid line item');
    }
    subtotalMinor += BigInt(line.quantity) * BigInt(line.unit_amount_minor);
  }
  const taxMinor = (subtotalMinor * BigInt(taxRateBps) + 5_000n) / 10_000n;
  return {
    subtotal_minor: Number(subtotalMinor),
    tax_minor: Number(taxMinor),
    total_minor: Number(subtotalMinor + taxMinor),
  };
}

export function formatMoney(minor: number, currency: TwoDecimalCurrency): string {
  if (!Number.isSafeInteger(minor)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(minor / 100);
}

export type EstimateStatus = 'draft' | 'sent' | 'accepted' | 'rejected';
export function allowedTransition(from: EstimateStatus, to: EstimateStatus, canManage: boolean, canApprove: boolean): boolean {
  return (from === 'draft' && to === 'sent' && canManage) ||
    (from === 'sent' && (to === 'accepted' || to === 'rejected') && canApprove);
}
