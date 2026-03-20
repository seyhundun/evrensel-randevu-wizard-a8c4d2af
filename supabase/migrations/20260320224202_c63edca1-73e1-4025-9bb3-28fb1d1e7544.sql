INSERT INTO public.bot_settings (key, value, label) 
VALUES ('proxy_type', 'mobile', 'Proxy Türü')
ON CONFLICT (key) DO UPDATE SET value = 'mobile', updated_at = now();

UPDATE public.bot_settings SET value = 'TR' WHERE key = 'proxy_country';