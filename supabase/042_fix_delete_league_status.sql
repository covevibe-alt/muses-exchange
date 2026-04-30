-- ════════════════════════════════════════════════════════════════════════════
-- Migration 042 — Fix delete_league() status value
-- ════════════════════════════════════════════════════════════════════════════
-- delete_league() (added in migration 040) tried to set status='ended', but
-- the leagues_status_check CHECK constraint only accepts 'active' or
-- 'archived'. Owners hitting Close league got a Postgres-level error toast
-- instead of an archived league. Switch the RPC to use the canonical
-- 'archived' value (which is what the schema has supported all along).
--
-- APPLIED VIA SUPABASE MCP on 2026-04-30.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.delete_league(p_league_id integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_owner   uuid;
  v_status  text;
begin
  if v_user_id is null then return jsonb_build_object('error', 'not_authenticated'); end if;
  select owner_id, status into v_owner, v_status from leagues where id = p_league_id;
  if v_owner is null then return jsonb_build_object('error', 'league_not_found'); end if;
  if v_owner <> v_user_id then return jsonb_build_object('error', 'not_owner'); end if;
  if v_status = 'archived' then return jsonb_build_object('error', 'already_archived'); end if;
  update leagues set status = 'archived', updated_at = now() where id = p_league_id;
  return jsonb_build_object('ok', true, 'id', p_league_id);
end;
$function$;
