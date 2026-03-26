import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";

async function logAuthEvent(email: string, userId: string | undefined, eventType: string) {
  try {
    await supabase.from("auth_logs").insert({
      user_email: email,
      user_id: userId || null,
      event_type: eventType,
      user_agent: navigator.userAgent,
    } as any);
  } catch {}
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const loggedRef = useRef<string | null>(null);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setLoading(false);

      if (event === "SIGNED_IN" && session?.user?.email && loggedRef.current !== session.user.id) {
        loggedRef.current = session.user.id;
        logAuthEvent(session.user.email, session.user.id, "sign_in");
      }
      if (event === "SIGNED_OUT") {
        if (loggedRef.current) {
          logAuthEvent("unknown", loggedRef.current, "sign_out");
        }
        loggedRef.current = null;
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = () => supabase.auth.signOut();

  return { session, loading, signOut };
}
