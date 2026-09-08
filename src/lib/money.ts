import { Decimal } from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

export function D(value: Decimal.Value): Decimal {
  return new Decimal(value);
}

export function alignDown(value: Decimal.Value, step: Decimal.Value): Decimal {
  const s = D(step);
  if (s.lte(0)) return D(value);
  return D(value).div(s).toDecimalPlaces(0, Decimal.ROUND_DOWN).times(s);
}

export function alignUp(value: Decimal.Value, step: Decimal.Value): Decimal {
  const s = D(step);
  if (s.lte(0)) return D(value);
  return D(value).div(s).toDecimalPlaces(0, Decimal.ROUND_UP).times(s);
}

export function isMultiple(value: Decimal.Value, step: Decimal.Value): boolean {
  const s = D(step);
  if (s.lte(0)) return true;
  return D(value).mod(s).eq(0);
}

export function bpsDiff(a: Decimal.Value, b: Decimal.Value): Decimal {
  const base = D(b);
  if (base.eq(0)) return D(0);
  return D(a).minus(base).div(base).times(10_000).abs();
}

export function asFixed(value: Decimal): string {
  return value.toFixed();
}
