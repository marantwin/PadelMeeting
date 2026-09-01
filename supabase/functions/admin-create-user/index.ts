// ============================================================
// Edge Function: admin-create-user
// Crea un giocatore COMPLETO in un colpo solo: utente auth con email
// gia' confermata e password impostata + profilo pm_profiles attivo (PR 35).
//
// Sicurezza: accetta richieste solo da utenti loggati con role='admin'
// (qualsiasi circolo) o role='manager' — per i manager il circolo del nuovo
// giocatore viene FORZATO al loro, lato server, qualunque cosa mandi il
// client. Chiunque altro riceve 403.
//
// Variabili d'ambiente (gia' presenti di default nelle Edge Functions):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
//
// Body atteso (JSON):
//   { full_name, email, password, club, city?, provincia?, telefono?,
//     consents_attested: true }  <- obbligatorio: chi crea attesta che il
//     giocatore ha letto/accettato Termini e Privacy (consenso "assistito",
//     registrato nei metadati auth con data server e id dell'attestante)
// ============================================================

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

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    // 1) Chi chiama? Deve essere un admin.
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");
    const { data: caller, error: authErr } = await admin.auth.getUser(jwt);
    if (authErr || !caller?.user) return json({ error: "Non autenticato" }, 401);

    const { data: prof } = await admin
      .from("pm_profiles")
      .select("role, club")
      .eq("id", caller.user.id)
      .single();
    const isAdmin = prof?.role === "admin";
    const isManager = prof?.role === "manager";
    if (!isAdmin && !isManager) return json({ error: "Solo admin o responsabile di circolo" }, 403);

    // 2) Input — per i manager il circolo e' SEMPRE il loro (imposto qui,
    //    lato server: il valore inviato dal client viene ignorato)
    const { full_name, email, password, club, city, provincia, telefono,
      consents_attested } = await req.json();
    const effectiveClub = isAdmin ? club : prof.club;
    if (!full_name || !email || !password || !effectiveClub) {
      return json({ error: "Campi obbligatori: full_name, email, password, club" }, 400);
    }
    if (String(password).length < 6) {
      return json({ error: "Password minimo 6 caratteri" }, 400);
    }
    if (consents_attested !== true) {
      return json({ error: "Manca l'attestazione dei consensi (Termini/Privacy): aggiorna l'app e spunta la conferma" }, 400);
    }

    // Consenso "assistito": chi crea l'account attesta di aver fatto leggere
    // e accettare i documenti al giocatore. Data del server + attestante dal JWT.
    const consents = {
      mode: "assisted",
      maggiorenne: true,
      termini: true,
      privacy: true,
      version: "v1",
      at: new Date().toISOString(),
      attested_by: caller.user.id,
      attested_role: prof.role,
    };

    // 3) Crea l'utente auth: email confermata + password impostata
    const meta = {
      full_name,
      role: "player",
      club: effectiveClub,
      city: city || "",
      provincia: provincia || "",
      telefono: telefono || "",
      consents,
    };
    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: meta,
      });
    if (createErr) return json({ error: createErr.message }, 400);
    const uid = created.user.id;

    // 4) Profilo attivo a PR 35 (il trigger di signup lo crea 'pending';
    //    se il trigger non esistesse, lo creiamo noi)
    const { data: upd } = await admin
      .from("pm_profiles")
      .update({ status: "active", rating: 35 })
      .eq("id", uid)
      .select();
    if (!upd || upd.length === 0) {
      const { error: insErr } = await admin.from("pm_profiles").insert({
        id: uid,
        full_name,
        email,
        club: effectiveClub,
        city: city || null,
        provincia: provincia || null,
        telefono: telefono || null,
        role: "player",
        status: "active",
        rating: 35,
        games: 0,
        streak: 0,
      });
      if (insErr) return json({ error: "Utente creato ma profilo no: " + insErr.message }, 500);
    }

    return json({ ok: true, id: uid, email, consents });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
