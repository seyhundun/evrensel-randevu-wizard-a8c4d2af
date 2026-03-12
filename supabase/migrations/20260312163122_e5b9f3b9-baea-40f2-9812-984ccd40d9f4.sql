
ALTER TABLE public.vfs_accounts 
  ADD COLUMN IF NOT EXISTS phone text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS registration_status text DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS registration_otp_type text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS registration_otp text DEFAULT NULL;

COMMENT ON COLUMN public.vfs_accounts.registration_status IS 'none, pending, email_otp, sms_otp, completed, failed';
COMMENT ON COLUMN public.vfs_accounts.registration_otp_type IS 'email or sms - which OTP the bot is currently waiting for';
COMMENT ON COLUMN public.vfs_accounts.registration_otp IS 'The OTP code entered by user for registration verification';
