# Vinculo

Vinculo is a Node.js and Express application backed by PostgreSQL. It serves the student and admin dashboards from `public/` and exposes JSON APIs under `/api`.

## Run locally

1. Install the locked dependencies with `npm ci`.
2. Configure `.env` with `DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY`. `SUPABASE_SECRET_KEY` is required only for the manual account-linking command. `FRONTEND_ORIGINS` is an optional comma-separated list of allowed browser origins; when omitted, only the local server origins for `PORT` are allowed. `YOUTUBE_API_KEY`, `FACEBOOK_PAGE_ACCESS_TOKEN`, and `PORT` are optional settings for their related integrations and server port.
3. Start the app with `npm start`.

The app checks and applies its safe schema updates before it starts listening. It only inserts sample data when it sees a brand-new database with none of the core tables. `npm run db:init` is also available for database setup; it does not drop tables and skips sample data when users, tasks, or task activities already exist.

## Supabase Auth

Login and registration use Supabase Auth. Vinculo keeps its existing `users` rows, roles, points, and foreign keys, and stores the matching Supabase Auth UUID in `users.supabase_user_id`. Existing users must be linked deliberately after their Supabase Auth accounts exist:

```bash
npm run db:link-supabase-users
```

The linking command matches email addresses and never prints or handles passwords. Keep `SUPABASE_SECRET_KEY` server-side and never expose it to browser code.

## Engagement data migration

The manual engagement model can be populated from the legacy `task_activity` table with:

```bash
psql "$DATABASE_URL" -f scripts/migrate_phase1.sql
```

Create a Supabase backup or use a staging database before running it. The migration is non-destructive: it keeps `task_activity`, creates a backup copy named `task_activity_legacy`, and uses `vinculo_migrations` to make repeat runs safe. It does not recreate or drop `manual_audits`, `manual_audit_history`, or any other production table. Review the resulting engagement and activity counts before switching production traffic.

## Debug common failures

- **The server exits before listening:** check that `DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY` are valid and reachable. Startup logs identify schema or connection failures; the app exits instead of serving requests with an incomplete schema.
- **An API request returns an error:** inspect the server terminal for the matching request and server-side error log. API responses intentionally omit database messages, SQL, and internal codes.
- **Comment verification is unavailable:** YouTube and Facebook use their configured APIs. Instagram comment verification is unsupported; it does not award a bonus. Missing API credentials are reported as configuration errors in the student flow and server logs.
- **Check JavaScript syntax:** run `node --check` on the changed server or route file, for example `node --check routes/student.js`.
- **Check runtime dependencies:** run `npm audit --omit=dev --audit-level=moderate`.

## Integration tests

The PostgreSQL-backed integration test uses a disposable local database and refuses non-local targets:

```bash
createdb vinculo_integration_test
TEST_DATABASE_URL=postgresql:///vinculo_integration_test npm test
dropdb vinculo_integration_test
```

The test covers route protection, authentication, task creation, task opening and completion, manual-audit submission, admin approval, points, and audit history. It does not use the production `DATABASE_URL`.

The authenticated test requires a disposable Supabase Auth project and `TEST_SUPABASE_AUTH=1`; it is skipped when those test credentials are not configured. The health and schema checks still run when the application starts locally.
