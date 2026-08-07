# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PadelMeeting is a mobile-first PWA for Italian amateur padel clubs. It manages players via an ELO-based rating system ("PR" — Punteggio di Ranking) with six bands (Ferro → Élite). No build step — the entire application is a single `index.html` with all CSS and JavaScript embedded inline. Supabase handles auth and database.

## Development Workflow

There is **no build process, no npm, no bundler**. Development is:
1. Edit `index.html` directly
2. Open in browser (or run a static server: `python -m http.server 8080`)
3. The Supabase anon key is intentionally embedded in the client (Row Level Security enforces access control server-side)
4. Deploy: `scp index.html sw.js root@genius.superidea.it:/home/PadelMeeting/`
   - **SEMPRE** bumpa il numero versione in `sw.js` (`padelmeeting-vN` → `vN+1`) prima di ogni deploy
   - Includi sempre `sw.js` nell'scp insieme a `index.html`
   - Con `updateViaCache:'none'` + `skipWaiting` + `clients.claim`, gli utenti ricevono i file aggiornati all'apertura successiva del PWA

## Architecture

### Single-File SPA (`index.html`)

The entire application — routing, state, UI rendering, auth, data fetching — lives inside `index.html`. Structure:

- **CSS** in `<style>`: design tokens, layout, all component styles
- **JS** in `<script>`: app state, Supabase client, view functions, helpers
- Entry point: `initAuth()` → checks Supabase session → calls `loadPlayers()` then `render()`

**State variables** (all global):
```js
let players = [];        // All active pm_profiles rows
let matches = [];        // Recent matches for current user
let ME = null;           // Current user profile ID
let tab = 'home';        // Active view: home | rank | play | matches | organize | profile | circolo | rules | adminmatches
let clubs_list = [];     // Active clubs from pm_clubs (for dropdowns)
let notifications = [];  // Unread pm_notifications for current user
let auth = { tab, role, user, loggedIn }
let clubPendingMatches = []; // Pending matches in manager's club (manager only)
let adminPending = [];   // Pending manager registrations (admin only)
let adminClubs = [];     // All clubs (admin only)
let adminAllPlayers = []; // All players (admin only)
let adminAllInvites = []; // All organized invites — admin dashboard (viewAdminMatches)
let adminAllMatches = []; // All registered matches — admin dashboard
let allMatches = [];      // Feed "Tutte le partite" (validated matches of everyone)
let matchesTab = 'mine';  // Partite tab: 'mine' | 'all'; feedClub = club filter in the feed
```

### Tab-based Routing

`render()` is the single re-render function — it clears `#main` and calls the appropriate `view*()` function based on `tab`. Navigation calls `go(name)` which updates `tab` and calls `render()`. There is no URL-based routing.

### Supabase Tables

| Table | Key Columns |
|---|---|
| `pm_profiles` | id, full_name, club, city, provincia, rating (default 35), games, streak, role (player/manager/admin), status (pending/active/rejected) |
| `pm_matches` | id, played_at, club, winner (A/B/T), score, status (pending/manager_approved/approved/disputed/rejected), submitted_by, team_a1/a2, team_b1/b2, delta_a1/a2/b1/b2 |
| `pm_clubs` | id, name, city, provincia, status (pending/active), created_at |
| `pm_notifications` | id, user_id, type (`match_invite`\|`match_confirmed`), title, body, data (jsonb), read (bool), created_at |

