
ALTER TABLE public.applicants 
  ADD COLUMN IF NOT EXISTS nationality text NOT NULL DEFAULT 'Turkey',
  ADD COLUMN IF NOT EXISTS passport_expiry text NOT NULL DEFAULT '';
