# packages/shared

Pure, DB-free domain rules imported by api, worker and web:

- `types.ts` — roles, vehicle states, rental / period / deposit statuses, locales, `ORG_TZ`.
- `permissions.ts` — `ROLE_PERMISSIONS`: owner / director / manager / mechanic / accountant.
- `money.ts` — GEL in tetri as integers, `formatGel`, VAT 18 % on top, acquiring 1.5 % (315.20 = 320).
- `time.ts`, `periods.ts` — calendar-day arithmetic, 7-day periods from pickup, "paid through", overdue days.
- `states.ts` — which event leads to which vehicle state; effective rental status.

Tests in `test/` (vitest) carry the acceptance figures from the spec.
