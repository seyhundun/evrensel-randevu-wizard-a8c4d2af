CREATE TABLE public.idata_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  is_active BOOLEAN NOT NULL DEFAULT false,
  check_interval INTEGER NOT NULL DEFAULT 120,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.idata_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to idata_config" ON public.idata_config FOR ALL USING (true) WITH CHECK (true);

-- Insert default config row
INSERT INTO public.idata_config (is_active, check_interval) VALUES (false, 120);