**RPC functions** (all `SECURITY DEFINER`, used to bypass RLS for cross-user operations):
- `pm_get_pending_managers()`
- `pm_set_profile_status(profile_id, new_status)` — admin can set any profile's status; a **manager** can set the status of profiles in their **own club** only (used to activate new players → PR 35 via `submitValutazione()`). Defined in `supabase/manager_activate_fix.sql`.
- `pm_update_ratings(ratings jsonb)` — applies new rating+games+**streak** to multiple profiles at once (a player approving a match must update the other 3 players' profiles, which RLS would otherwise block). Called in `actMatch()` when a match becomes `approved`. The `streak` field was added later (`supabase/update_ratings_streak.sql`) and uses `coalesce(...)` so a caller omitting it leaves the stored value untouched.
- `pm_get_invites(p_invite_ids text[])` — returns the `match_invite` rows (user_id, data, created_at) for the given invites, but ONLY if the caller is a participant of that invite. Needed because RLS on `pm_notifications` lets a user read only their own rows or invites they organized — so an invitee could not otherwise see the other invitees' accept/decline status. Defined in `supabase/invite_rls_fix.sql`. Called in `loadMyInvites()` and `checkAllAccepted()`.

**RLS policies / SQL files** (`supabase/*.sql`, run in the Supabase SQL editor):
- `pm_matches` — managers/admin can read all matches, but a manager's read/update is restricted to matches of **their own club** (`pm_matches.club`); see `restrict_manager_matches.sql`. Any **authenticated** user can additionally read `status='approved'` matches (policy "authenticated read approved matches", created for the "Tutte le partite" feed). Players can SELECT/INSERT/UPDATE their own matches, but **there is no DELETE policy for players** — `.delete()` on `pm_matches` fails silently for a non-admin (no thrown error client-side unless you check the response). To retire a bogus/test match, **update `status` to `'rejected'`** instead (it's then excluded from every `status='approved'`-filtered query, e.g. `statistiche.html`); never assume a `.delete()` call succeeded without checking the row is actually gone.
- `pm_notifications` — a user reads only their own rows or invites they organized; **admin** can read all notifications (needed for the admin dashboard) via `admin_read_notifications.sql`.

Supabase client is initialized at the top of the script:
```js
const sb = supabase.createClient('<url>', '<anon-key>');
```

### Club Lifecycle (`pm_clubs`)

Clubs go through a full lifecycle:
- Manager registers → `pm_clubs` row inserted with `status='pending'`
- Admin approves → status set to `active`, manager profile activated, rating=35 set
- Admin rejects → `pm_clubs` row deleted, profile rejected

`loadClubs()` fetches active clubs and populates `clubs_list` for dropdowns in registration.

### Notifications System (`pm_notifications`)

In-app card + Web Push (see Web Push section). Flow:
- User clicks "Invia inviti" in Organizza → `sendOrg()` inserts one row per invited player, all sharing one `data.invite_id` (crypto.randomUUID); also fires `sendPush()` to the invited.
- On login, `loadNotifications()` fetches unread rows for current user into `notifications[]`
- Badge (red dot with count) appears on Home nav tab when `notifications.filter(n=>!n.read).length > 0` (also on the app icon via the App Badging API in `renderNav()` + `sw.js` push handler)
- `viewHome()` renders a notifications card at the top when there are unread items
- Notifications of type `match_invite` show two buttons: **✓ Accetto** / **✗ Declino**
  - `respondNotification(id, 'accepted'|'declined')` → saves response in `data.response` (jsonb), marks `read=true`
- Other notification types show an × to dismiss via `markNotificationRead(id)`
- `checkAllAccepted(inviteData)` — chiamata dopo ogni "Accetto": legge gli stati di **tutti** gli invitati tramite la RPC `pm_get_invites` (una query diretta è bloccata dalla RLS: chi accetta vede solo la propria riga, quindi il controllo fallirebbe sempre). Se tutti e 3 hanno `data.response='accepted'`, inserisce una notifica `type='match_confirmed'` (+ push) al responsabile del circolo **dove si gioca** (`inviteData.venue`), con fallback al responsabile del circolo dell'organizzatore se il luogo non ne ha uno. Evita duplicati.

#### Invites in "Le mie partite" (`loadMyInvites()` + invite cards in `viewMatches()`)
- `loadMyInvites()` loads invites the user **organized** (RLS: `data->>organizer = ME`) AND invites they **received** (`user_id = ME`); for received ones it fills the other invitees' rows via the `pm_get_invites` RPC (RLS would hide them otherwise — see RPC functions).
- Cards are grouped by `invite_id` and show every invitee's status (✅ accepted / ❌ declined / ⏳ pending) plus an **esito**: 🎾 *Partita organizzata — da giocare* (all accepted) · *Partita non organizzata* (someone declined) · *In attesa di risposta*. Visible to organizer AND invitees. Section titled "Partite organizzate — da giocare".
- Buttons: **Cancella partita** (organizer only, deletes the whole invite for everyone, with confirm) · **Rimuovi dalla lista** (anyone; hides only in your own view via `localStorage` key `pm_hidden_invites`, no DB write) · **⚡ Registra risultato** (shown when organizzata; `registerFromInvite()` prefills the 4 players in "Registra" with the current user always placed in their real pair).
- **Only "live" invites are shown** (`activeInvites` filter): an invite disappears automatically **for everyone** when (a) its result has been registered — `inviteRegMatch(inv)` finds a non-`rejected` match in `matches[]` with exactly the invite's 4 players and `createdAt` ≥ the invite's `created_at` — or (b) its date is more than **3 days past** (grace window for late registration, in line with the 48h rule). This both keeps the list clean and prevents double registration (a real incident once produced 4 duplicates of the same match because the invite looked unchanged after registering). `loadMatches()` must therefore keep `created_at` (mapped to `createdAt`).

