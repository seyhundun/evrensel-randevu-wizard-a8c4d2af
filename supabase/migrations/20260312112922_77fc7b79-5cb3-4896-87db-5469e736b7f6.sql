
-- Add screenshot_url column to tracking_logs
ALTER TABLE public.tracking_logs ADD COLUMN screenshot_url text;

-- Create storage bucket for bot screenshots
INSERT INTO storage.buckets (id, name, public) VALUES ('bot-screenshots', 'bot-screenshots', true);

-- Allow public read access
CREATE POLICY "Public read access" ON storage.objects FOR SELECT TO public USING (bucket_id = 'bot-screenshots');

-- Allow uploads via service role (bot uses service role key via edge function)
CREATE POLICY "Service role upload" ON storage.objects FOR INSERT TO service_role WITH CHECK (bucket_id = 'bot-screenshots');
