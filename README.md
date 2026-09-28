# Kargo Hiring Dashboard

Internal hiring tool. The system recommends; the founder decides.

Stack: React + TypeScript + Tailwind + shadcn/ui (Vite) · Supabase (Postgres, Auth, Storage, Edge Functions, RLS) · Gemini (server-side) · Resend (server-side).

## Secrets

| Where | File (gitignored) | Contents |
|---|---|---|
| Browser | `.env.local` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` |
| Edge Functions | `supabase/functions/.env` | `GEMINI_API_KEY`, `GEMINI_MODEL`, `RESEND_API_KEY`, `RESEND_FROM` |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected into hosted Edge Functions by Supabase and are not stored in this repo.

## First-time setup

```bash
npm install
npx supabase login
npx supabase link --project-ref tfshyqgblbstcibvrfzl
npx supabase db push
npx supabase secrets set --env-file supabase/functions/.env
npx supabase functions deploy send-test-email
```

Then, in the Supabase dashboard:

1. **Authentication → Sign In / Providers**: turn off "Allow new users to sign up".
2. **Authentication → Users → Add user**: create the founder account.
3. **Authentication → URL Configuration**: add `http://localhost:5173` to the redirect URLs.
4. **SQL editor**: run `supabase/seed/founder.sql` with the founder's login email.

## Run

```bash
npm run dev
```

## Access model

- Public sign-up is disabled; the login screen never creates accounts.
- Every table and both storage buckets (`cvs`, `reference_docs`) are private, and RLS allows access only when `is_founder()` is true (the JWT email is in `founder_allowlist`).
- Edge Functions call `requireFounder()` before doing anything, and only then use the service-role client.
