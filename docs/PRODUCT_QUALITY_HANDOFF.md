# Kaidra product-quality rebuild — 2026-10-04

**Current follow-up:** [DISCUSSION_CHAT_DISCOVER_HANDOFF.md](DISCUSSION_CHAT_DISCOVER_HANDOFF.md) documents the deployed Discussion/direct-challenge/typing/receipt changes and the Anime provider repair. Anime Discover now uses AniList with real wide artwork; the Jikan timeout and prior provider limitations below describe the earlier pass, not the current browse implementation.

## 1. Result

Home is the personalised, social entry point. Discover is a separate catalogue browser with Movies, Series, Anime and Football hubs, contextual provider artwork, category sections, URL filters and independent search. Existing chat, groups, polls, receipts, sharing, private library, onboarding and PWA flows are retained.

Find People and search sheets follow VisualViewport height/offset and scroll results internally. Reactions use a compact, selected-state picker anchored around the message and clamped to the visible viewport. Dark/purple styling, responsive layouts, focus boundaries and reduced-motion behavior cover new screens.

Football is a hub within Discover and a preference-dependent section of Home. Existing football-data.org integration supplies real fixtures/scores/crests. Club and competition preferences affect Home ordering; per-match home/away/neutral support is separate. Opening a match verifies its provider snapshot server-side; final/awarded/cancelled status locks support permanently. Match cards can be shared into existing DM/group threads and opened by recipients. Match detail provides support, consenting friends' support, a written take and a contextual challenge.

Conversation-linked opinion battles support challenge, accept/decline/cancel, participant arguments, spectator voting, concession, mutually agreed draws and community results. Profiles show progression and own debate history. Results are labelled opinions. No client supplies winners or XP. Relationships require an existing friendship and both people's consent, with Close friends, Partners and Friendly rivals in an extensible catalogue. Privacy defaults to private and the stricter choice wins. Profile responses omit private DM identifiers; raw relationship rows are participant-only. Unfriend/block/removal ends active connections.

## 2. Files

- `app.html`, `css/product.css`: hubs, Home/social sections, settings and responsive presentation.
- `js/home.js`, `js/discover.js`, `js/router.js`, `js/search.js`, `js/football.js`: independent Home/Discover, browse destinations, real category search and club relevance.
- `js/social.js`: challenges, debate UI/history, relationship consent/privacy, title/match friend context, follow choices, reports and scoped social refresh.
- `js/ui.js`, `js/context-menu.js`, `js/inbox.js`, `js/profile.js`, `js/notifications.js`, `js/content-view.js`, `js/content-client.js`, `js/app.js`, `sw.js`: shared viewport/focus/reactions, chat integration, profiles, notification categories/routes/dismissal, content details, caching and browser-notification destinations.
- `supabase/functions/_shared/browse.ts`, `_shared/content.ts`, `content-api/index.ts`: actual Jikan/TMDB browsing, bounded request deduplication/cache, football metadata and trusted ingestion. `football-sync/index.ts` adds an explicit Request annotation.
- `tests/social-backend.sql`, `browse.test.mjs`, `edge-types.mjs`, `product-browser.mjs`, updated browser fixtures/smoke/live acceptance; this handoff and `PRODUCT_QUALITY_PLAN.md`.

## 3. Migrations

Migrations 20261009–20261012 were applied to the linked project after rolled-back schema/authorization/regression checks. The content-api Edge Function was deployed; frontend publication still uses the repository hosting flow.

Incremental migration order follows the project's existing history through `20261008`:

| Migration | Purpose |
| --- | --- |
| `20261009_social_activity_and_matches.sql` | Notification categories/preferences, private activity preferences, blocks/reports, friend recommendation decisions, trusted matches and per-match support |
| `20261010_conversation_battles.sql` | Conversation battles, posts/votes, results, progression and server reward ledger |
| `20261011_consensual_relationships.sql` | Relationship types, consent/privacy, safe profile response and friendship/block cleanup |
| `20261012_social_permission_hardening.sql` | Vote eligibility/rate checks, safe deletion/expiry, persistent anti-abuse counters/ledger, DM/block and membership safeguards |

All new tables have RLS. Clients receive limited SELECT access and use authorized RPCs to mutate state. Ingestion, rewards, notifications and private helper functions cannot be executed by ordinary users. Realtime publishes the necessary conversation/social tables; social_signals contain only owner IDs and revision timestamps.

The original repo still lacks a complete baseline for a fresh Supabase reset. Do not push all historical migrations blindly to a different project. These changes are targeted to the audited linked schema. Migration history is recorded with application.

## 4. Keys and settings

No new key is required for Jikan. Keep existing TMDB_API_READ_TOKEN (or TMDB_API_KEY) and FOOTBALL_DATA_TOKEN in Supabase Edge Function secrets. SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are platform-provided server variables. Never put provider/service keys in browser JavaScript or Git.

Streaming region defaults to Nigeria and can be changed. Football preferences are available from Home, a match, or Settings. Saved-pick/support sharing defaults to private; users can enable friends/public sharing in Activity & notifications. Relationship privacy and friend announcements remain independent and require both participants' consent. Category switches cover social recommendations, battles, connections, accepted friendships and football; existing football reminder settings remain in place.

## 5. Provider limits

