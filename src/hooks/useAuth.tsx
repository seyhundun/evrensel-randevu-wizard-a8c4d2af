import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";

function logAuthEvent(email: string, userId: string | undefined, eventType: string) {
  supabase.from("auth_logs").insert({
    user_email: email,
    user_id: userId || null,
    event_type: eventType,
    user_agent: navigator.userAgent,
  } as any).then(() => {}).catch(() => {});
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const loggedRef = useRef<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, sess) => {
      setSession(sess);
      setLoading(false);

      if (event === "SIGNED_IN" && sess?.user?.email && loggedRef.current !== sess.user.id) {
        loggedRef.current = sess.user.id;
        logAuthEvent(sess.user.email, sess.user.id, "sign_in");
      }
      if (event === "SIGNED_OUT") {
        if (loggedRef.current) {
          logAuthEvent("unknown", loggedRef.current, "sign_out");
        }
        loggedRef.current = null;
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = useCallback(() => supabase.auth.signOut(), []);

  return { session, loading, signOut };
}
