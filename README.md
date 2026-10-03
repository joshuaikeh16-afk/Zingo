# Kaidra

Kaidra is a social entertainment discovery app: personalised recommendations, real movie/series/anime metadata, entertainment news, optional matchday content, friends, and conversations. It uses static HTML, modular CSS, browser ES modules, and Supabase. There is no frontend build step.

## Run locally

Serve the repository over HTTP:

```sh
python3 -m http.server 8000
```

Open http://localhost:8000. Production pages use the Supabase URL and public publishable key in `js/supabase-client.js`. API credentials belong in Edge Function secrets. Local browser tests replace the Supabase import with isolated fixtures; production never falls back to those fixtures.

## Frontend

- `app.html`: For you, Discover, Friends, Inbox, Profile; desktop sidebar and mobile bottom navigation.
- `css/main.css`: permanent dark tokens, typography, motion and accessibility foundations.
- `css/components.css`, `layout.css`, `entertainment.css`, `friends.css`, `chat.css`, `profile.css`: reusable surfaces and responsive screens.
- `js/router.js`, `search.js`: dedicated user/title/match/conversation destinations, browser history and global search.
- `js/ui.js`, `icons.js`, `media.js`: safe DOM components, modal/focus management, local icons, artwork fallback, recommendation cards and hero.
- `js/inbox.js`, `chat-groups.js`, `voice-notes.js`, `message-state.js`, `message-content.js`: DM/group interfaces, shared content, replies, reactions, optimistic sends, stable retry IDs, reconnect recovery and message ordering.
- `auth.html`, `signup.html`, `reset-password.html`: email/OAuth entry and recovery.
- `onboarding.html`: identity, formats/genres, streaming region/language/services and favourite titles.
- `admin.html`: existing restricted community statistics/event publishing.

The app has no publishing/creation tab, inbox AI, Spotify surface, character persona controls, or theme switch. Profile banner accents customise a profile, not the app theme. Only connected entertainment categories are displayed. Battle/relationship/XP surfaces require real backend systems; see [backend requirements](docs/BACKEND_REQUIREMENTS.md).

## APIs and deployment dependencies

The current content integration uses `content-api` for TMDB discovery/detail/trailer/provider information, BBC RSS headlines and football-data.org fixtures. `football-sync` delivers subscribed event reminders into saved in-app notifications.

Required provider secrets:
- `TMDB_API_READ_TOKEN`
- `FOOTBALL_DATA_TOKEN`
- `FOOTBALL_SYNC_SECRET` for the scheduled football worker

Supabase supplies the Edge runtime project keys. The service-role key must remain server-side. Review the deployed schema and the existing migration drafts before deploying functions or SQL. The selected chat, library/group and onboarding repairs (20261003 through 20261008) were applied transactionally to the inspected cloud database, and content-api was deployed. See [the current release handoff](docs/ONBOARDING_AND_INSTALL.md). The repository does not contain a complete reproducible database baseline; do not reset production or blindly push all historical migrations. The repair was applied through the Management API, rather than a blanket migration push; migration history was not automatically backfilled.

### Deploy the content function

Install the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) first. On this machine it is installed locally in `.tools/supabase/`; add that directory to your current terminal's PATH from the repository root:

```sh
export PATH="$PWD/.tools/supabase:$PATH"
supabase --version
supabase login
supabase functions deploy content-api --project-ref skmlktywdmsbjyybtmhm --use-api
```

The explicit project reference means `supabase link` is optional for this deployment. `--use-api` bundles on Supabase's servers, so deploying this function does not require Docker. These commands deploy only the content function and do not apply database migrations.

For a new deployment, save the TMDB **API Read Access Token** as `TMDB_API_READ_TOKEN` (or the short v3 key as `TMDB_API_KEY`) in the project's **Edge Functions → Secrets** dashboard. Keep the token server-side. Then sign in to the app and reload For you or Discover. Football fixtures additionally require `FOOTBALL_DATA_TOKEN`.

Missing credentials, unavailable feeds and absent group RPCs produce explicit unavailable/retry states. An interface being connected to an RPC does not prove that RPC exists in production.

## Fast messaging / WebSockets

The required chat tables are now in the live Realtime publication, and authenticated WebSocket delivery/read/reaction events were verified with temporary accounts. The client subscribes through Supabase Realtime; no separate FastAPI WebSocket server is needed for this implementation. In the Supabase dashboard, enable the relevant existing tables in the `supabase_realtime` publication, with membership-based SELECT policies. These include `messages`, `friend_requests`, `app_notifications`, `message_reactions`, `message_reads`, `conversation_participants`, `conversations`, `chat_signals`, `chat_polls`, `poll_votes`, `message_pins`, `message_mentions` and `user_watchlist`.

First inspect publication membership:

```sql
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime';
```

Only add existing, reviewed tables that are absent. Verify two authenticated members receive inserts/updates and an unrelated account receives nothing. “Connected” indicates subscription status, not a proof that publication/RLS configuration is correct. The UI also reconciles snapshots after reconnect and on return to the page. There is no recurring 30-second inbox polling. Group read receipts and membership changes need their own publication entries for immediate updates.

See [Supabase Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes) and [troubleshooting](https://supabase.com/docs/guides/troubleshooting/realtime-postgres-changes-troubleshooting).

## Verification

With a recent Node runtime:

```sh
node tests/static-check.mjs
node tests/message-state.test.mjs
node tests/feed-and-unread.test.mjs
node tests/auth-model.test.mjs
# Starts a local fixture server and headless Chrome automatically:
node tests/browser-smoke.mjs
node tests/onboarding-browser.mjs
node tests/pwa-browser.mjs
node tests/library-browser.mjs
```

The browser suite serves only local fixtures on 127.0.0.1:8765 and checks interaction flows and layout widths 320, 360, 390, 430, 768, 1280, 1366, 1600. Screenshots are written to `/tmp/kaidra-qa/`. The browser suite itself uses fixtures. Separate live checks verified RLS, real provider responses, authenticated WebSocket delivery, read/reaction events and private voice storage. Email delivery, OAuth configuration, prolonged load/latency and scheduled jobs remain unverified.

See [the implementation and QA notes](docs/FRONTEND_REBUILD.md) for scope and remaining gaps.

## Install on a device

Deploy the static files at the root of an HTTPS site. In Settings, choose **Install Kaidra**, or use your browser’s install menu. On iPhone/iPad, use Safari → Share → Add to Home Screen. A custom domain is optional. Keep `manifest.webmanifest`, `sw.js`, `offline.html` and the `assets/app-icon-*` files in the deployment.

The installed app opens in its own window. Offline visits show a reconnect screen; private messages and library responses are not cached. Installation does not enable closed-app push notifications. See [deployment and validation details](docs/ONBOARDING_AND_INSTALL.md).
