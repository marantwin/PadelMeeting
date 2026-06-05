# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PadelMeeting is a mobile-first PWA for Italian amateur padel clubs. It manages players via an ELO-based rating system ("PR" — Punteggio di Ranking) with six bands (Ferro → Élite). No build step — the entire application is a single `index.html` with all CSS and JavaScript embedded inline. Supabase handles auth and database.

## Development Workflow

There is **no build process, no npm, no bundler**. Development is:
1. Edit `index.html` directly
2. Open in browser (or run a static server: `python -m http.server 8080`)
3. The Supabase anon key is intentionally embedded in the client (Row Level Security enforces access control server-side)

Service worker versioning: bump `padelmeeting-v25` in `sw.js` when deploying changes that need cache invalidation.

## Architecture

### Single-File SPA (`index.html`)

The entire application — routing, state, UI rendering, auth, data fetching — lives inside `index.html`. Structure:

- **CSS** in `<style>`: design tokens, layout, all component styles
- **JS** in `<script>`: app state, Supabase client, view functions, helpers
- Entry point: `initAuth()` → checks Supabase session → calls `loadPlayers()` then `render()`

**State variables** (all global):
```js
let players = [];   // All active pm_profiles rows
let matches = [];   // Recent matches for current user
let ME = null;      // Current user profile ID
let tab = 'home';   // Active view: home | rank | play | matches | organize | profile | circolo | rules
let auth = { tab, role, user, loggedIn }
```

### Tab-based Routing

`render()` is the single re-render function — it clears `#main` and calls the appropriate `view*()` function based on `tab`. Navigation calls `setTab(name)` which updates `tab` and calls `render()`. There is no URL-based routing.

### Supabase Tables

| Table | Key Columns |
|---|---|
| `pm_profiles` | id, full_name, club, city, provincia, rating, games, streak, role (player/manager/admin), status (pending/active/rejected) |
| `pm_matches` | id, played_at, club, winner (A/B), score, status (pending/approved/disputed), submitted_by, team_a1/a2, team_b1/b2, delta_a1/a2/b1/b2 |

**RPC functions**: `pm_get_pending_managers()`, `pm_set_profile_status(profile_id, new_status)`

Supabase client is initialized at the top of the script:
```js
const sb = supabase.createClient('<url>', '<anon-key>');
```

### ELO Rating Logic

```js
dynK(games) => 4  // Fixed K factor
teamAvg(ids)      // Mean rating of a 2-player team
computeMatch(team1ids, team2ids, format, winnerTeam)
  // E = 1 / (1 + 10^(−diff/50))
  // delta = K * (1 − E) win / K * (0 − E) loss
```

Match approval workflow: submitted → `pending` (48h window for opponent to dispute) → `approved` (ratings updated) or `disputed` (manager resolves).

## Design System

**CSS custom properties** (defined in `:root`):

| Variable | Value | Use |
|---|---|---|
| `--void` | `#0E2723` | Main background (dark teal) |
| `--neon` | `#5BF0CB` | Primary accent (bright teal) |
| `--ivory` | `#F7F0DC` | Body text |
| `--rust` | `#E07B4A` | Warnings, negative deltas |
| `--gold` | `#EFD06A` | Highlights, wins |
| `--danger` | `#F06A80` | Errors |
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
- New players start in `pending` status. The club manager assigns the **initial PR** by choosing one of three fixed levels after observing the player in person:

| Level | PR | Profile |
|---|---|---|
| Principiante | 20 | Started recently or plays occasionally, no competitive experience |
| Intermedio | 40 | Plays regularly for some time, knows rules and dynamics well |
| Avanzato | 60 | Advanced player with consolidated experience in competitions and tournaments |

- Matches played before the initial rating is assigned cannot be registered retroactively.
- Three fixed levels instead of a free scale (0–70) ensures consistency across clubs in a league — a manager cannot be "generous" or "strict" beyond a 20-point gap.

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

### ELO Formula (D=50, K=5→4)
- `E = 1 / (1 + 10^(−diff/50))` where `diff` = mean PR team A − mean PR team B
- Win: `Δ = K × (1 − E)` / Loss: `Δ = K × (0 − E)`
- **K=5 for first 5 classified matches**, then **K=4 from match 6 onward** (counted on the player's total career matches, not per club/league)
- In a perfectly even match (50/50): ±2.5 pts during calibration, ±2.0 pts in standard regime

### Classified Match Conditions
A match only affects PR if **all four conditions** are met:
1. All 4 players are registered with an assigned PR
2. All 4 players verbally agree it's classified **before the first point**
3. Format is best-of-3 sets with **Punto Secco** tie-break
4. Result is approved within 48h by at least one opponent (or validated by the manager)

**Punto Secco**: at 40-40, play advantage; if deuce again, one decisive point decides the game.

### Win Streak Bonuses
Consecutive wins in classified matches award bonus PR (applied on top of normal delta):
- 3 wins in a row: **+1 pt** bonus
- 5 wins in a row: **+2 pts** additional bonus
- 10 wins in a row: **+5 pts** additional bonus
- The streak resets to 0 on the first loss (all stars lost).

### Inactivity Penalties
Triggered after **30 consecutive days** without a classified match:
| Period | Penalty |
|---|---|
| Day 30 | −1 pt |
| Each subsequent week (month 1) | −1 pt/week |
| From month 2 onward | −2 pts/week |
| After 4 months total | Removed from ranking |

The app warns the player 7 days before the first penalty. The manager can suspend the inactivity counter (e.g. for injury); it restarts from zero on return.

### Match Abandonment
- **Justified** (injury, family/work emergency — communicated to manager within 24h): counts as a normal loss, no extra penalty.
- **Unjustified** (no reason given within 24h): normal loss **+ −5 pts** + one warning on profile.
- **2 warnings in 3 months** = automatic 2-month ban from classified matches.

### Manager Powers & Limits
- Assigns initial PR to new players (max 70) — cannot change PR directly after that
- Validates results not approved within 48h
- Has final say on disputed matches
- Can suspend inactivity penalty counter for a player
- Cannot retroactively insert matches or override ELO calculations

## Other Pages

- `landing.html` — Marketing page with animated canvas padel court; standalone, no shared code with `index.html`
- `overview.html` — A4 print-friendly feature guide; standalone
- `regolamento.html` — Full official ruleset; standalone
- `sw.js` — Service worker with cache-first strategy; precaches `index.html` + icons

## Role System

- `player` — auto-activated on registration, can submit/approve matches
- `manager` — requires admin approval, can access `viewCircolo()` (club admin panel: manage players, resolve disputes, set initial ratings)
- `admin` — can approve manager registrations via the admin section in `viewProfile()`
