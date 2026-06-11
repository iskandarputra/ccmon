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