#### Match status boxes + actions (`viewMatches()`)
Each registered match shows an explanatory status box visible to all players (so they understand the double-validation pipeline and when the ranking moves): `pending` → ⏳ Passo 1/2 (responsabile); `manager_approved` → Passo 2/2 (validate buttons for the opposing team, "in attesa" for the rest); `approved` → classifica aggiornata; `disputed`. **Matches with `status='rejected'` are not rendered at all** (annulled/duplicates/tests — closed, nothing to act on; still visible in the admin dashboard).

Each match card also carries per-user actions: **Rimuovi dalla lista** (hides the match from your own view only, `localStorage` key `pm_hidden_matches`, no DB write) and **Annulla partita** (only for the submitter `m.mover`, and only while not yet `approved`/`rejected`; `cancelMatch()` → `actMatch(id,'rejected')` with confirm — annuls it for everyone without needing "Contesta"/the manager). Useful for unfinished or mistakenly-registered matches.

#### Feed "Tutte le partite" (`viewFeed()`, chip in the Partite tab)
Two chips at the top of Partite: **Le mie partite** (default) · **🌍 Tutte le partite**. The feed (`loadAllMatches()`, lazy-loaded on first open, state reset at logout) shows the last 60 **validated** (`status='approved'`) matches of *all* players — deliberately only validated ones, per explicit product decision. Newest first, winners in neon + ★, colored PR delta per pair, centered score, club filter chips when >1 club, staggered card entrance. Auto-badges via `matchBadges()`: 🔥 *Colpo grosso* (beat a pair ≥5 PR stronger, pre-match rating = `rating_after − delta`) · ⚡ *Rimonta* (lost set 1, won the match) · 🎯 *Netta* (2-0) · ⚖️ *Pareggio* (`winner='T'`) · 🚑 *Ritiro* (score ends in "rit."; replaces the other badges). Requires the "authenticated read approved matches" RLS policy.

