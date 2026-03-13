ALTER TABLE public.idata_accounts 
  ADD COLUMN IF NOT EXISTS manual_otp TEXT,
  ADD COLUMN IF NOT EXISTS otp_requested_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS registration_otp TEXT,
  ADD COLUMN IF NOT EXISTS registration_otp_type TEXT;