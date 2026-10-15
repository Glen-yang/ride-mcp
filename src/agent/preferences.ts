import { preferences, type Preferences } from "./contracts.js";
import type { State } from "./repository.js";

const questions = {
  budget_usdc: { question: "这次计划投入多少 USDC？", unit: "USDC" },
  loss_trigger_pct: { question: "可接受的亏损触发比例是多少？", unit: "%" },
  market: {
    question: "想跟单哪个市场？",
    options: ["perps", "prediction", "both"],
  },
  basket_size: {
    question: "组合想选几位 trader？",
    options: [2, 3, 4, 5, 6, 7, 8],
  },
  fixed_margin_usdc: {
    question: "每次新开仓使用多少 USDC 保证金？",
    unit: "USDC",
  },
};

// Old approved 'any' and RWA plans ignored the symbol fields. Canonicalize
// those fields when editing a copy; never reinterpret a running old portfolio.
export function normalizedAssetPreferences<T extends Partial<Preferences>>(
  value: T,
  version = 2,
): T {
  return version !== 2 && ["any", "rwa"].includes(value.asset_category ?? "")
    ? { ...value, assets: [], allow_altcoins: true }
    : value;
}

export function preferenceCollection(
  s: State,
  answers: Partial<Preferences> = {},
) {
  const previous =
    s.preferences ??
    s.plans.at(-1)?.preferences ??
    s.portfolios.find((p) => p.state !== "closed")?.preferences ??
    {};
  const previousVersion = s.preferences
    ? s.preference_asset_filter_version
    : (s.plans.at(-1)?.asset_filter_version ??
      s.portfolios.find((p) => p.state !== "closed")?.asset_filter_version);
  const saved = {
    assets: [] as string[],
    allow_altcoins: true,
    asset_category: "any" as const,
    ...normalizedAssetPreferences(previous, previousVersion ?? 1),
    ...(s.preference_draft ?? {}),
    ...answers,
  };
  const missing: (keyof typeof questions)[] = [];
  for (const key of ["budget_usdc", "loss_trigger_pct", "market"] as const)
    if (saved[key] == null) missing.push(key);
  if (saved.portfolio_kind === "basket" && saved.basket_size == null)
    missing.push("basket_size");
  if (saved.copy_mode === "fixed" && saved.fixed_margin_usdc == null)
    missing.push("fixed_margin_usdc");
  return {
    ready: missing.length === 0,
    answers: saved,
    missing_fields: missing,
    questions: missing.map((field) => ({ field, ...questions[field] })),
    defaults: { assets: [], allow_altcoins: true, asset_category: "any" },
    optional_choices: {
      risk_tolerance: ["low", "medium", "high"],
      portfolio_kind: ["single", "basket"],
      asset_category: ["crypto", "rwa", "any"],
      copy_mode: ["ride_recommends", "fixed", "proportional"],
    },
    instruction: missing.length
      ? "Ask the user only these missing questions before recommending. Save partial answers; do not invent a budget or acceptable loss. Offer optional choices with clearly disclosed defaults."
      : "Reuse these answers. Do not ask again after funding. Budget does not authorize a transfer or trade.",
  };
}

export function completePreferences(
  s: State,
  answers: Partial<Preferences> = {},
) {
  const collection = preferenceCollection(s, answers);
  return collection.ready ? preferences.parse(collection.answers) : null;
}