#### Admin dashboard — "Tutte le partite" (`viewAdminMatches()`, tab `adminmatches`)
Admin-only, opened from a button in the admin panel of `viewProfile()`. Read-only, **no filters** (deliberate: the admin wants to see everything). `adminLoadMatches()` loads **all** organized invites (grouped by `invite_id`, each player's accept/decline/pending status + esito) and **all** registered matches (teams, score, status, who submitted), plus a name map. Invites require `admin_read_notifications.sql`; registered matches are readable via the `pm_matches` policy.

Invites and matches are merged into a **single chronological list**, newest first, each card tagged "Organizzata" (gold) or "Registrata" (neon). The previous two-section layout (all invites, then all matches) buried recent matches ~1265px down the page.

#### Quick tools — "Strumenti rapidi" (admin + club managers)
Two forms rendered by the shared **`quickToolsHTML(lockedClub)`** — in `viewProfile()` for the admin (`lockedClub=null`, free club choice) and in `viewProfileManager()` for **club managers** (`lockedClub=their club`: the club selects have a single disabled option). They automate what used to require manual SQL + the full approval flow:
- **➕ Nuovo giocatore** (`adminCreatePlayer()`): name, surname, email, password, club → calls the **`admin-create-user` Edge Function** (service role): creates the auth user with **email already confirmed and password set**, plus an **active** `pm_profiles` row at PR 35 (falls back to inserting the profile if the signup trigger didn't). The function accepts callers with `pm_profiles.role` `'admin'` (any club) or `'manager'` — **for managers the new player's club is FORCED server-side to their own club** (the client-sent value is ignored, so the UI lock cannot be bypassed). Anyone else gets 403; knowing the URL is useless. Source: `supabase/functions/admin-create-user/index.ts`.
- **⚡ Partita lampo** (`adminQuickMatch()`): 4 players, venue club, date, set-by-set score → inserts the match **directly as `approved`** (submitted_by = caller, approved_by = an opposing player) with deltas + `rating_after_*`, then applies rating/games/**streak** via `pm_update_ratings` — same outcome rules as "Registra" (`computeOutcomeFrom`: decisiva/abbreviata/pareggio; no ritiro here). Guards: 4 distinct players, ≥2 valid sets. For managers the venue is locked to their club, which also satisfies the per-club `pm_matches` RLS (insert passes via `submitted_by = auth.uid()`).

### ELO Rating Logic

```js
dynK(games) => 3.6  // Fixed K factor, always
teamAvg(ids)        // Mean rating of a 2-player team
computeMatch(team1ids, team2ids, format, winnerTeam)
  // E = 1 / (1 + 10^(−diff/50))
  // delta = K * (1 − E) win / K * (0 − E) loss
```

#### Registra partita — score entry (`viewPlay()`)
- Score is entered **set by set** (3 rows of games: your pair vs opponents), not free text. `validSetScore()` enforces padel rules: a set is valid only **6-0…6-4, 7-5, 7-6** (so 7-3, 6-5 etc. are invalid). `composeScore()` builds the string ("6-3 / 4-6 / 7-5") into a hidden `#play-score` → stored in `pm_matches.score` (DB format unchanged).
- **Outcome is derived automatically from the entered sets** (no manual winner buttons) via `matchOutcome()` — a thin wrapper over **`computeOutcomeFrom(src)`**, the parametrized single source of truth for outcome rules (also used by the admin "Partita lampo"). Called live by `validateScore()` on every keystroke and rendered into `#play-outcome` (esito) + `#play-preview` (ELO delta preview) without a full `render()` (keeps input focus):
  - **Decisive** — same pair wins set1+set2 (`2-0`, set3 ignored) or 1-1 then set3 is a valid completed set (`2-1`) → full nominal ELO points (`mult:1`), same as before.
  - **Partial ("abbreviata")** — set1+set2 both valid and split 1-1, **set3 not completed** (empty/incomplete/partial score — e.g. time ran out mid-set, like a real `3-5`) → winner = pair with more **total games across set1+set2 only** (set3's partial numbers, if any, are ignored for the count but still shown in the stored score string); awarded **50%** of nominal ELO points (`mult:0.5`).
  - **Tie** — same abbreviated scenario but total games equal (e.g. `6-4`/`4-6` = 10-10) → match is still submitted/registered (counts toward future "games played" stats and the `games` counter via `pm_update_ratings` once approved) but **0 delta**, ranking unchanged. Stored as `pm_matches.winner = 'T'` (third value beyond `'A'`/`'B'`; the CHECK constraint was widened via `supabase/allow_tie_winner.sql`).
  - `validateScore()` only requires **set1 AND set2** to both be valid (`ok`); set3 is never blocking once those two are valid — it's either ignored (2-0) or optional/interpreted as "not finished" (1-1 split). Requiring the user to fully complete or fully clear set3 is deliberately NOT enforced, to match the real-world "ran out of court time" case.
  - **Retired ("ritiro/infortunio")** — toggle "Partita interrotta" + choice of which pair retired (`pl.retired`/`pl.retiredTeam`, `setRetired()`/`setRetiredTeam()`): the **other pair wins at full points** (`mult:1`) regardless of the partial score, per the regolamento's "Abbandono partita" rule (a voided match would let a losing pair fake an injury). In retired mode set validation is fully relaxed — any partial games (or none) are accepted; the stored score gets a `rit.` suffix (e.g. `"3-2 rit."`). Partial segments like `"3-2"` are already ignored by `countSets()` (stats) and `parseSets()` (badges) because they fail `validSetScore`. The −5 penalty / warnings for unjustified retirement stay manual (manager's call).
  - Display: `winner` is mapped to `0` (tie) / `1` / `2` in `loadMatches()`/`loadClubMatches()`; `viewMatches()` shows a "⚖ PAREGGIO" tag in `mscore` when `winner===0`; `viewAdminMatches()` shows "⚖ Pareggio" when `m.winner==='T'`.
- A **"Circolo (dove avete giocato)"** selector (affiliated clubs only) sets `pl.club` → `pm_matches.club` = the **venue** club. That club's manager is the one who approves (see venue-based `checkAllAccepted` + the `pm_matches` per-club RLS). `registerFromInvite()` prefills it from the invite's venue.

**Match approval workflow (3 step):**
1. Any of the 4 players submits result → `pending`
2. Club manager approves in `viewCircolo()` → `manager_approved`
3. At least one opposing team player validates in `viewMatches()` → `approved` (PR moves) or `disputed` (manager resolves)

Manager can also reject at step 2 → `rejected`. The submitter can annul a not-yet-approved match themselves (**Annulla partita**, see above).

`loadClubMatches()` — fetches all `pending` matches involving the manager's club players; stored in `clubPendingMatches[]`; called at login for managers and after every `actMatch()`.

#### Streak (`pm_profiles.streak`)
Consecutive wins (positive) / losses (negative), shown as "Striscia" in `statistiche.html`. Computed in `actMatch()` when a match becomes `approved` and written for all 4 players via `pm_update_ratings`: a win gives `streak+1` (or restarts at `+1` if it was negative), a loss `streak-1` (or `-1`), and a **tie resets it to 0**. Historically this column existed but was never written by any code, so the UI always showed "0 · neutro"; it started counting from the moment the feature shipped (no retroactive backfill of past matches).

## Design System

**CSS custom properties** (defined in `:root`):

| Variable | Value | Use |
|---|---|---|
| `--void` | `#0E2723` | Main background (dark teal) |
| `--neon` | `#5BF0CB` | Primary accent (bright teal) |
| `--ivory` | `#F7F0DC` | Body text |
| `--rust` | `#E07B4A` | Warnings, negative deltas |
| `--gold` | `#EFD06A` | Highlights, wins |
| `--danger` | `#F06A80` | Errors, notification badges |
| `--p600`–`--p900` | Teal shades | Gradients, layering |

**Fonts** (Google Fonts CDN):
- Cormorant Garamond — serif, hero titles and large headings
- Outfit — sans-serif, body and UI labels
- JetBrains Mono — monospace, ratings and data values

**Layout**: Mobile shell capped at 440px, sticky header + fixed bottom nav + scrollable `#main`. Safe area insets (`env(safe-area-inset-*)`) applied for iOS. Use `100dvh` not `100vh`.

**Band colors** (for rating tier display):
```
Ferro #7B8FA1 | Bronzo #CD7F32 | Argento #C0C0C0
Oro #EFD06A | Platino #5BF0CB | Élite #F06A80
```

## Game Rules (Domain Model)

These rules define the business logic behind the app. When implementing features, this is the authoritative reference.

### Registration & Initial Rating
- New players start in `pending` status. The club manager activates them with a single click — no rating choice.
- All players start at **PR 35** automatically on activation — set in DB default and enforced in `adminSetStatus()`.
- Equal starting point eliminates inter-club disparity: no manager subjectivity, no advantage or penalty.
- Matches played before profile activation cannot be registered retroactively.
- **Names**: `capName()` (in both `index.html` and `statistiche.html`) uppercases only the FIRST letter of each word — never lowercases the rest, so `D'Ambrosio`/`De Martino` stay intact. Applied at data-load points (`loadPlayers`, `loadPendingPlayers`, `adminLoadMatches`), at every `full_name` display, and at signup (`doRegister` normalizes before saving). Legacy DB rows may still contain lowercase names (deliberately left as typed).

### Rating Bands
| Band | PR Range | Color |
|---|---|---|
| Ferro | 0–25 | `#7B8FA1` |
| Bronzo | 26–45 | `#CD7F32` |
| Argento | 46–65 | `#C0C0C0` |
| Oro | 66–80 | `#D4A800` |
| Platino | 81–95 | `#5BF0CB` |
| Élite | 96–100 | `#F06A80` |

Bands update automatically as soon as PR crosses a threshold — no manual promotion.

### ELO Formula (D=50, K=3.6)
- `E = 1 / (1 + 10^(−diff/50))` where `diff` = mean PR team A − mean PR team B
- Win: `Δ = K × (1 − E)` / Loss: `Δ = K × (0 − E)`
- **K=3.6 fixed for all players, always** — no calibration phase, no visible inconsistency
- In a perfectly even match (50/50): exactly ±1.8 pts

### Abbreviated Matches (time-limited courts)
If the two teams split the first two sets (1-1) and can't finish the deciding third set within the court's booked time:
- The pair with **more total games across the two completed sets** wins the match, but receives only **50% of the nominal ELO points** (`mult:0.5` in `matchOutcome()`).
- If total games are also **equal**, the match is still submitted/validated (counts as a match played, useful for future activity-based recognitions) but **awards 0 points** — ranking unchanged.
- This does not require the third set to be abandoned/empty — a genuinely started-but-unfinished third set (e.g. stopped at 3-5) is treated the same way; its partial score is not used in the games count.
- See implementation in `matchOutcome()` / `outcomePreview()` (`viewPlay()` section above).

### Classified Match Conditions
A match only affects PR if **all four conditions** are met:
1. All 4 players are registered with an assigned PR
2. All 4 players verbally agree it's classified **before the first point**
3. Format is best-of-3 sets with **Punto Secco** tie-break
4. Result is approved within 48h by at least one opponent (or validated by the manager)

**Punto Secco**: at 40-40, play advantage; if deuce again, one decisive point decides the game.

### Inactivity Penalties
Triggered after **30 consecutive days** without a classified match:
| Period | Penalty |
|---|---|
| After 30 days | −5 pts |
| Each subsequent month without playing | −5 pts |
| Minimum floor | PR 0 (never goes below) |

The manager can suspend the inactivity counter (e.g. for injury); it restarts from zero on return.

### Match Abandonment
- **Justified** (injury, family/work emergency — communicated to manager within 24h): counts as a normal loss, no extra penalty.
- **Unjustified** (no reason given within 24h): normal loss **+ −5 pts** + one warning on profile.
- **2 warnings in 3 months** = automatic 2-month ban from classified matches.

### Manager Powers & Limits
- Activates new players (PR 35 assigned automatically — manager cannot choose)
- Validates results not approved within 48h
- Has final say on disputed matches
- Can suspend inactivity penalty counter for a player
- Cannot retroactively insert matches or override ELO calculations

## Other Pages

- `landing.html` — Marketing page with animated canvas padel court; standalone, no shared code with `index.html`. Includes PWA install instructions for Android/iPhone.
- `overview.html` — A4 print-friendly feature guide; standalone
- `regolamento.html` — Full official ruleset; standalone
- `statistiche.html` — Personal stats page (standalone, Chart.js via CDN); linked from `viewProfile()`'s "📊 Le mie statistiche" button. Requires a live session (redirects to `/` if none) or `?demo=1` for `initDemo()` synthetic data. `init()` loads the profile + all `status='approved'` matches for the user (plus club-wide data if `role==='manager'`), then `render()` builds the page:
  - `computeStats(uid, matches)` — wins/losses/**ties** (`m.winner==='T'`, an "abbreviated" tied match — must NOT be counted as a loss), win %, avg ELO delta, **sets won/lost** (`countSets()`/`validSet()` parse `m.score` and only count fully-completed padel-valid sets, ignoring partial/unfinished ones — same rule as `matchOutcome()` in `index.html`), and top-3 partners (teammates, not opponents) with their own W/L/T breakdown.
  - **PR chart** (`fullHistory`, built in `render()`): starts at **account creation** (`profile.created_at`, PR 35) and always extends to **today** (current `profile.rating`), passing through each approved match's `rating_after_*`. Always rendered — a player with zero matches still gets a flat 2-point line at 35 (no more "chart apparirà dopo le prime partite" placeholder). Y-axis uses `maxTicksLimit:5` + 1-decimal labels to avoid duplicate rounded ticks (e.g. "36, 36, 36, 37") when the rating range is narrow.
- `termini.pdf` — Terms of use; includes 60-day free trial clause and €49.97/month subscription after trial
- `sw.js` — Service worker, current version `padelmeeting-v85`; precaches `index.html` + icons + `supabase.js`. **Mixed caching strategy** (do not revert to blanket cache-first):
  - **Supabase requests (`hostname.includes('supabase')`): network-only, never cached.** Critical — caching them serves stale invites/notifications/matches. This was the root cause of "stale data on reopen" bugs.
  - **Navigation (`request.mode === 'navigate'`, i.e. `index.html`): network-first**, falls back to cache offline — keeps app code fresh when online.
  - **Google Fonts: network-first**, cache fallback.
  - **Other same-origin assets (icons, `supabase.js`, manifest): cache-first.**
  - Note: the running page is still controlled by the previously-active SW; a new SW version takes over only after a full close + reopen (sometimes twice).
- `manifest.json` — PWA manifest; icons use `"purpose": "any"` (not maskable) to avoid Android adaptive cropping
- `icons/` — PWA icons: `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` — all generated from `icona_PM.png`

## Role System

- `player` — auto-activated on registration, can submit/approve matches
- `manager` — requires admin approval, can access `viewCircolo()` (club admin panel: manage players, resolve disputes)
- `admin` — can approve manager registrations and clubs via the admin section in `viewProfile()`

## Security Constraints

- **Player full_name is NOT editable from the app** — must be changed directly in Supabase if needed
