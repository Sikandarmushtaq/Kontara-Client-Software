# Kontrora — Staff Engineer Assignment (Revenue & Billing)

PSA platform (Next.js App Router + Supabase). Ship one revenue slice end-to-end in **2–3 hours**. Quality over completeness.

## Setup  

Node.js **20.9+**, free [Supabase](https://supabase.com) project.

```bash    
npm install
cp .env.local.template .env.local   # fill Supabase URL + keys
# Run supabase/schema.sql in the Supabase SQL Editor
npm run dev                        # http://localhost:3000
```

## Task   
   
Implement **Estimates** scoped to accounts:

1. Schema: estimates + line items — account-bound, amounts in minor units, optional project link
2. Lifecycle: draft → sent → accepted | rejected; no hard deletes
3. RBAC: extend permissions for financial data; enforce account boundaries on every route
4. API: server-side list/filter, create with `Idempotency-Key`, get by id
5. UI under account context: list, create draft, line-item editor

## Evaluation     

Schema & tenancy · Money-touching API correctness · RBAC · Code judgment · Fork README
    
## Submission

Share your fork URL (no PRs). Fork README must cover architecture decisions, security/tenancy review, how to run tests, and what you'd ship next (e.g. Stripe, reconciliation).
---

## Estimates implementation (assignment submission)

### Scope and architecture

This implementation adds an account-bound estimates slice to the existing Next.js App Router + Supabase platform. The database migration is `supabase/estimates.sql` (followed by `supabase/estimates-currency-guard.sql`). `estimates` and `estimate_line_items` are linked by UUIDs; optional `project_id` is checked against the parent `account_id` in the database, not just the UI. There are no browser-facing direct INSERT/UPDATE/DELETE grants for financial tables: writes use PostgreSQL `SECURITY DEFINER` RPCs invoked under the signed-in user's auth context. Next.js handlers authenticate and authorize again before invoking them.

Money is stored as **integer minor units**, and tax rates as basis points (10% = 1000 bps). JavaScript UI calculations use `BigInt` for previews, while PostgreSQL recomputes and persists authoritative totals; half-up rounding happens once at the estimate level. Currently the UI/API support USD, EUR, GBP, CAD, AUD and PKR (two-decimal currencies), with a database constraint applied by the second migration. Currencies requiring zero or three decimal minor units are intentionally unsupported in this scoped version.

### Routes and lifecycle

| Method | Route | Permission | Purpose |
|---|---|---|---|
| GET | `/api/accounts/:accountId/estimates` | `view_estimates` | Filter by status/project and paginate |
| POST | `/api/accounts/:accountId/estimates` | `manage_estimates` | Create draft with `Idempotency-Key` |
| GET | `/api/accounts/:accountId/estimates/:estimateId` | `view_estimates` | Read itemized estimate and UI capabilities |
| PATCH | `/api/accounts/:accountId/estimates/:estimateId` | `manage_estimates` | Atomically replace draft-only line items |
| POST | `/api/accounts/:accountId/estimates/:estimateId/transition` | `manage_estimates` for Sent, `approve_estimates` for decision | Change status under row lock |

Valid lifecycle: **draft → sent → accepted OR rejected**. Decisions are terminal. There is no hard-delete endpoint. The database's row lock guards concurrent transitions; SQL refuses non-draft edits. The `Idempotency-Key` is unique within account and creating user, and the stored request fingerprint detects key reuse with a different body.

### Security and tenancy review

`can_access_estimate(account_id, permission)` enforces an authenticated user, non-client profile, assigned account membership or account-manager ownership, and the requested finance permission on an active role; an explicit `is_superadmin` bypass is limited to authenticated, non-client profiles. Estimate SELECT policies independently check this function, including through line-item reads. Other tenant's UUID must never authorize access. Use of the `SUPABASE_SERVICE_ROLE_KEY` in a browser or any Estimates API handler is forbidden. Error responses do not include raw financial SQL or secret keys. The existing codebase contains legacy broad policies for unrelated modules; `supabase/dev-compatibility.sql` addresses the known login/account-read demo blockers but does **not** constitute a full production security audit of every pre-existing table.

### Install and run (fresh development database)

1. Install Node.js 20.9+ and dependencies (`npm install`); copy `.env.local.template` to `.env.local`, entering your private Supabase credentials. **Never include `.env.local` in submission.**
2. On your OWN new Supabase project, run `supabase/schema.sql`, then `supabase/seed-roles.sql`, then `supabase/dev-compatibility.sql` (only if using the original demo schema), then `supabase/estimates.sql`, then `supabase/estimates-currency-guard.sql` using Supabase SQL Editor. Do not rerun base schema against a populated production database.
3. Run `npm run seed:users` only on an isolated demo database. The seeded accounts/projects may have demo statuses adapted to the schema. **Seeded passwords are fixed test credentials — never deploy this script/user set in production.**
4. Run `npm run dev`, log in with a seeded account manager, open `/accounts/<account-id>/estimates`, create a draft, edit it and mark it Sent. Switch to an authorized approver to Accept or Reject.
5. Check folder layout: `node scripts/verify-estimates-layout.cjs`. API routes belong under `app/api/accounts/...`, while the UI page belongs under `app/accounts/...` (not `app/api`).

### Tests and how to exercise security

- Run `npm test -- __tests__/estimate-money.test.ts` for price parsing, tax rounding, boundary conditions and status rules; run `npm run lint` and `npm run build` for the full project (the inherited project can have independent warnings).
- Run `tests/estimates-authorization-smoke.sql` in a **development** Supabase SQL Editor. Compare `actual` to `expected`. It impersonates seeded users via session-local claims inside rolled-back transactions: Account Manager can manage Meridian but not Harlow and cannot approve; Client cannot view Meridian's financial estimates.
- Through the app UI, create a draft, verify the same `Idempotency-Key` and same body returns the SAME estimate ID, and that reusing the key with a different body returns HTTP `409`. Check negative routes with another account/estimate ID return 403/404. Verify editing a Sent estimate is rejected with `409`, invalid transitions are rejected with `409`, and an Account Manager receives `403` attempting to Accept/Reject.
- Current confirmed manual results: list GET, create POST HTTP 201, details GET, stored money totals 130000 + 13000 = 143000 minor units, and frontend display. New status/edit flows and cross-tenant tests are included but require verification against the reviewer's Supabase instance; they have **not** been claimed as live-tested.

### What I would ship next

1. A fully audited, least-privilege RLS migration for **every** legacy PSA table and account-facing API, with negative automated tenant tests.
2. Named price books, discounts, customer acceptance (with verified identity), versioned estimate PDFs and audit history.
3. Conversion of accepted estimates into invoices/payments through Stripe with webhooks, idempotent reconciliation and ledger accounting.
4. Currency-specific minor-unit support and configurable taxes for additional locales.
5. Database integration tests in CI using a disposable Supabase test instance; accessible approval workflows and better API observability.

### Submission

Per the assignment, share a GitHub fork URL without creating a PR; per the direct client message also provide a zipped source-code link with sharing enabled. Do not distribute `.env.local`, access tokens, service keys, `.next`, `node_modules` or seeded production credentials.


To navigate to Estimates, use the sidebar **Estimates** account picker, the **View Estimates** button on each authorized account card, or the account header button. Full instructions in `OPEN-ME-FIRST.txt`.
