// ============================================================
// Edge Function: send-push
// Invia notifiche Web Push ai dispositivi degli utenti indicati.
//
// Variabili d'ambiente richieste (Supabase → Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY
//   VAPID_PRIVATE_KEY
//   SUPABASE_URL                (già presente di default)
//   SUPABASE_SERVICE_ROLE_KEY   (già presente di default)
//
// Body atteso (JSON):
//   { user_ids: string[], title: string, body: string, url?: string }
// ============================================================

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

webpush.setVapidDetails(
  "mailto:info@padelmeeting.it",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { user_ids, title, body, url } = await req.json();
    if (!Array.isArray(user_ids) || user_ids.length === 0) {
      return json({ error: "user_ids mancanti" }, 400);
    }

    const { data: subs, error } = await supabase
      .from("pm_push_subscriptions")
      .select("endpoint, subscription")
      .in("user_id", user_ids);
    if (error) return json({ error: error.message }, 500);

    const payload = JSON.stringify({
      title: title || "PadelMeeting",
      body: body || "",
      url: url || "/",
    });

    let sent = 0;
    await Promise.all(
      (subs || []).map(async (s) => {
        try {
          await webpush.sendNotification(s.subscription, payload);
          sent++;
        } catch (err) {
          const code = (err as { statusCode?: number }).statusCode;
          // 404/410 = subscription scaduta o revocata → la rimuoviamo
          if (code === 404 || code === 410) {
            await supabase
              .from("pm_push_subscriptions")
              .delete()
              .eq("endpoint", s.endpoint);
          }
        }
      }),
    );

    return json({ sent, total: subs?.length || 0 });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
