-- Cover the auth.users foreign key used by audit attribution.
create index if not exists idx_record_audit_log_changed_by
  on public.record_audit_log (changed_by);
