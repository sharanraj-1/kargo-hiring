# Kargo Hiring Dashboard

Internal hiring tool for Kargo's PM and SPM roles. **The system recommends; the founder decides.**
Candidates are ranked against the job description (ATS score) and against a success pattern learned
from Kargo's own past hires (Pattern score). Every judgement is backed by a verbatim quote from the CV,
personal data is removed before any AI step, and nothing is rejected or emailed without an explicit founder click.

Stack: React + TypeScript + Tailwind + shadcn/ui (Vite) · Supabase (Postgres, Auth, Storage, Edge Functions, RLS) ·
Google Gemini (server-side, structured JSON, validated with Zod) · Resend (server-side).

## How it works

1. **Job descriptions** → Gemini extracts must-haves, nice-to-haves, years and responsibilities, each with a JD quote.
   Location / work-mode lines are kept as "not scored". The founder edits and **saves**; saved versions are locked.
2. **Reference hires** → past hires' CVs are redacted and profiled; Gemini contrasts positive vs neutral/negative
   hires to propose Success Signals. The founder edits and **approves** the pattern; approved versions are locked.
3. **Candidates** → CVs are uploaded in bulk, text is extracted in the browser (PDF, DOCX, TXT; under 300 characters =
   unreadable, never scored), PII is detected deterministically and stored in `candidate_pii`, and two redacted copies
   are made (ATS: no PII; Pattern: no PII and no institutions). Gemini returns structure, requirement matches,
   quantified bullets, signal scores (0–3), strengths and gaps, all with quotes that are verified word-for-word.
   **All scores are computed in code** (`supabase/functions/_shared/scoring.ts`) for every role.
4. **Decisions** → the founder chooses Move forward / Hold / Pass in the candidate drawer (or bulk Pass on
   Review Below Threshold). Each decision records the AI recommendation and whether it was an override.
5. **Email** → a draft (invite or rejection) is generated after the decision, checked against the content rules,
   and waits in the Outbox. It is sent through Resend only when the founder clicks Send.

## Scoring

| Component | Max | Method |
|---|---|---|
| Parsability & structure | 15 | Sections present (10) + share of roles with consistent dates (5) |
| Keyword & skill match | 30 | Per requirement: keyword hit = 1, else verified AI match (met 1 / partial 0.5). Must-haves 70%, nice-to-haves 30% |
| Experience & level fit | 25 | Years in product-titled roles (from dates, overlaps merged) vs JD range |
| Quantified impact | 20 | Verified bullets with measurable outcomes; 5+ = full marks |
| Clarity & completeness | 10 | Email, phone, length, bullets, dated roles |

Pattern = Σ signal scores ÷ (3 × signals) × 100. Overall = ATS × weight + Pattern × (1 − weight) (default 40/60).
Tiers: Strong Fit ≥ 75, Consider 55–74, Below Threshold < 55. A different role is recommended when it scores
10+ points higher. Weights and thresholds are editable in Settings; saving re-ranks everyone instantly from stored
scores (`recompute_scores()`), without new AI calls.

## Guardrails (and where they are enforced)

| Guardrail | Enforcement |
|---|---|
| Founder-only access | Sign-ups disabled; `founder_allowlist` + `is_founder()` in RLS on every table and both storage buckets |
| PII never reaches the model | `_shared/pii.ts` + `_shared/redact.ts`; if the name can't be found the CV is held and nothing is sent |
| Evidence required | `quoteIsVerbatim()` on every quote; unverifiable evidence scores 0 / "Not evidenced" |
| Pattern approval gate | Scoring refuses to run without an approved pattern; approved/superseded signals are locked by trigger |
| No auto-rejection / auto-send | Decisions only via `record_decision` RPC; `send-email` accepts only a founder session; DB trigger stops the browser marking emails sent |
| Bias check | Reasoning scanned for college / prestige / location / age / gender terms and flagged; biased interview probes dropped |
| Audit | `audit_log` (append-only from the browser) for every upload, AI run, approval, edit, decision and send |

## Secrets

| Where | File (gitignored) | Contents |
|---|---|---|
| Browser | `.env.local` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` |
| Edge Functions | `supabase/functions/.env` → `npx supabase secrets set` | `GEMINI_API_KEY`, `GEMINI_MODEL`, `RESEND_API_KEY`, optional `RESEND_FROM` |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected into Edge Functions by Supabase.
The sender address in **Settings** takes precedence over `RESEND_FROM`.

## Setup and deploy

```bash
npm install
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
npx supabase secrets set --env-file supabase/functions/.env
npx supabase functions deploy --use-api
```

Then: disable sign-ups (Auth → Providers), create the founder user, and insert their email into
`founder_allowlist` (`supabase/seed/founder.sql`). Run locally with `npm run dev` (http://localhost:5173).

## Operating it (for a future owner)

- **Add a role**: Settings → Roles → Add role, then add its JD on Job descriptions. No code changes.
- **Change a JD or the pattern**: "Edit as new version", then save/approve. Existing evaluations keep the version they used; re-score to apply the new one.
- **Change weights/thresholds**: Settings → Scoring. Re-ranks immediately.
- **Re-score everyone** (after a new JD or pattern): Settings → Danger zone → Re-score all (about 3 Gemini calls per CV).
- **Email sender**: verify a domain in Resend, set the sender address in Settings, then "Send test email to me".
- **Audit**: Decision log → Decisions (with override rate) and All activity; both export to CSV.
- **Demo data**: anything marked DEMO is excluded from metrics, can never be emailed, and is removed in one click.

Scripts in `scripts/` bulk-import reference CVs and JDs from a local folder using the service role key (never commit it).
