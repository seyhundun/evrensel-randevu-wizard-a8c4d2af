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

    // Extract country from request body
    const body = await req.json().catch(() => ({}));
    const country = (body.country || map.proxy_country || "TR").toUpperCase();
    
    // Always use core residential (rpc)
    const product = "rpc";

    const productData = data?.data?.[product];
    if (!productData) {
      return new Response(
        JSON.stringify({ ok: true, regions: [], cities: [], countries: {} }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get cities - filter by country (case-insensitive comparison)
    const allCities: any[] = productData.cities?.data || [];
    const countryCities = allCities.filter((c: any) => {
      const cc = (c.countryCode || c.country_code || "").toUpperCase();
      return cc === country;
    });
    
    // Map cities to consistent format with id for proxy _city- parameter
    const mappedCities = countryCities.map((c: any) => {
      const cityName = c.city || c.name || "";
      // id = lowercase, dots instead of spaces (Evomi format)
      const cityId = cityName.toLowerCase().replace(/\s+/g, ".");
      return { id: cityId, name: cityName, region: c.region || "" };
    });

    // Get countries list
    const countries = productData.countries || {};

    // Return cities as both "regions" and "cities" for backward compatibility
    return new Response(
      JSON.stringify({
        ok: true,
        regions: mappedCities,
        cities: mappedCities,
        countries,
        product,
        selectedCountry: country,
        totalCities: allCities.length,
        filteredCities: mappedCities.length,
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
