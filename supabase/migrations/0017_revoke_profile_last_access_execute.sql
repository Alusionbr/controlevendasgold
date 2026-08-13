-- A função é usada exclusivamente pelo trigger; não deve ser exposta como RPC.
revoke execute on function public.guard_profile_last_access() from public, anon, authenticated;