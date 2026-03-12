
-- Tracking configurations table
CREATE TABLE public.tracking_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  country TEXT NOT NULL,
  city TEXT NOT NULL,
  visa_category TEXT,
  person_count INTEGER NOT NULL DEFAULT 1,
  check_interval INTEGER NOT NULL DEFAULT 120,
  keep_alive BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT false,
  telegram_chat_id TEXT,
  webhook_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Applicants table
CREATE TABLE public.applicants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  config_id UUID NOT NULL REFERENCES public.tracking_configs(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  passport TEXT NOT NULL DEFAULT '',
  birth_date TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Tracking logs table
CREATE TABLE public.tracking_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  config_id UUID NOT NULL REFERENCES public.tracking_configs(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'checking',
  message TEXT,
  slots_available INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.tracking_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applicants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking_logs ENABLE ROW LEVEL SECURITY;

-- Public access policies
CREATE POLICY "Allow all access to tracking_configs" ON public.tracking_configs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to applicants" ON public.applicants FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to tracking_logs" ON public.tracking_logs FOR ALL USING (true) WITH CHECK (true);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_tracking_configs_updated_at
  BEFORE UPDATE ON public.tracking_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
