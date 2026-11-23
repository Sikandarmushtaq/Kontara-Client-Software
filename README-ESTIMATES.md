# Kontrora — Estimates Module Implementation

**Project:** Kontrora Full-Stack Assignment  
**Technology:** Next.js 16, TypeScript, Supabase, PostgreSQL  
**Date:** November 22, 2026  
**Implementation Status:** Core functionality implemented; final verification pending

## 1. Project Overview

The Estimates Module has been implemented within the existing Kontrora platform according to the assignment requirements.

The module enables authorized users to create, edit, view, send, accept, and reject financial estimates associated with specific client accounts.

The implementation includes database migrations, secure backend APIs, financial calculations, role-based access control, frontend interfaces, and account-specific navigation.

## 2. Assignment Requirements and Implementation Status

| Client Requirement | Implementation | Testing Status |
|---|---|---|
| Account-specific estimates | Implemented | PASS |
| Create draft estimates | Implemented | PASS |
| Estimate list and details | Implemented | PASS |
| Multiple line items | Implemented | PASS |
| Quantity and unit pricing | Implemented | PASS |
| Subtotal, tax, and total calculations | Implemented | PASS |
| Edit draft estimates | Implemented | Manually exercised |
| Draft → Sent transition | Implemented | PASS |
| Sent → Accepted transition | Implemented | PASS |
| Sent → Rejected transition | Implemented | PASS |
| Role-based authorization | Implemented | Basic negative test PASS |
| Tenant/account isolation | Implemented | Additional testing pending |
| Idempotent estimate creation | Implemented | PASS |
| Frontend Estimates navigation | Implemented | PASS |
| Automated unit and security tests | Included | Full execution pending |
| Production build validation | Pending verification | NOT YET VERIFIED |
| Documentation and source delivery | Prepared | Final submission pending |

## 3. Implemented Features

### 3.1 Estimates Management

Authorized users can:

- View estimates belonging to an assigned client account.
- Create new draft estimates.
- Add and manage multiple line items.
- Enter quantity, unit price, and tax rate.
- Edit estimates while they remain in Draft status.
- View stored totals and estimate details.
- Filter estimates by status.

### 3.2 Estimate Status Workflow

The implemented lifecycle is:

**Draft → Sent → Accepted / Rejected**

- **Draft:** Estimate can be edited by an authorized manager.
- **Sent:** Estimate has been issued and can no longer be edited as a draft.
- **Accepted:** An authorized approver has approved the estimate.
- **Rejected:** An authorized approver has rejected the estimate.

Accepted and Rejected are terminal states.

### 3.3 Financial Calculations

Financial amounts are stored as integer minor units to avoid floating-point rounding errors.

Tax rates are stored in basis points.

**Example verified during testing:**

| Description | Amount |
|---|---:|
| Website Design | $500.00 |
| Backend Development | $800.00 |
| Subtotal | $1,300.00 |
| Tax (10%) | $130.00 |
| Final Total | $1,430.00 |

The backend stores the corresponding values as:

- `subtotal_minor = 130000`
- `tax_minor = 13000`
- `total_minor = 143000`

PostgreSQL recalculates the authoritative totals when an estimate is saved.

### 3.4 Frontend Navigation

Authorized users can access the Estimates Module through three navigation paths:

1. **Sidebar → Estimates → Select Account → View Estimates**
2. **Accounts → View Estimates**
3. **Accounts → View Details → View Estimates**

Each account displays only the estimates accessible to the authenticated user.

### 3.5 Security and Permissions

The implementation uses Supabase Authentication, PostgreSQL Row-Level Security (RLS), account membership checks, and finance-specific permissions.

**Account Manager:**
- Create estimates.
- View assigned account estimates.
- Edit drafts.
- Mark drafts as Sent.

**Executive Director / Authorized Approver:**
- View authorized estimates.
- Accept or Reject Sent estimates.

**Unauthorized User:**
- Cannot access estimates without the required account-level financial permissions.

Backend authorization is enforced independently of frontend button visibility.

Financial write operations use PostgreSQL `SECURITY DEFINER` functions rather than direct browser-side table writes.

