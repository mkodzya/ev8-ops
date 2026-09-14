# packages/shared

Pure, DB-free domain rules imported by api, worker and web:

- `types.ts` — roles, vehicle states, rental / period / deposit statuses, locales, `ORG_TZ`.
- `permissions.ts` — `ROLE_PERMISSIONS`: owner / director / manager / mechanic / accountant.
- `money.ts` — GEL in tetri as integers, `formatGel`, VAT 18 % on top, acquiring 1.5 % (315.20 = 320).
- `time.ts`, `periods.ts` — calendar-day arithmetic, 7-day periods from pickup, "paid through", overdue days.
- `states.ts` — which event leads to which vehicle state; effective rental status.
- `payments.ts` — how a payment closes a deposit and then periods oldest-first, and what a customer's balance is.
- `georgian.ts` — the transliteration Georgian banks use, and matching a payer to a customer across spellings.
- `payments.ts` also carries `instalmentSchedule` — a sale's down payment plus N monthly instalments, rounding on the first.
- `matching.ts` — which rental a statement line belongs to, and only when exactly one can own it.

Tests in `test/` (vitest) carry the acceptance figures from the spec.
