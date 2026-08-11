# Kaidra

Vanilla HTML/CSS/JS + Supabase. Static site, no build step required — deploy as-is on Vercel.

## Structure

- `index.html` — redirects to `/auth.html`
- `auth.html` + `js/auth.js` — sign in / sign up (real Supabase calls)
- `onboarding.html` + `js/onboarding.js` — username, birthdate (13+ gate), interests, avatar (real Supabase calls)
- `app.html` + `js/app.js` — main app shell (5-tab nav: Home/Friends/Compose/Inbox/Profile). **UI interactivity (tab switching, modal open/close) is wired. Real data-fetching (YouTube feed, Friends statuses, Inbox messages, Profile stats, Discover search) is NOT yet wired — currently shows placeholder sample content.**
- `js/supabase-client.js` — shared Supabase client + `requireAuth()`/`requireProfile()` helpers
- `css/styles.css` — compiled Tailwind CSS (visual design by Google AI Studio, compiled to a static file so no build step is needed on deploy)

## Status

- Auth + onboarding: fully functional, tested against the live Supabase schema
- App shell UI (nav, modals, view switching): functional
- App shell data (Home feed, Friends, Inbox, Profile, Discover): **not yet wired to Supabase** — next build step

## Backend

Supabase project `skmlktywdmsbjyybtmhm` — full schema, RLS, storage buckets, and two Edge Functions (`youtube-feed`, `spotify-search`) already live.
