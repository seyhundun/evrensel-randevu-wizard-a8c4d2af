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

    // Get evomi_api_key from bot_settings
    const { data: settings } = await supabase.from("bot_settings").select("key, value");
    const map = Object.fromEntries((settings ?? []).map((s: any) => [s.key, s.value]));

    const apiKey = map.evomi_api_key;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ ok: false, error: "Evomi API key tanımlı değil (bot_settings: evomi_api_key)" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch settings from Evomi API
    const response = await fetch("https://api.evomi.com/public/settings", {
      headers: { "x-apikey": apiKey },
    });

    if (!response.ok) {
      const text = await response.text();
      return new Response(
        JSON.stringify({ ok: false, error: `Evomi API hatası [${response.status}]: ${text}` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();

    // Extract regions for the selected country (default TR)
    const body = await req.json().catch(() => ({}));
    const country = (body.country || map.proxy_country || "TR").toUpperCase();
    
    // Determine product type from proxy host
    const host = map.proxy_host || "";
    let product = "rpc"; // core residential default
    if (host.includes("rp.evomi") || host.includes("premium")) product = "rp";

    const productData = data?.data?.[product];
    if (!productData) {
      return new Response(
        JSON.stringify({ ok: true, regions: [], cities: [], countries: productData?.countries || {} }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get regions
    const allRegions: string[] = productData.regions?.data || [];
    
    // Get cities - filter by country if possible
    const allCities: any[] = productData.cities?.data || [];
    const countryCities = allCities.filter((c: any) => c.countryCode === country);
    
    // Get countries
    const countries = productData.countries || {};

    return new Response(
      JSON.stringify({
        ok: true,
        regions: allRegions,
        cities: countryCities.map((c: any) => ({ name: c.city || c.name, region: c.region })),
        countries,
        product,
        selectedCountry: country,
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
