import { D, type AccountSnapshot } from "./domain.js";

// Hyperliquid's protocol opening-order floor, not a collateral allocation floor.
// https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/error-responses
export const HYPERLIQUID_MIN_OPEN_NOTIONAL_USDC = "10";

type OrderCheck =
  | { ok: true }
  | {
      ok: false;
      code:
        | "VENUE_RULES_UNAVAILABLE"
        | "INVALID_ORDER_QUANTITY"
        | "BELOW_MINIMUM_NOTIONAL";
      message: string;
      order_notional_usdc?: string;
      minimum_notional_usdc?: string;
    };

/** Check the actual net opening leg, including a separate opening leg on flips.
 * Hyperliquid reduce-only reductions/closes retain their dust-close exemption.
 * Never round up an order or fall back to a trader's historical minimum.
 */
export function checkPerpsOrder(
  snapshot: AccountSnapshot,
  key: string,
  targetQuantity: string,
): OrderCheck {
  const unavailable: OrderCheck = {
    ok: false,
    code: "VENUE_RULES_UNAVAILABLE",
    message:
      "Verified per-asset venue price, quantity precision and opening-order minimum are required.",
  };
  try {
    const price = D(snapshot.prices[key] ?? "NaN");
    const decimals = snapshot.quantity_decimals?.[key];
    const target = D(targetQuantity);
    const current = D(snapshot.positions[key] ?? "0");
    if (
      !price.isFinite() ||
      price.lte(0) ||
      decimals == null ||
      !Number.isInteger(decimals) ||
      decimals < 0 ||
      decimals > 8 ||
      !target.isFinite() ||
      !current.isFinite()
    )
      return unavailable;
    if (!target.eq(target.toDecimalPlaces(decimals)))
      return {
        ok: false,
        code: "INVALID_ORDER_QUANTITY",
        message:
          "Target quantity exceeds the venue's current size precision; it must not be rounded up.",
      };
    if (target.eq(current)) return { ok: true };
    const flip =
      !current.isZero() &&
      !target.isZero() &&
      current.isPositive() !== target.isPositive();
    const reduction = !flip && target.abs().lte(current.abs());
    if (reduction) return { ok: true };
    const minimum = D(snapshot.min_notionals[key] ?? "NaN");
    if (!minimum.isFinite() || minimum.lte(0)) return unavailable;
    const size = flip ? target.abs() : target.minus(current).abs();
    const notional = size.times(price);
    if (notional.lt(minimum))
      return {
        ok: false,
        code: "BELOW_MINIMUM_NOTIONAL",
        message:
          "Sized Perps opening order is below the venue minimum; skipped without increasing quantity or leverage.",
        order_notional_usdc: notional.toString(),
        minimum_notional_usdc: minimum.toString(),
      };
    return { ok: true };
  } catch {
    return unavailable;
  }
}
