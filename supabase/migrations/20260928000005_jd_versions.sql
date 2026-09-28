-- Job descriptions: "not scored" requirements, keywords, and version locking.

-- Requirements kept for the founder's reference but never used in scoring
-- (e.g. location / relocation / work mode: location is excluded from scoring by policy).
alter type requirement_kind add value if not exists 'not_scored';

alter table jd_requirements add column note text;           -- e.g. why it's not scored, or a borderline call
alter table jd_requirements add column quote_verified boolean;
alter table job_descriptions add column source_file_name text;
alter table job_descriptions add column warnings jsonb not null default '[]';

-- A saved JD is the record of what candidates were scored against: lock it.
create or replace function lock_saved_jd()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'saved' then
    raise exception 'A saved job description cannot be changed. Create a new version instead.';
  end if;
  return new;
end;
$$;
create trigger job_descriptions_lock
before update on job_descriptions
for each row execute function lock_saved_jd();

create or replace function lock_saved_jd_requirements()
returns trigger
language plpgsql
as $$
declare
  v_status jd_status;
begin
  select status into v_status from job_descriptions where id = coalesce(new.jd_id, old.jd_id);
  if v_status = 'saved' then
    raise exception 'Requirements of a saved job description cannot be changed. Create a new version instead.';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger jd_requirements_lock
before insert or update or delete on jd_requirements
for each row execute function lock_saved_jd_requirements();

-- Save = the founder's sign-off that scoring may use this version.
create or replace function save_job_description(p_jd_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_musts int;
begin
  if not is_founder() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  select count(*) into v_musts from jd_requirements where jd_id = p_jd_id and kind = 'must_have';
  if v_musts = 0 then raise exception 'Add at least one must-have before saving'; end if;
  if (select years_required_min from job_descriptions where id = p_jd_id) is null then
    raise exception 'Set the years of experience required before saving';
  end if;

  update job_descriptions set status = 'saved', saved_at = now() where id = p_jd_id and status = 'draft';
  if not found then raise exception 'Only a draft can be saved'; end if;

  insert into audit_log (action, entity, entity_id, details)
  values ('job_description_saved', 'job_descriptions', p_jd_id,
          jsonb_build_object('version', (select version from job_descriptions where id = p_jd_id)));
end;
$$;
revoke execute on function save_job_description(uuid) from public, anon;
grant execute on function save_job_description(uuid) to authenticated;

-- Copy a saved JD into a new editable draft version.
create or replace function clone_jd_as_draft(p_jd_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_new uuid;
begin
  if not is_founder() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  insert into job_descriptions (role_id, version, status, source_text, source_file_name, source_file_path,
                                years_required_min, years_required_max, extraction_raw, extraction_model,
                                extraction_prompt_ver, extracted_at, warnings)
  select role_id, (select max(version) + 1 from job_descriptions j2 where j2.role_id = j.role_id), 'draft',
         source_text, source_file_name, source_file_path, years_required_min, years_required_max,
         extraction_raw, extraction_model, extraction_prompt_ver, extracted_at, warnings
    from job_descriptions j where id = p_jd_id
  returning id into v_new;
  if v_new is null then raise exception 'Job description not found'; end if;

  insert into jd_requirements (jd_id, kind, text, synonyms, source_quote, origin, sort_order, note, quote_verified)
  select v_new, kind, text, synonyms, source_quote, origin, sort_order, note, quote_verified
    from jd_requirements where jd_id = p_jd_id;

  insert into audit_log (action, entity, entity_id, details)
  values ('job_description_cloned', 'job_descriptions', v_new, jsonb_build_object('from', p_jd_id));
  return v_new;
end;
$$;
revoke execute on function clone_jd_as_draft(uuid) from public, anon;
grant execute on function clone_jd_as_draft(uuid) to authenticated;
