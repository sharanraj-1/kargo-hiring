-- Phase 3: candidate processing and scoring.

-- Raw extracted text contains PII; it is only ever read server-side for redaction.
alter table candidate_files add column extracted_text text;
alter table candidate_files add column text_chars int;

-- Why a candidate needs the founder's attention before scoring (e.g. name not found).
alter table candidates add column needs_attention text;
alter table candidates add column recommended_role_id uuid references roles(id);
alter table candidates add column processing_started_at timestamptz;

alter table evaluations add column years_product_experience numeric(4,1);
alter table evaluations add column recommended_role_id uuid references roles(id);
alter table evaluations add column requirement_matches jsonb;
alter table evaluations add column signal_scores jsonb;

create index on candidates (upload_batch_id);
create index on candidates (is_demo) where is_demo;

-- Deletes every DEMO candidate (files are removed from storage by the caller first).
create or replace function delete_demo_candidates()
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count int;
begin
  if not is_founder() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  delete from candidates where is_demo;
  get diagnostics v_count = row_count;
  insert into audit_log (action, entity, details)
  values ('demo_candidates_deleted', 'candidates', jsonb_build_object('count', v_count));
  return v_count;
end;
$$;
revoke execute on function delete_demo_candidates() from public, anon;
grant execute on function delete_demo_candidates() to authenticated;
