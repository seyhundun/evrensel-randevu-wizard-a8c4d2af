
CREATE TABLE public.server_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  command TEXT NOT NULL,
  output TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  executed_at TIMESTAMPTZ,
  target TEXT NOT NULL DEFAULT 'vfs'
);

ALTER TABLE public.server_commands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage server_commands"
ON public.server_commands
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