## 4. Backend API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/accounts/:accountId/estimates` | List estimates |
| POST | `/api/accounts/:accountId/estimates` | Create draft |
| GET | `/api/accounts/:accountId/estimates/:estimateId` | View details |
| PATCH | `/api/accounts/:accountId/estimates/:estimateId` | Edit draft |
| POST | `/api/accounts/:accountId/estimates/:estimateId/transition` | Update lifecycle status |

The APIs validate requests and enforce financial permissions.

Estimate creation also supports an `Idempotency-Key` to prevent duplicate creation when the same request is retried.

## 5. Testing Performed

The following tests were manually performed during development.

| Test Case | Actual Result | Status |
|---|---|---|
| Fetch estimates for an authorized account | HTTP 200 | PASS |
| Create a new estimate | HTTP 201 | PASS |
| Retrieve estimate details | Estimate and line items returned | PASS |
| Verify subtotal, tax, and final total | Calculations matched expected results | PASS |
| Open Estimates frontend | Page and estimates displayed | PASS |
| Create estimate using frontend | Draft created | PASS |
| Open Edit Draft interface | Editor functioning | PASS |
| Change Draft to Sent | Status updated | PASS |
| Accept a Sent estimate | Status updated to Accepted | PASS |
| Reject a separate Sent estimate | Status updated to Rejected | PASS |
| Access estimates as unauthorized user | Access denied | PASS |
| Retry creation with identical idempotency key and body | Same estimate ID returned | PASS |

### 5.1 Unauthorized Access Test

**Test account:** Designer role without Estimates permission.

**Action:** Attempted to access the account's Estimates API.

**Actual response:**

```json
{
  "error": "Not authorized for this account"
}
```

**Result: PASS**

The unauthorized user was unable to retrieve account estimates.

### 5.2 Duplicate Request Test

Two identical POST requests were submitted using the same `Idempotency-Key`.

**Actual results:**

```text
First HTTP Status: 201
Second HTTP Status: 201

First Estimate ID:
47b5b9f6-1ed8-41db-a388-4dba70edf4e6

Second Estimate ID:
47b5b9f6-1ed8-41db-a388-4dba70edf4e6

TEST RESULT: PASS
```

**Result: PASS**

Both requests returned the same estimate ID, confirming that an identical retry did not create a second estimate.

## 6. Remaining Tests Before Final Submission

The following checks still require verification and are not claimed as passed:

| Pending Test | Expected Result |
|---|---|
| Production build | `npm run build` completes |
| Lint validation | `npm run lint` completes or inherited issues are documented |
| Automated money unit tests | All relevant tests pass |
| Cross-account tenant isolation | User cannot access another unauthorized account |
| Idempotency key reused with different payload | HTTP 409 Conflict |
| Editing an already Sent estimate | Request rejected |
| Invalid status transition | Request rejected |
| Account Manager attempting approval | HTTP 403 |
| Full database security smoke tests | Actual results match expected permissions |
| Existing Members and Kanban API errors | Rechecked and resolved or documented |

These checks are important for final production-readiness assessment.

## 7. Project Files

Key implementation files include:

```text
supabase/
  estimates.sql
  estimates-currency-guard.sql

app/
  api/
    accounts/
      [accountId]/
        estimates/
          route.ts
          [estimateId]/
            route.ts
            transition/
              route.ts

  accounts/
    [accountId]/
      estimates/
        page.tsx

components/
  estimates/
    estimates-client.tsx

lib/
  estimates-api.ts
  estimate-money.ts

tests/
  estimates-authorization-smoke.sql

__tests__/
  estimate-money.test.ts

scripts/
  verify-estimates-layout.cjs
```

Additional account and sidebar navigation changes are included in the project source.

## 8. Installation and Execution

**Requirements:**
- Node.js 20.9 or newer
- npm
- Supabase project
- Environment configuration

Install dependencies:

```bash
npm install
```

Configure `.env.local` using the project's environment template.

For a fresh development database, apply the required base schema and Estimates migrations in the order documented in the project.

Start the application:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

Log in with an authorized account and navigate to **Estimates**.

### Verification Commands

```bash
node scripts/verify-estimates-layout.cjs

npm test -- __tests__/estimate-money.test.ts

npm run lint

npm run build
```

Running these commands is part of the remaining final verification.

## 9. Known Limitations

- The current implementation focuses on the Estimates Module rather