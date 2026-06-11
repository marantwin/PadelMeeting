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
let tab = 'home';        // Active view: home | rank | play | matches | organize | profile | circolo | rules
let clubs_list = [];     // Active clubs from pm_clubs (for dropdowns)
let notifications = [];  // Unread pm_notifications for current user
let auth = { tab, role, user, loggedIn }
let clubPendingMatches = []; // Pending matches in manager's club (manager only)
let adminPending = [];   // Pending manager registrations (admin only)
let adminClubs = [];     // All clubs (admin only)
let adminAllPlayers = []; // All players (admin only)
```

### Tab-based Routing

`render()` is the single re-render function — it clears `#main` and calls the appropriate `view*()` function based on `tab`. Navigation calls `go(name)` which updates `tab` and calls `render()`. There is no URL-based routing.

### Supabase Tables

| Table | Key Columns |
|---|---|
| `pm_profiles` | id, full_name, club, city, provincia, rating (default 35), games, streak, role (player/manager/admin), status (pending/active/rejected) |
| `pm_matches` | id, played_at, club, winner (A/B), score, status (pending/approved/disputed), submitted_by, team_a1/a2, team_b1/b2, delta_a1/a2/b1/b2 |
| `pm_clubs` | id, name, city, provincia, status (pending/active), created_at |
| `pm_notifications` | id, user_id, type (`match_invite`\|`match_confirmed`), title, body, data (jsonb), read (bool), created_at |

**RPC functions**: `pm_get_pending_managers()`, `pm_set_profile_status(profile_id, new_status)`

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

In-app only (no email/push). Flow:
- User clicks "Invia inviti" in Organizza → `sendOrg()` inserts one row per invited player
- On login, `loadNotifications()` fetches unread rows for current user into `notifications[]`
- Badge (red dot with count) appears on Home nav tab when `notifications.filter(n=>!n.read).length > 0`
- `viewHome()` renders a notifications card at the top when there are unread items
- Notifications of type `match_invite` show two buttons: **✓ Accetto** / **✗ Declino**
  - `respondNotification(id, 'accepted'|'declined')` → saves response in `data.response` (jsonb), marks `read=true`, card sparisce
- Other notification types show an × to dismiss via `markNotificationRead(id)`
- Responses saved in `data` jsonb — `data.response: 'accepted'|'declined'`
- `checkAllAccepted(inviteData)` — chiamata dopo ogni "Accetto": controlla se tutti e 3 i notifs dello stesso invito hanno `data.response='accepted'`; se sì, inserisce una notifica `type='match_confirmed'` al responsabile del circolo dell'organizzatore (evita duplicati)
- Il manager riceve la notifica 🎾 "Partita confermata" con data, ora, luogo e nome·cognome dei 4 giocatori

### ELO Rating Logic

```js
dynK(games) => 3.6  // Fixed K factor, always
teamAvg(ids)        // Mean rating of a 2-player team
computeMatch(team1ids, team2ids, format, winnerTeam)
  // E = 1 / (1 + 10^(−diff/50))
  // delta = K * (1 − E) win / K * (0 − E) loss
```

**Match approval workflow (3 step):**
1. Any of the 4 players submits result → `pending`
2. Club manager approves in `viewCircolo()` → `manager_approved`
3. At least one opposing team player validates in `viewMatches()` → `approved` (PR moves) or `disputed` (manager resolves)

Manager can also reject at step 2 → `rejected`.

`loadClubMatches()` — fetches all `pending` matches involving the manager's club players; stored in `clubPendingMatches[]`; called at login for managers and after every `actMatch()`.

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
- `termini.pdf` — Terms of use; includes 60-day free trial clause and €49.97/month subscription after trial
- `sw.js` — Service worker with cache-first strategy; current version `padelmeeting-v26`; precaches `index.html` + icons
- `manifest.json` — PWA manifest; icons use `"purpose": "any"` (not maskable) to avoid Android adaptive cropping
- `icons/` — PWA icons: `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` — all generated from `icona_PM.png`

## Role System

- `player` — auto-activated on registration, can submit/approve matches
- `manager` — requires admin approval, can access `viewCircolo()` (club admin panel: manage players, resolve disputes)
- `admin` — can approve manager registrations and clubs via the admin section in `viewProfile()`

## Security Constraints

- **Player full_name is NOT editable from the app** — must be changed directly in Supabase if needed
