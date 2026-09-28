-- Grants dashboard access to the founder's login email.
-- Run once in the Supabase SQL editor after the migration, replacing the placeholder.
-- The email must be lower-case and match the Supabase Auth user exactly.
insert into founder_allowlist (email) values ('<founder-login-email>')
on conflict do nothing;
