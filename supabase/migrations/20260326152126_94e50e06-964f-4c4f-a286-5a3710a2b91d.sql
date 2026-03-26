ALTER TABLE public.vfs_accounts 
ADD COLUMN IF NOT EXISTS imap_last_status text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS imap_last_message text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS imap_last_checked_at timestamp with time zone DEFAULT NULL;