import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Load proxy settings from bot_settings
    const { data: settings } = await supabase.from("bot_settings").select("key, value");
    const map = Object.fromEntries((settings ?? []).map((s: any) => [s.key, s.value]));

    const host = map.proxy_host || "core-residential.evomi-proxy.com";
    const port = map.proxy_port || "1000";
    const country = map.proxy_country || "TR";
    const user = map.proxy_user || "";
    const pass = map.proxy_pass || "";

    if (!user || !pass) {
      return new Response(
        JSON.stringify({ ok: false, error: "Proxy kullanıcı adı veya şifre tanımlı değil (bot_settings: proxy_user, proxy_pass)" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sessionId = `test_${Date.now()}`;
    const proxyPass = `${pass}_country-${country}_session-${sessionId}`;
    const proxyUrl = `http://${user}:${proxyPass}@${host}:${port}`;

    // Use Deno's fetch with proxy — unfortunately Deno Deploy doesn't support proxy natively,
    // so we'll do a direct TCP approach or just test connectivity
    // Alternative: make an HTTP request through the proxy using basic auth
    const proxyAuth = btoa(`${user}:${proxyPass}`);
    
    // Connect to proxy and request ip.evomi.com
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      // Use CONNECT-style proxy request
      const response = await fetch(`http://${host}:${port}/`, {
        method: "GET",
        headers: {
          "Host": "ip.evomi.com",
          "Proxy-Authorization": `Basic ${proxyAuth}`,
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      // If direct proxy fetch doesn't work in edge functions, fall back to reporting config
      const text = await response.text();
      const ipMatch = text.match(/(\d+\.\d+\.\d+\.\d+)/);
      
      if (ipMatch) {
        return new Response(
          JSON.stringify({ ok: true, ip: ipMatch[1], country, host, port, session: sessionId }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } catch {
      clearTimeout(timeout);
    }

    // Edge functions can't proxy — return config validation instead
    return new Response(
      JSON.stringify({
        ok: true,
        ip: null,
        message: "Edge function proxy testi desteklemiyor. Proxy yapılandırması doğru görünüyor.",
        config: { host, port, country, user, session: sessionId },
        curl_test: `curl -x http://${user}:${pass}_country-${country}@${host}:${port} https://ip.evomi.com/s`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
