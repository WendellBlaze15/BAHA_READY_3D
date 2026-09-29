-- The staff-MFA policy flag is not secret; middleware reads it (with the anon key) to route
-- staff to the MFA challenge. The database still enforces aal2 inside authorize().
update public.system_settings set is_public = true where key = 'require_staff_mfa';
