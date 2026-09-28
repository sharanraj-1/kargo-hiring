-- Phase 4: founder decisions.
-- The AI recommendation is derived from the tier of the current evaluation for the applied role:
--   strong_fit -> move_forward, consider -> hold, below_threshold -> pass.
-- A decision is an override when it differs from that recommendation.
-- Decisions are append-only; the latest one sets the candidate's decision_status.

create or replace function ai_recommendation_for(p_tier fit_tier)
returns decision_status
language sql
immutable
as $$
  select case p_tier
    when 'strong_fit' then 'move_forward'::decision_status
    when 'consider' then 'hold'::decision_status
    when 'below_threshold' then 'pass'::decision_status
  end;
$$;

create or replace function record_decision(p_candidate_id uuid, p_decision decision_status, p_reason text default null)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_eval evaluations%rowtype;
  v_rec decision_status;
  v_id uuid;
begin
  if not is_founder() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if p_decision = 'awaiting' then
    raise exception 'Choose Move forward, Hold or Pass';
  end if;

  select e.* into v_eval
    from evaluations e join candidates c on c.id = e.candidate_id
   where e.candidate_id = p_candidate_id and e.role_id = c.applied_role_id and e.is_current;
  if not found then
    raise exception 'This candidate has not been scored yet';
  end if;
  v_rec := ai_recommendation_for(v_eval.tier);

  insert into decisions (candidate_id, evaluation_id, decision, ai_recommendation, ai_tier, is_override, reason)
  values (p_candidate_id, v_eval.id, p_decision, v_rec::text, v_eval.tier, p_decision is distinct from v_rec,
          nullif(trim(p_reason), ''))
  returning id into v_id;

  update candidates set decision_status = p_decision, decided_at = now() where id = p_candidate_id;

  insert into audit_log (action, entity, entity_id, details)
  values ('decision_recorded', 'candidates', p_candidate_id,
          jsonb_build_object('decision', p_decision, 'ai_recommendation', v_rec, 'tier', v_eval.tier,
                             'override', p_decision is distinct from v_rec, 'overall', v_eval.overall_score,
                             'reason', nullif(trim(p_reason), '')));
  return v_id;
end;
$$;
revoke execute on function record_decision(uuid, decision_status, text) from public, anon;
grant execute on function record_decision(uuid, decision_status, text) to authenticated;

-- Bulk version for "Confirm Pass for selected". All-or-nothing.
create or replace function record_decisions_bulk(p_candidate_ids uuid[], p_decision decision_status, p_reason text default null)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_n int := 0;
begin
  foreach v_id in array p_candidate_ids loop
    perform record_decision(v_id, p_decision, p_reason);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke execute on function record_decisions_bulk(uuid[], decision_status, text) from public, anon;
grant execute on function record_decisions_bulk(uuid[], decision_status, text) to authenticated;
