-- Phase 2: per-hire AI profiles and richer signal records.

-- Exactly what was sent to the model (after PII + institution redaction), kept for audit.
alter table reference_docs add column redacted_text text;
alter table reference_docs add column redaction_counts jsonb;

-- AI profile of each reference hire, kept separate from the founder's own notes
-- (application_standout / interview_revealed / outcome_note are founder-written only).
alter table reference_hires add column ai_profile jsonb;
alter table reference_hires add column ai_profile_model text;
alter table reference_hires add column ai_profile_prompt_version text;
alter table reference_hires add column ai_profiled_at timestamptz;

-- Signals: which hires lack the signal, why the confidence level was given,
-- and any bias terms found in the signal's wording (flagged for founder review).
alter table success_signals add column counter_examples jsonb not null default '[]';
alter table success_signals add column confidence_rationale text;
alter table success_signals add column bias_flags text[] not null default '{}';

-- Warnings produced during extraction (unverifiable quotes, dropped signals, etc.)
alter table success_patterns add column warnings jsonb not null default '[]';
