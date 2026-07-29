-- The audit trigger is internal and must not be exposed as a Data API RPC.
revoke all on function public.log_record_audit() from public, anon, authenticated;
