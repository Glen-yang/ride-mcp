import { z } from "zod";

// JSON-safe decimals: six-place USDC precision; no floating point accounting.
export const money = z.union([
  z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,6})?$/),
  z
    .number()
    .finite()
    .nonnegative()
    .max(999999999999)
    .refine((v) => /^\d+(\.\d{1,6})?$/.test(String(v))),
]);
export const positiveMoney = money.refine(
  (v) => Number(v) > 0,
  "Amount must be positive",
);
export const id = z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/);
export const market = z.enum(["perps", "prediction", "both"]);
export const preferences = z
  .object({
    budget_usdc: positiveMoney,
    loss_trigger_pct: z.number().min(1).max(100),
    market: market.default("perps"),
    assets: z
      .array(z.string().regex(/^[A-Z][A-Z0-9]{0,15}$/))
      .max(20)
      .default(["BTC", "ETH"]),
    allow_altcoins: z.boolean().default(false),
  })
  .strict();
const portfolioInput = z.object({ portfolio_id: id.optional() }).strict();
export const inputs = {
  set_preferences: preferences,
  recommend_traders: z.object({ preferences: preferences.optional() }).strict(),
  get_trader_profile: z
    .object({
      trader_id: id,
      market: z.enum(["perps", "prediction"]).optional(),
    })
    .strict(),
  start_copy: z.object({ plan_id: id }).strict(),
  recalculate_plan: z
    .object({
      plan_id: id,
      preferences: preferences.optional(),
      allocations: z
        .array(
          z
            .object({
              trader_id: id,
              amount_usdc: positiveMoney,
              leverage_cap: z.number().int().min(1).max(8),
              stop_loss_pct: z.number().min(1).max(100).default(30),
            })
            .strict(),
        )
        .min(3)
        .max(6)
        .optional(),
    })
    .strict(),
  get_performance: z
    .object({
      portfolio_id: id.optional(),
      period: z.enum(["daily", "weekly", "inception"]).default("weekly"),
    })
    .strict(),
  diagnose_copy: z
    .object({
      copy_id: id,
      start_at: z.number().int().positive(),
      end_at: z.number().int().positive(),
    })
    .strict()
    .refine(
      (v) => v.end_at > v.start_at && v.end_at - v.start_at <= 31 * 86400_000,
      "Use a time window of at most 31 days",
    ),
  get_notification_preferences: z.object({}).strict(),
  set_notification_preferences: z
    .object({
      daily_digest: z.boolean(),
      local_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      timezone: z
        .string()
        .max(80)
        .refine((v) => {
          try {
            new Intl.DateTimeFormat("en", { timeZone: v });
            return true;
          } catch {
            return false;
          }
        }, "Use an IANA timezone"),
    })
    .strict(),
  get_portfolio: portfolioInput,
  update_copy: z
    .object({
      copy_id: id,
      amount_usdc: positiveMoney.optional(),
      leverage_cap: z.number().int().min(1).max(8).optional(),
      stop_loss_pct: z.number().min(1).max(100).optional(),
      replacement_trader_id: id.optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 1, "Specify a change"),
  stop_copy: z
    .object({
      copy_id: id,
      mode: z.enum(["wind_down", "close_now"]).default("wind_down"),
    })
    .strict(),
  review_portfolio: portfolioInput,
  get_updates: z
    .object({
      cursor: z.string().max(256).optional(),
      limit: z.number().int().min(1).max(100).default(20),
    })
    .strict(),
  close_position: z.object({ position_id: id }).strict(),
} as const;
export type ToolName = keyof typeof inputs;
export const mutationTools = new Set<ToolName>([
  "start_copy",
  "update_copy",
  "stop_copy",
  "close_position",
]);
// State edits are distinct from proposals that can move funds.
export const stateTools = new Set<ToolName>([
  "set_preferences",
  "recalculate_plan",
  "recommend_traders",
  "set_notification_preferences",
]);
export const TOOL_NAMES = Object.keys(inputs) as ToolName[];
export const output = z
  .object({
    version: z.literal("3"),
    status: z.enum([
      "ok",
      "empty",
      "requires_confirmation",
      "queued",
      "executing",
      "partially_filled",
      "settling",
      "completed",
      "failed",
      "uncertain",
      "stale",
    ]),
    data: z.record(z.string(), z.unknown()),
    warnings: z.array(z.string()),
    as_of: z.string(),
    error: z
      .object({ code: z.string(), message: z.string(), retryable: z.boolean() })
      .strict()
      .optional(),
  })
  .strict();
export type Result = z.infer<typeof output>;
export type Preferences = z.infer<typeof preferences>;
export class AgentError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable = false,
    public httpStatus = 409,
  ) {
    super(message);
  }
}
export function result(
  data: Record<string, unknown>,
  status: Result["status"] = "ok",
  warnings: string[] = [],
): Result {
  return {
    version: "3",
    status,
    data,
    warnings,
    as_of: new Date().toISOString(),
  };
}
export function failure(error: unknown): Result {
  const e =
    error instanceof AgentError
      ? error
      : error instanceof z.ZodError
        ? new AgentError(
            "INVALID_INPUT",
            "Input does not match the Ride tool contract.",
            false,
            400,
          )
        : new AgentError(
            "INTERNAL_ERROR",
            "Ride could not complete this request.",
            true,
            500,
          );
  return {
    ...result({}, "failed"),
    error: { code: e.code, message: e.message, retryable: e.retryable },
  };
}

// No raw upstream objects cross the MCP boundary. Reject accidental addresses
// anywhere, including explanations and nested arrays, instead of leaking them.
export function publicResult(value: unknown): Result {
  const checked = output.parse(value);
  if (/0x[a-fA-F0-9]{40}\b/.test(JSON.stringify(checked)))
    throw new AgentError(
      "PRIVATE_DATA",
      "Response contained a private trading identity.",
      false,
      502,
    );
  return checked;
}
