CREATE TABLE public.quiz_tracking_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'info'::text,
  message text,
  screenshot_url text
);

ALTER TABLE public.quiz_tracking_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to quiz_tracking_logs" ON public.quiz_tracking_logs FOR ALL TO public USING (true) WITH CHECK (true);