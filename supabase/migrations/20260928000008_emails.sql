-- Phase 5: email drafts and sending.

alter table emails add column edited_by_founder boolean not null default false;
alter table emails add column warnings jsonb not null default '[]';
alter table emails add column from_email text;
alter table emails add column decision_id uuid references decisions(id);

-- At most one unsent email per candidate and type.
create unique index one_unsent_email_per_type on emails (candidate_id, type) where status in ('draft', 'failed');

-- The browser (role "authenticated") may create drafts and edit a draft's recipient, subject and
-- body. Only the send-email Edge Function (service role) may change delivery fields, so an email
-- can never be marked sent without actually being sent, and sent emails can't be rewritten.
create or replace function guard_email_changes()
returns trigger
language plpgsql
as $$
begin
  if current_user <> 'authenticated' then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.resend_id is not null or new.sent_at is not null then
      raise exception 'Emails can only be created as drafts';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status not in ('draft', 'failed') then
      raise exception 'Only unsent emails can be discarded';
    end if;
    return old;
  end if;

  if old.status not in ('draft', 'failed') then
    raise exception 'This email has already been sent and cannot be changed';
  end if;
  if new.status is distinct from old.status or new.resend_id is distinct from old.resend_id
     or new.sent_at is distinct from old.sent_at or new.attempts is distinct from old.attempts
     or new.last_error is distinct from old.last_error or new.from_email is distinct from old.from_email then
    raise exception 'Delivery fields can only be changed by sending';
  end if;
  return new;
end;
$$;

create trigger emails_guard
before insert or update or delete on emails
for each row execute function guard_email_changes();