- Anime uses [Jikan v4](https://docs.api.jikan.moe/), including real genres/themes and `/seasons` archive metadata. Years are not hardcoded. A year without a season prompts selection. The season endpoint lacks server genre filtering/global sort; Kaidra labels filtering/ranking as applying to each loaded provider page, with More titles available. Adult metadata is filtered. Archive/provider failures are isolated.
- Movies use [TMDB discover/movie](https://developer.themoviedb.org/reference/discover-movie); cinema is an origin filter, not a genre. Bollywood additionally filters Hindi. Animation/documentary/live-action use available genre metadata and may be imperfect when provider classification is incomplete.
- Series use [TMDB discover/tv](https://developer.themoviedb.org/reference/discover-tv) for genre, airing dates, ended/cancelled status, release dates and regional watch providers. Title search uses separate search endpoints because those do not support all discover filters.
- Football uses [football-data.org match](https://docs.football-data.org/general/v4/match.html) and [team](https://docs.football-data.org/general/v4/team.html) metadata. Coverage, news freshness and club lists depend on the configured plan and actual fixture window. Scores are data; links point to official highlights/streaming destinations, with no claim of licensed live match playback.
- Anime streaming references are provider-listed official destinations, explicitly not a regional availability guarantee. TMDB/JustWatch supplies regional movie/series availability.

## 6. Deliberately deferred

Games remain unavailable until a reliable licensed provider is configured. No invented game catalogue, arbitrary anime themes, football lineups/player statistics, unsupported match predictions, copyrighted live video or RPG engine is added. Separate character persona/combat engines are deferred; ordinary chat remains available for roleplay. This pass implements opinion battles.

XP safeguards: at least three eligible spectators and accounts older than seven days; no participant votes; 25 XP winner/5 other participant, at most 50 per day, rewards against the same opponent at most once per seven days. Concessions/draws do not award XP. Challenge creation is limited to five/day and one per pair/12 hours. Minimal attempt/reward ledgers survive conversation deletion. This reduces farming; it cannot prove human independence between colluding real accounts.

Friend title recommendations require max(3, ceil(25% of accepted friends)) distinct, consenting friends, exclude known/saved/completed/dismissed titles, persist one-time decisions and limit social recommendation notifications to one/day. Current friend counts are recomputed after privacy changes. Reports enter a private moderation queue; a moderation operations workflow remains required.

## 7. Validation

Observed results: model/provider-query unit tests passed; static asset/import/syntax checks and TypeScript semantic checks passed; the messaging/responsive, product, library, onboarding and PWA browser suites passed. Rolled-back SQL checks passed for all new social behavior and existing messaging/groups/media/onboarding. Live authenticated tests confirmed bidirectional DM/group WebSocket delivery, read clearing, polls/pins/reactions, private saved-media updates, battle acceptance/results and relationship consent/RLS; temporary accounts were removed. Live TMDB movie/series browse and real football fixture ingestion/support were verified. The combined live acceptance run stops at anime: Jikan returned `502 / UPSTREAM_TIMEOUT`, and archive metadata was unavailable. One later TMDB probe also hit a local HTTP transport timeout; previous live movie/series responses returned 20 real titles each. This is not an all-providers-passed result. No substitute or fabricated anime archive was seeded.

Commands use Node normally; this workspace runs them with `ELECTRON_RUN_AS_NODE=1 /usr/share/code/code` because standalone Node/npm are absent.

```sh
node --test tests/auth-model.test.mjs tests/feed-and-unread.test.mjs tests/message-state.test.mjs tests/browse.test.mjs
node tests/static-check.mjs
node tests/edge-types.mjs
node tests/browser-smoke.mjs
node tests/product-browser.mjs
node tests/library-browser.mjs
node tests/onboarding-browser.mjs
node tests/pwa-browser.mjs
KAIDRA_LIVE_QA=1 node tests/live-acceptance.mjs
KAIDRA_LIVE_QA=1 node tests/provider-live.mjs
```

SQL tests run against the audited linked schema inside rolled-back transactions: social permissions/recommendation deduplication/privacy/consent/support locks/results/reward replay, existing chat/groups/media replies/onboarding, plus deletion/abuse ledger regression. Browser fixtures are served only by test harnesses; they are never imported by production. Chrome checks 320–1600px layouts, keyboard viewport emulation, reaction bounds, real archive-shaped metadata, route/back behavior, support/preferences, challenges and relationship defaults.

`edge-types.mjs` uses TypeScript bundled with VS Code; remote Deno/npm dependency declarations and Deno globals remain a separate runtime check. Syntax checks and deployed Edge Function integration cover actual execution. A standalone Deno download timed out in this environment. There is no package.json build/lint pipeline to claim or invent. Physical Android/iOS keyboards, concurrent load, email delivery, background push and provider-plan changes still require operational/device testing.

## 8. Release/manual follow-up

Push and deploy the changed static files through the existing hosting flow; Supabase deployment does not publish frontend files. Check the release in two real accounts after hosting updates. HTTPS is required for installation; a custom domain is optional. Update Supabase auth redirect allowlists when adding a domain. The current PWA provides install guidance, a safe offline reconnect page and notifications while the app is open; background Web Push requires a separate push service and subscription implementation.

Review private `content_reports` through authorized moderation tooling. Keep scheduled `football-sync` execution and provider billing/quotas monitored. Enable social sharing explicitly when testing friend recommendations; private friends produce no fabricated friend activity. Screenshots and transient test output are stored under `/tmp/kaidra-qa`, outside the Git release.
