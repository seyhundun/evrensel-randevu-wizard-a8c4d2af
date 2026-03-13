
CREATE TABLE public.idata_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  password TEXT NOT NULL,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  passport_no TEXT NOT NULL DEFAULT '',
  phone TEXT DEFAULT NULL,
  birth_day TEXT NOT NULL DEFAULT '01',
  birth_month TEXT NOT NULL DEFAULT '01',
  birth_year TEXT NOT NULL DEFAULT '1990',
  residence_city TEXT DEFAULT NULL,
  idata_office TEXT DEFAULT NULL,
  travel_purpose TEXT DEFAULT NULL,
  invoice_type TEXT NOT NULL DEFAULT 'bireysel',
  invoice_city TEXT DEFAULT NULL,
  invoice_district TEXT DEFAULT NULL,
  invoice_address TEXT DEFAULT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  registration_status TEXT DEFAULT 'none',
  banned_until TIMESTAMPTZ DEFAULT NULL,
  last_used_at TIMESTAMPTZ DEFAULT NULL,
  fail_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.idata_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to idata_accounts"
  ON public.idata_accounts
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.idata_accounts;
