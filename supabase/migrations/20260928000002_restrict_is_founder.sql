-- Supabase's default privileges grant EXECUTE on public functions to anon.
-- is_founder() is only needed by signed-in users (all RLS policies target `authenticated`).
revoke execute on function is_founder() from anon;
