ALTER TABLE public.vfs_accounts ADD COLUMN manual_otp text DEFAULT NULL;
ALTER TABLE public.vfs_accounts ADD COLUMN otp_requested_at timestamp with time zone DEFAULT NULL;