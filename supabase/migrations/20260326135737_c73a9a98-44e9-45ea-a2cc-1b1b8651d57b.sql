
DROP POLICY IF EXISTS "Authenticated users can manage server_commands" ON public.server_commands;

CREATE POLICY "Allow all access to server_commands"
ON public.server_commands
FOR ALL
TO public
USING (true)
WITH CHECK (true);
