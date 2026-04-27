-- ════════════════════════════════════════════════════════════════════════════
-- Migration 026 — Fix infinite-recursion on league_members RLS (Chunk F audit)
-- ════════════════════════════════════════════════════════════════════════════
-- The previous policy queried league_members from within league_members,
-- which Postgres flags as infinite recursion. Symptom: fetchUserLeagues()
-- always errored — users saw "Create league / Join with code" empty state
-- even when they belonged to leagues.
--
-- Fix: extract the "is this user in this league?" check into a SECURITY
-- DEFINER function that bypasses RLS, then use it in the policy.
--
-- APPLIED VIA SUPABASE MCP on 2026-04-27.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.is_league_member(p_league_id int)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1 from league_members
    where league_id = p_league_id and user_id = auth.uid()
  );
$$;

revoke execute on function public.is_league_member(int) from public;
grant  execute on function public.is_league_member(int) to authenticated;

drop policy if exists "league_members_select_same_league" on public.league_members;
create policy "league_members_select_same_league" on public.league_members
  for select to authenticated
  using (public.is_league_member(league_id));
