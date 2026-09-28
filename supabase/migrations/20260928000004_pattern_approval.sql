-- Approval gate for success patterns.
-- Approving a draft supersedes the currently approved version in one transaction.
-- Only the founder can call it; approved/superseded versions are locked from edits.

create or replace function approve_pattern(p_pattern_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status pattern_status;
  v_signals int;
begin
  if not is_founder() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select status into v_status from success_patterns where id = p_pattern_id for update;
  if v_status is null then raise exception 'Pattern not found'; end if;
  if v_status <> 'draft' then raise exception 'Only a draft can be approved'; end if;

  select count(*) into v_signals from success_signals where pattern_id = p_pattern_id;
  if v_signals = 0 then raise exception 'A pattern needs at least one signal'; end if;

  update success_patterns set status = 'superseded' where status = 'approved';
  update success_patterns
     set status = 'approved', approved_at = now(), approved_by = auth.uid()
   where id = p_pattern_id;

  insert into audit_log (action, entity, entity_id, details)
  values ('success_pattern_approved', 'success_patterns', p_pattern_id,
          jsonb_build_object('signals', v_signals,
                             'version', (select version from success_patterns where id = p_pattern_id)));
end;
$$;
revoke execute on function approve_pattern(uuid) from public, anon;
grant execute on function approve_pattern(uuid) to authenticated;

-- Copy any pattern (e.g. the approved one) into a new editable draft.
create or replace function clone_pattern_as_draft(p_pattern_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_new uuid;
  v_version int;
begin
  if not is_founder() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  select coalesce(max(version), 0) + 1 into v_version from success_patterns;

  insert into success_patterns (version, status, sample_size, reference_hire_ids, model, prompt_version,
                                raw_output, generated_at, notes, warnings)
  select v_version, 'draft', sample_size, reference_hire_ids, model, prompt_version,
         raw_output, generated_at, notes, warnings
    from success_patterns where id = p_pattern_id
  returning id into v_new;
  if v_new is null then raise exception 'Pattern not found'; end if;

  insert into success_signals (pattern_id, name, description, observable_evidence, reference_quotes,
                               counter_examples, confidence, confidence_rationale, bias_flags, origin,
                               edited_by_founder, sort_order)
  select v_new, name, description, observable_evidence, reference_quotes, counter_examples, confidence,
         confidence_rationale, bias_flags, origin, edited_by_founder, sort_order
    from success_signals where pattern_id = p_pattern_id;

  insert into audit_log (action, entity, entity_id, details)
  values ('success_pattern_cloned', 'success_patterns', v_new,
          jsonb_build_object('from', p_pattern_id, 'version', v_version));
  return v_new;
end;
$$;
revoke execute on function clone_pattern_as_draft(uuid) from public, anon;
grant execute on function clone_pattern_as_draft(uuid) to authenticated;

-- Signals of a non-draft pattern are read-only (the record of what scored candidates).
create or replace function lock_non_draft_signals()
returns trigger
language plpgsql
as $$
declare
  v_status pattern_status;
begin
  select status into v_status from success_patterns
   where id = coalesce(new.pattern_id, old.pattern_id);
  if v_status is distinct from 'draft' then
    raise exception 'Signals of an approved or superseded pattern cannot be changed. Create a new draft instead.';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger success_signals_lock
before insert or update or delete on success_signals
for each row execute function lock_non_draft_signals();
