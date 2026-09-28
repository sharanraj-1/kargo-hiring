-- Phase 6: settings and instant re-ranking.

-- 'ai' = Gemini drafts, checked against the rules, template as fallback. 'template' = always the template.
alter table settings add column email_drafting text not null default 'ai' check (email_drafting in ('ai', 'template'));

-- Editable templates live in the database (Settings screen). Seed the defaults once.
update settings set templates = jsonb_build_object(
  'invite', jsonb_build_object(
    'subject', 'Interview for the {{role}} role at Kargo',
    'body', E'Hi {{first_name}},\n\nThank you for applying for the {{role}} role at Kargo. I read your application and would like to talk.\n\nPlease pick a time that suits you here: {{scheduling_link}}\n\nLooking forward to it.'),
  'rejection', jsonb_build_object(
    'subject', 'Your application for {{role}} at Kargo',
    'body', E'Hi {{first_name}},\n\nThank you for applying for the {{role}} role at Kargo, and for the time you put into it.\n\nAfter reviewing your application carefully, we won''t be moving forward with it. This was a considered decision, and I''m grateful you thought of Kargo.\n\nI wish you the very best with your search.'),
  'acknowledgement', jsonb_build_object(
    'subject', 'We received your application for {{role}}',
    'body', E'Hi {{first_name}},\n\nThank you for applying for the {{role}} role at Kargo. I''ve received your application and will get back to you personally.')
) where id = 1 and templates = '{}'::jsonb;

-- Recompute overall scores, tiers and recommended roles from the stored ATS and Pattern scores
-- using the current settings. No model calls: used when weights or thresholds change.
create or replace function recompute_scores()
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  s settings%rowtype;
  n int;
begin
  if not is_founder() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  select * into s from settings where id = 1;

  update evaluations e set
    overall_score = round(e.ats_score * s.ats_weight + e.pattern_score * s.pattern_weight, 1),
    tier = case
      when round(e.ats_score * s.ats_weight + e.pattern_score * s.pattern_weight, 1) >= s.strong_threshold then 'strong_fit'::fit_tier
      when round(e.ats_score * s.ats_weight + e.pattern_score * s.pattern_weight, 1) >= s.consider_threshold then 'consider'::fit_tier
      else 'below_threshold'::fit_tier
    end,
    weights_used = jsonb_build_object(
      'ats_weight', s.ats_weight, 'pattern_weight', s.pattern_weight,
      'strong_threshold', s.strong_threshold, 'consider_threshold', s.consider_threshold,
      'recommend_role_delta', s.recommend_role_delta, 'recomputed_at', now())
  where e.is_current and e.ats_score is not null and e.pattern_score is not null;
  get diagnostics n = row_count;

  with applied as (
    select c.id as cid, c.applied_role_id, e.overall_score
      from candidates c
      join evaluations e on e.candidate_id = c.id and e.role_id = c.applied_role_id and e.is_current
  ), best as (
    select distinct on (e.candidate_id) e.candidate_id, e.role_id, e.overall_score
      from evaluations e where e.is_current
     order by e.candidate_id, e.overall_score desc
  )
  update candidates c
     set recommended_role_id = case when b.overall_score - a.overall_score >= s.recommend_role_delta then b.role_id else a.applied_role_id end
    from applied a join best b on b.candidate_id = a.cid
   where c.id = a.cid;

  update evaluations e set recommended_role_id = c.recommended_role_id
    from candidates c
   where e.candidate_id = c.id and e.role_id = c.applied_role_id and e.is_current;

  insert into audit_log (action, entity, details)
  values ('scores_recomputed', 'evaluations', jsonb_build_object(
    'evaluations', n, 'ats_weight', s.ats_weight, 'pattern_weight', s.pattern_weight,
    'strong_threshold', s.strong_threshold, 'consider_threshold', s.consider_threshold));
  return n;
end;
$$;
revoke execute on function recompute_scores() from public, anon;
grant execute on function recompute_scores() to authenticated;
