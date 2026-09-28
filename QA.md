# QA checklist (Section 11)

Status as of 2026-09-28. **Verified** = exercised against the live Supabase project or an in-memory Postgres
running the real migrations. **Built, not verified** = implemented and type-checked, but not yet exercised end to end
(mostly because UI flows need the founder's signed-in session, which the builder never had).

| # | Criterion | Status | Evidence / what remains |
|---|---|---|---|
| 1 | **Problem**: 60 CVs uploaded and ranked in one session | Built, not load-tested | Bulk upload up to 100 files, 3 in parallel; ~30–45 s per CV (scoring + interview brief), so ~60 CVs in 10–15 min. Not run at 60 real CVs; Gemini rate limits for this key are unknown. Failures show Retry and nothing is lost. |
| 2 | **Repeated workflow**: new roles/JDs without code changes | Built, partly verified | Settings → Add role; JD page lists every active role; scoring loops all roles with a saved JD. Tested with PM + SPM; not tested with a third role. |
| 3 | **Input**: mixed formats; unreadable flagged, never guessed | Verified (DOCX, TXT, unreadable); PDF built, not verified | DOCX extraction verified on 8 reference CVs + 2 JDs; unreadable path verified (status Unreadable, 0 evaluations). PDF uses pdf.js in the browser and has not been tried with a real PDF. |
| 4 | **Output**: scores, evidence, brief, probes, draft email per candidate | Verified on DEMO data | DEMO candidates have ATS/Pattern/Overall for both roles, verified quotes, 4-probe interview brief, and invite/rejection drafts (drafts tested, then reset). |
| 5 | **Measurable**: % responded, days waiting, time to decision, override rate | Built, queries verified | Overview KPIs (DEMO excluded) and Decision log override rate. Values are 0 / "—" until real decisions and sends exist. |
| 6 | **Failure risk**: no auto-rejection, no auto-send, evidence required, PII redacted before AI | Verified | No code path sends without a founder click; `send-email` rejects the service key (401); DB trigger blocks the browser from marking emails sent or editing sent emails; unverifiable quotes score 0; redaction tested on 10 CVs (8 reference + 2 DEMO) with zero name/email/phone/college leaks; missing-name CVs are held before any AI call. |
| 7 | **Judgment**: pattern needs approval; decisions are founder-made and logged | Verified | Pattern v1 approved by the founder in the UI (the builder's attempt to approve on their behalf was blocked). Decision RPC tested: override flag, append-only, all-or-nothing bulk. |
| 8 | **ROI**: decide in under 2 minutes from the drawer | Built, not timed | Drawer shows "why this rank" (3 lines), evidence, probes and a sticky decision bar. Needs a real timing check by the founder. |
| 9 | **Owner**: settings + audit log make it operable by a future owner | Built | Settings (weights, thresholds, SLA, roles, sender, templates, danger zone); Decision log + All activity with CSV export; README "Operating it" section. |

## Security checks run

- Anonymous requests: 0 rows from every table, writes rejected by RLS, storage list empty, functions 401, `is_founder()` denied.
- Forged `service_role` JWT (bad signature) rejected by the gateway.
- Public sign-up disabled on the live project (`/auth/v1/settings` → `disable_signup: true`).

## Open items for the founder

1. **Rotate secrets pasted in chat**: service role key (or move to Supabase's new secret keys), Gemini key, Resend key, database password.
2. **Verify a sending domain in Resend** and set the sender address in Settings, then use "Send test email to me". Until then candidates cannot receive email.
3. Set **Opened on** for PM and SPM (Settings → Roles) so "Days roles open" is populated.
4. Optionally add a **scheduling link**.
5. Save **JD v2** without the `product manager` keyword (it gives every PM applicant credit for one must-have).
6. **Delete demo data** before uploading real CVs.
7. The pattern has **3 signals** (target was 5–8), so Pattern scores are coarse; consider adding signals and re-scoring.
8. Supabase project region is **ap-southeast-2 (Sydney)**; confirm this is acceptable for candidate data.
9. The app currently runs locally (`npm run dev`). Hosting it (e.g. Vercel/Netlify + adding its URL to Supabase Auth redirect URLs) is not done.
10. Walk through every screen once while signed in; the builder has not seen the signed-in UI.
