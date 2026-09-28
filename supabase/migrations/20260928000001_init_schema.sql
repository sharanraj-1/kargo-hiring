-- Kargo Hiring Dashboard: initial schema
-- Principle: the system recommends, the founder decides.
-- Every table is readable/writable only by the founder account (see is_founder()).
-- Edge Functions use the service role, which bypasses RLS, and must re-check is_founder
-- for the calling user before acting.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type performance_rating as enum ('exceeds', 'meets', 'below');
create type tenure_status     as enum ('yes', 'no_left', 'no_let_go');
create type reference_type    as enum ('positive', 'neutral', 'negative', 'unclassified');
create type pattern_status    as enum ('draft', 'approved', 'superseded');
create type confidence_level  as enum ('high', 'medium', 'low');
create type jd_status         as enum ('draft', 'saved');
create type requirement_kind  as enum ('must_have', 'nice_to_have', 'responsibility');
create type candidate_status  as enum ('uploaded', 'parsed', 'scored', 'unreadable', 'error');
create type decision_status   as enum ('awaiting', 'move_forward', 'hold', 'pass');
create type fit_tier          as enum ('strong_fit', 'consider', 'below_threshold');
create type email_type        as enum ('invite', 'rejection', 'acknowledgement');
create type email_status      as enum ('draft', 'sending', 'sent', 'failed');

-- ---------------------------------------------------------------------------
-- Access control: a single founder account
-- ---------------------------------------------------------------------------
-- The founder's login email is inserted here (see supabase/seed/founder.sql).
-- Public sign-ups are disabled in Auth settings; this table is the second lock.
create table founder_allowlist (
  email      text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);
alter table founder_allowlist enable row level security;
-- No policies: not readable or writable from the browser at all.

create or replace function is_founder()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from founder_allowlist
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function is_founder() from public;
grant execute on function is_founder() to authenticated;

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Roles (PM, SPM, and any added later without code changes)
-- ---------------------------------------------------------------------------
create table roles (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Z0-9_]{2,16}$'),
  title       text not null,
  opened_on   date,              -- set by the founder; used for "days roles have been open"
  is_active   boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Job descriptions + extracted requirements
-- ---------------------------------------------------------------------------
create table job_descriptions (
  id                    uuid primary key default gen_random_uuid(),
  role_id               uuid not null references roles(id) on delete cascade,
  version               int not null default 1,
  status                jd_status not null default 'draft',
  source_text           text,
  source_file_path      text,          -- optional uploaded JD file in storage
  years_required_min    numeric(4,1),  -- founder-editable
  years_required_max    numeric(4,1),
  extraction_raw        jsonb,         -- raw model output, for audit
  extraction_model      text,
  extraction_prompt_ver text,
  extracted_at          timestamptz,
  saved_at              timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (role_id, version)
);

create table jd_requirements (
  id          uuid primary key default gen_random_uuid(),
  jd_id       uuid not null references job_descriptions(id) on delete cascade,
  kind        requirement_kind not null,
  text        text not null,
  synonyms    text[] not null default '{}',
  source_quote text,                 -- verbatim JD text the requirement came from
  origin      text not null default 'ai' check (origin in ('ai', 'founder')),
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);
create index on jd_requirements (jd_id);

