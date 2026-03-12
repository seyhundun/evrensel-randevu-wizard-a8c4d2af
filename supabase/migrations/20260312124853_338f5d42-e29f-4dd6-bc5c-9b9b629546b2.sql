
CREATE TABLE public.vfs_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  password TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  banned_until TIMESTAMP WITH TIME ZONE,
  last_used_at TIMESTAMP WITH TIME ZONE,
  fail_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.vfs_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to vfs_accounts" ON public.vfs_accounts
  FOR ALL TO public USING (true) WITH CHECK (true);

CREATE TRIGGER update_vfs_accounts_updated_at
  BEFORE UPDATE ON public.vfs_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
