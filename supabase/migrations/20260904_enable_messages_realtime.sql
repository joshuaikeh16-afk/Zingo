-- Deliver new chat messages over Supabase Realtime instead of requiring an
-- inbox/page refresh. Safe to run repeatedly: the table may already be in
-- the publication on older projects.
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception
  when duplicate_object then null;
end;
$$;codex