-- ---------------------------------------------------------------------------
-- Reference hires (calibration library)
-- ---------------------------------------------------------------------------
create table reference_hires (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  role_title            text not null,
  joined_on             date,           -- month precision; stored as first day of month
  last_rating           performance_rating,
  still_at_kargo        tenure_status,  -- null until the founder fills it in
  is_product_role       boolean not null default false, -- weighted higher for PM/SPM pattern
  application_standout  text,
  interview_revealed    text,
  outcome_note          text,
  reference_type        reference_type generated always as (
    case
      when last_rating is null or still_at_kargo is null then 'unclassified'::reference_type
      when last_rating = 'below' or still_at_kargo <> 'yes' then 'negative'::reference_type
      when last_rating = 'exceeds' then 'positive'::reference_type
      else 'neutral'::reference_type
    end
  ) stored,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table reference_docs (
  id                 uuid primary key default gen_random_uuid(),
  reference_hire_id  uuid not null references reference_hires(id) on delete cascade,
  storage_path       text not null,
  file_name          text not null,
  mime_type          text,
  size_bytes         bigint,
  extracted_text     text,
  text_chars         int,
  is_readable        boolean,
  created_at         timestamptz not null default now()
);
create index on reference_docs (reference_hire_id);

-- ---------------------------------------------------------------------------
-- Success pattern (versioned, founder-approved)
-- ---------------------------------------------------------------------------
create table success_patterns (
  id              uuid primary key default gen_random_uuid(),
  version         int not null unique,
  status          pattern_status not null default 'draft',
  sample_size     int not null default 0,
  reference_hire_ids uuid[] not null default '{}',
  model           text,
  prompt_version  text,
  raw_output      jsonb,
  generated_at    timestamptz,
  approved_at     timestamptz,
  approved_by     uuid references auth.users(id),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- At most one approved pattern at a time.
create unique index one_approved_pattern on success_patterns ((status)) where status = 'approved';

create table success_signals (
  id                  uuid primary key default gen_random_uuid(),
  pattern_id          uuid not null references success_patterns(id) on delete cascade,
  name                text not null,
  description         text not null,
  observable_evidence text not null,  -- what in a CV would indicate this signal
  reference_quotes    jsonb not null default '[]', -- [{reference_hire_id, quote}]
  confidence          confidence_level not null default 'medium',
  origin              text not null default 'ai' check (origin in ('ai', 'founder')),
  edited_by_founder   boolean not null default false,
  sort_order          int not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index on success_signals (pattern_id);

-- ---------------------------------------------------------------------------
-- Candidates
-- ---------------------------------------------------------------------------
create table candidates (
  id                 uuid primary key default gen_random_uuid(),
  applied_role_id    uuid not null references roles(id),
  status             candidate_status not null default 'uploaded',
  decision_status    decision_status not null default 'awaiting',
  is_priority        boolean not null default false,
  is_demo            boolean not null default false,
  upload_batch_id    uuid,
  display_label      text,           -- e.g. first name + initial; full PII lives in candidate_pii
  structured_cv      jsonb,          -- redacted structure: summary, experience, education, skills, certs
  redacted_text      text,           -- PII-redacted text sent to the model for ATS scoring
  pattern_text       text,           -- additionally strips college/school names for Pattern Match
  text_chars         int,
  error_message      text,
  applied_on         date,           -- when the candidate applied (defaults to upload date)
  uploaded_at        timestamptz not null default now(),
  parsed_at          timestamptz,
  scored_at          timestamptz,
  first_responded_at timestamptz,    -- first email actually sent to the candidate
  decided_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index on candidates (applied_role_id);
create index on candidates (status);
create index on candidates (decision_status);

create table candidate_files (
  id            uuid primary key default gen_random_uuid(),
  candidate_id  uuid not null references candidates(id) on delete cascade,
  storage_path  text not null,
  file_name     text not null,
  mime_type     text,
  size_bytes    bigint,
  created_at    timestamptz not null default now()
);
create index on candidate_files (candidate_id);

-- Restricted: displayed to the founder only. Never sent to the model.
create table candidate_pii (
  candidate_id  uuid primary key references candidates(id) on delete cascade,
  full_name     text,
  email         text,
  phone         text,
  location      text,
  profile_urls  text[] not null default '{}',
  other         jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Evaluations (per candidate per role) + evidence
-- ---------------------------------------------------------------------------
create table evaluations (
  id                 uuid primary key default gen_random_uuid(),
  candidate_id       uuid not null references candidates(id) on delete cascade,
  role_id            uuid not null references roles(id),
  jd_id              uuid references job_descriptions(id),
  pattern_id         uuid references success_patterns(id),
  is_current         boolean not null default true,
  ats_score          numeric(5,2),
  ats_breakdown      jsonb,   -- per component: score, max, explanation
  pattern_score      numeric(5,2),
  overall_score      numeric(5,2),
  tier               fit_tier,
  summary            text,    -- "Why this rank"
  strengths          jsonb,   -- [{text, quote}]
  gaps               jsonb,   -- [{text, quote}]
  red_flags          jsonb,   -- must-have gaps etc. Never auto-rejections.
  interview_brief    jsonb,   -- [{question, targets}]
  bias_flags         jsonb,   -- reasoning that mentions college, prestige, location, age, gender
  weights_used       jsonb,   -- snapshot of settings at scoring time
  model              text not null,
  prompt_version     text not null,
  raw_output         jsonb,
  created_at         timestamptz not null default now()
);
create index on evaluations (candidate_id);
create unique index one_current_eval_per_role on evaluations (candidate_id, role_id) where is_current;

create table evaluation_evidence (
  id              uuid primary key default gen_random_uuid(),
  evaluation_id   uuid not null references evaluations(id) on delete cascade,
  kind            text not null check (kind in
                    ('ats_component', 'keyword', 'impact_bullet', 'signal', 'strength', 'gap')),
  ref_key         text,        -- component name, requirement id, or signal id
  score           numeric(5,2),
  max_score       numeric(5,2),
  quote           text,        -- verbatim from the CV, or null => "Not evidenced"
  quote_verified  boolean,     -- quote found verbatim in the source text
  explanation     text,
  created_at      timestamptz not null default now()
);
create index on evaluation_evidence (evaluation_id);

-- ---------------------------------------------------------------------------
-- Decisions (founder-made, logged)
-- ---------------------------------------------------------------------------
create table decisions (
  id                 uuid primary key default gen_random_uuid(),
  candidate_id       uuid not null references candidates(id) on delete cascade,
  evaluation_id      uuid references evaluations(id),
  decision           decision_status not null check (decision <> 'awaiting'),
  ai_recommendation  text,     -- e.g. 'move_forward' for strong_fit
  ai_tier            fit_tier,
  is_override        boolean not null default false,
  reason             text,
  decided_by         uuid references auth.users(id) default auth.uid(),
  decided_at         timestamptz not null default now()
);
create index on decisions (candidate_id);
create index on decisions (decided_at);

-- ---------------------------------------------------------------------------
-- Emails (drafts are generated; sending needs an explicit founder click)
-- ---------------------------------------------------------------------------
create table emails (
  id             uuid primary key default gen_random_uuid(),
  candidate_id   uuid not null references candidates(id) on delete cascade,
  type           email_type not null,
  status         email_status not null default 'draft',
  to_email       text,
  subject        text not null,
  body           text not null,
  resend_id      text,
  last_error     text,
  attempts       int not null default 0,
  generated_by   text,         -- model name or 'template'
  sent_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on emails (candidate_id);
create index on emails (status);

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
create table audit_log (
  id          bigint generated always as identity primary key,
  actor       uuid default auth.uid(),
  action      text not null,
  entity      text not null,
  entity_id   uuid,
  details     jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index on audit_log (created_at);

-- ---------------------------------------------------------------------------
-- Settings (single row)
-- ---------------------------------------------------------------------------
create table settings (
  id                    int primary key default 1 check (id = 1),
  ats_weight            numeric(4,3) not null default 0.4,
  pattern_weight        numeric(4,3) not null default 0.6,
  strong_threshold      numeric(5,2) not null default 75,
  consider_threshold    numeric(5,2) not null default 55,
  recommend_role_delta  numeric(5,2) not null default 10,
  response_sla_days     int not null default 7,
  founder_name          text,
  founder_title         text,
  sender_name           text,
  sender_email          text,
  signature             text,
  scheduling_link       text,
  keep_cv_on_file       boolean not null default false,
  templates             jsonb not null default '{}',
  updated_at            timestamptz not null default now(),
  constraint weights_sum_to_one check (abs(ats_weight + pattern_weight - 1) < 0.001),
  constraint thresholds_ordered check (consider_threshold < strong_threshold)
);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'roles', 'job_descriptions', 'reference_hires', 'success_patterns', 'success_signals',
    'candidates', 'candidate_pii', 'emails', 'settings'
  ] loop
    execute format(
      'create trigger %I_updated_at before update on %I for each row execute function set_updated_at()',
      t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security: founder only, on every table
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'roles', 'job_descriptions', 'jd_requirements', 'reference_hires', 'reference_docs',
    'success_patterns', 'success_signals', 'candidates', 'candidate_files', 'candidate_pii',
    'evaluations', 'evaluation_evidence', 'decisions', 'emails', 'audit_log', 'settings'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy founder_all on %I for all to authenticated using (is_founder()) with check (is_founder())',
      t);
  end loop;
end $$;

-- The audit log is append-only from the browser.
drop policy founder_all on audit_log;
create policy founder_read on audit_log for select to authenticated using (is_founder());
create policy founder_insert on audit_log for insert to authenticated with check (is_founder());

-- Decisions are append-only from the browser (a new decision supersedes an old one).
drop policy founder_all on decisions;
create policy founder_read on decisions for select to authenticated using (is_founder());
create policy founder_insert on decisions for insert to authenticated with check (is_founder());

-- ---------------------------------------------------------------------------
-- Storage: private buckets, founder only
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('cvs', 'cvs', false, 10485760, array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]),
  ('reference_docs', 'reference_docs', false, 10485760, array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ])
on conflict (id) do nothing;

create policy founder_select_files on storage.objects for select to authenticated
  using (bucket_id in ('cvs', 'reference_docs') and is_founder());
create policy founder_insert_files on storage.objects for insert to authenticated
  with check (bucket_id in ('cvs', 'reference_docs') and is_founder());
create policy founder_update_files on storage.objects for update to authenticated
  using (bucket_id in ('cvs', 'reference_docs') and is_founder());
create policy founder_delete_files on storage.objects for delete to authenticated
  using (bucket_id in ('cvs', 'reference_docs') and is_founder());

-- ---------------------------------------------------------------------------
-- Seed data the brief asks for (real, not demo)
-- ---------------------------------------------------------------------------
insert into roles (code, title, sort_order) values
  ('PM',  'Product Manager',        1),
  ('SPM', 'Senior Product Manager', 2);

insert into settings (id) values (1);

-- Reference hires: names, roles, join months and ratings only, as provided.
-- "Still at Kargo" and the narrative fields are left for the founder to fill in,
-- so each hire stays 'unclassified' until then.
insert into reference_hires (name, role_title, joined_on, last_rating, is_product_role) values
  ('Rohan Desai',          'Head of Engineering',      '2022-07-01', 'exceeds', false),
  ('Sunita Krishnamurthy', 'Operations Lead',          '2023-01-01', 'exceeds', false),
  ('Vikram Nair',          'Product Manager',          '2023-06-01', 'meets',   true),
  ('Aditya Shetty',        'Sales Lead',               '2023-08-01', 'exceeds', false),
  ('Preetham Rao',         'Backend Engineer',         '2024-02-01', 'below',   false),
  ('Meghna Tiwari',        'Customer Success Manager', '2024-08-01', 'exceeds', false),
  ('Lavanya Iyer',         'Product Manager',          '2025-04-01', 'exceeds', true),
  ('Rahul Bose',           'Growth & Marketing Lead',  '2025-06-01', 'meets',   false);
