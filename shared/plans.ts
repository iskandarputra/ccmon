/**
 * @file plans.ts
 * @brief Subscription plan prices for the plan-value comparison — the single place to update.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

/**
 * Monthly subscription prices in USD, last verified 2026-06. There is no API
 * to fetch these — when Anthropic changes plan pricing, update this table.
 * Team/enterprise are seat-priced per organization and deliberately absent
 * (the plan-value panel hides itself for those accounts).
 */
export const PLAN_PRICES_USD = {
  pro: 20,
  max5x: 100,
  max20x: 200,
} as const;

/**
 * ChatGPT subscription prices in USD, last verified 2026-06 — the plans a
 * Codex account bills against. Same rules as the Anthropic table: no API
 * publishes them, and seat-priced Business/Enterprise are deliberately absent.
 *
 * These live SEPARATELY, and must. The two vocabularies collide on the word
 * "pro" and mean very different money: Claude Pro is $20/mo, ChatGPT Pro is
 * $200/mo. Running a Codex plan through the Anthropic table priced a ChatGPT
 * Pro subscription at $20 and gave ChatGPT Plus no price at all, because
 * "plus" matches nothing there.
 */
export const CHATGPT_PLAN_PRICES_USD = {
  plus: 20,
  pro: 200,
} as const;
