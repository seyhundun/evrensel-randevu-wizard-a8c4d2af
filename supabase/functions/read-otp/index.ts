import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Simple IMAP OTP reader using Deno's TCP connection
// Connects to IMAP server, searches for recent VFS emails, extracts OTP code

async function connectIMAP(host: string, port: number, email: string, password: string): Promise<string | null> {
  try {
    const conn = await Deno.connect({ hostname: host, port });
    const reader = conn.readable.getReader();
    const writer = conn.writable.getWriter();
    
    // For IMAPS (port 993), we need TLS
    let tlsConn: Deno.TlsConn | null = null;
    let actualReader = reader;
    let actualWriter = writer;
    
    if (port === 993) {
      // Release the raw reader/writer before upgrading
      reader.releaseLock();
      writer.releaseLock();
      
      tlsConn = await Deno.startTls(conn, { hostname: host });
      actualReader = tlsConn.readable.getReader();
      actualWriter = tlsConn.writable.getWriter();
    }
    
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    
    async function readResponse(): Promise<string> {
      const chunks: string[] = [];
      let attempts = 0;
      while (attempts < 10) {
        const { value, done } = await actualReader.read();
        if (done) break;
        chunks.push(decoder.decode(value));
        const text = chunks.join("");
        // Check if we have a complete response
        if (text.includes("\r\n") && (text.match(/^(A\d+|\*)\s/m) || text.startsWith("+"))) {
          // Wait a bit for more data
          await new Promise(r => setTimeout(r, 100));
          const { value: extra } = await actualReader.read().catch(() => ({ value: null }));
          if (extra) chunks.push(decoder.decode(extra));
          break;
        }
        attempts++;
      }
      return chunks.join("");
    }
    
    async function sendCommand(tag: string, cmd: string): Promise<string> {
      await actualWriter.write(encoder.encode(`${tag} ${cmd}\r\n`));
      let response = "";
      let attempts = 0;
      while (attempts < 20) {
        const chunk = await readResponse();
        response += chunk;
        if (response.includes(`${tag} OK`) || response.includes(`${tag} NO`) || response.includes(`${tag} BAD`)) {
          break;
        }
        attempts++;
      }
      return response;
    }
    
    // Read greeting
    await readResponse();
    
    // Login
    const loginResp = await sendCommand("A1", `LOGIN "${email}" "${password}"`);
    if (loginResp.includes("A1 NO") || loginResp.includes("A1 BAD")) {
      console.error("IMAP login failed:", loginResp);
      try { actualReader.releaseLock(); actualWriter.releaseLock(); } catch {}
      return null;
    }
    
    // Select INBOX
    await sendCommand("A2", "SELECT INBOX");
    
    // Search for recent unseen emails from VFS (last 1 day)
    const today = new Date();
    const dateStr = today.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" }).replace(",", "");
    // Format: DD-Mon-YYYY
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const formattedDate = `${String(today.getDate()).padStart(2,"0")}-${months[today.getMonth()]}-${today.getFullYear()}`;
    
    const searchResp = await sendCommand("A3", `SEARCH UNSEEN SINCE ${formattedDate}`);
    
    // Parse message IDs from search response
    const searchLine = searchResp.split("\r\n").find(l => l.startsWith("* SEARCH"));
    if (!searchLine || searchLine.trim() === "* SEARCH") {
      // No matching emails
      await sendCommand("A4", "LOGOUT");
      try { actualReader.releaseLock(); actualWriter.releaseLock(); } catch {}
      return null;
    }
    
    const msgIds = searchLine.replace("* SEARCH ", "").trim().split(" ").filter(Boolean);
    
    // Fetch the latest emails (last 5) and look for VFS OTP
    const latestIds = msgIds.slice(-5);
    
    for (const msgId of latestIds.reverse()) {
      const fetchResp = await sendCommand("A5", `FETCH ${msgId} (BODY[TEXT] BODY[HEADER.FIELDS (FROM SUBJECT DATE)])`);
      
      const lowerResp = fetchResp.toLowerCase();
      
      // Check if this is from VFS
      const isVfs = lowerResp.includes("vfs") || lowerResp.includes("visa") || 
                    lowerResp.includes("vfsglobal") || lowerResp.includes("verification") ||
                    lowerResp.includes("doğrulama") || lowerResp.includes("otp");
      
      if (isVfs) {
        // Extract OTP code - typically 4-8 digits
        const otpPatterns = [
          /(?:code|kod|otp|doğrulama|verification)[:\s]*(\d{4,8})/i,
          /(\d{4,8})\s*(?:is your|doğrulama|verification|code|kod)/i,
          /\b(\d{6})\b/,  // Most common: 6 digit code
          /\b(\d{4})\b/,  // 4 digit code
        ];
        
        for (const pattern of otpPatterns) {
          const match = fetchResp.match(pattern);
          if (match) {
            // Logout
            await sendCommand("A6", "LOGOUT");
            try { actualReader.releaseLock(); actualWriter.releaseLock(); } catch {}
            return match[1];
          }
        }
      }
    }
    
    // Logout
    await sendCommand("A6", "LOGOUT");
    try { actualReader.releaseLock(); actualWriter.releaseLock(); } catch {}
    return null;
  } catch (err) {
    console.error("IMAP error:", err);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { account_id, account_type } = await req.json();
    
    if (!account_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "account_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Support both VFS and iDATA accounts
    const table = account_type === "idata" ? "idata_accounts" : "vfs_accounts";

    // Get account IMAP credentials
    const { data: account, error } = await supabase
      .from(table)
      .select("email, imap_host, imap_password")
      .eq("id", account_id)
      .single();

    if (error || !account) {
      return new Response(
        JSON.stringify({ ok: false, error: "Account not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!account.imap_password) {
      return new Response(
        JSON.stringify({ ok: false, error: "IMAP password not configured for this account" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const host = account.imap_host || "imap.gmail.com";
    const port = 993; // IMAPS

    console.log(`Reading OTP for ${account.email} from ${host} (${table})...`);
    
    const otp = await connectIMAP(host, port, account.email, account.imap_password);

    if (otp) {
      console.log(`OTP found: ${otp}`);
      return new Response(
        JSON.stringify({ ok: true, otp }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ ok: false, error: "No OTP found in recent emails" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("read-otp error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
