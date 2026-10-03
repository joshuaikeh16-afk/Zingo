# Kaidra release handoff — 2026-10-03

The frontend, private library/group schema, and onboarding schema now agree on the linked Supabase project `skmlktywdmsbjyybtmhm`. The incremental migrations **20261006, 20261007 and 20261008 have been applied**, following the previously applied 20261003–20261005 repairs. A read-back confirmed all five existing profiles are still complete, the new columns/functions exist, and the chat/library tables are published for Realtime. Temporary live QA users and conversations were removed.

## Account flow

Account creation asks for email and password. It calls real Supabase Auth, prevents duplicate submissions, validates inputs, supports password visibility and Caps Lock feedback, and displays connection/error states. When confirmation is required, users see a verification screen with resend cooldown, refresh recovery, and an option to correct their email. An active verified session resumes setup. Returning users with a completed profile go to For you. Google sign-in appears only when the project reports that provider enabled.

Authenticated setup has four steps:

1. Display name, case-insensitive unique username, optional avatar or initials.
2. Movie, series, anime and football interests. At least one is required; these categories have current content integrations.
3. Relevant genres, region, original language and optional streaming services. Nigeria is the default.
4. Up to three optional favourite titles from the connected catalog. Unavailable catalog results can be skipped.

Back, browser history, refresh and failed saves preserve the draft. Drafts are private per user in `onboarding_drafts`, with a local device checkpoint that never stores passwords or email. Final completion atomically updates the existing profile identity/preferences and seeds supported favourites into the existing library. Availability checks improve feedback; the database uniqueness constraint resolves concurrent claims. Existing account UUIDs, friendships, conversations and profile identities are retained. Existing completed users are not sent through setup again.

Changed account files: `auth.html`, `signup.html`, `onboarding.html`, `js/auth.js`, `js/auth-model.js`, `js/onboarding.js`, `js/supabase-client.js`, `css/auth.css`, `css/tastes.css`, and migration `20261007_resumable_onboarding.sql`.

## Exact Watchlist 400 diagnosis and repair

The existing production table was `public.user_watchlist`. The failing request selected `provider,media_type,external_id,title,cover_url,snapshot,is_favorite,is_watchlisted` and ordered by `created_at`. Its response was HTTP **400**, SQLSTATE **42703**, with message **`column user_watchlist.provider does not exist`**. Other required collection fields were also absent. `created_at` already existed; it was not the failing column. This was a deployed-schema mismatch, not a reason to replace the table or hide the error.

Migration 20261006 extends that same table, backfills legacy MAL entries, and adds provider-aware uniqueness, separate favourite/watchlist flags and owner-only access. Migration 20261008 preserves explicit provider identity so equal TMDB/MAL IDs cannot collide. Legacy MAL detail routes keep their provider instead of opening an unrelated TMDB title.

The shipped Supabase JS bundle inspected during diagnosis (2.117.2, through the existing `@2` CDN import) retries network failures and HTTP 503/520 with bounded backoff and respects Retry-After. It does not retry these 400 responses. Repeated requests originated from separate app initialization/profile/realtime paths. `js/library.js` now shares an in-flight request, remembers deterministic schema/auth failures, and stops automatic reloads for 400/401/403/404. Profile has an explicit Retry action. Successful saves remain optimistic with rollback on failure; favourites and watchlist flags are independent.

Live checks ran the exact previously failing query successfully, saved both flags to one row, removed one flag while retaining the other, and verified another authenticated user could not read the library. Realtime library events also arrived. Rolled-back SQL tests verified legacy provider separation.

## Chat and groups

The earlier pushed UI referenced schema that had not yet been deployed, which broke sends and library loading. That incomplete handoff is repaired: messages now have the expected mention fields; group roles, controls, polls, pins and library RPCs exist in production.

Conversations use Supabase WebSockets. The client reconciles snapshots on reconnect/visibility rather than repeatedly polling the inbox. Unread counts sum individual unread messages, and viewing a conversation records per-user receipts. Rich title/match/news shares send immediately to the selected DM/group. Replies link back to the original message; mention labels preserve the original user identity after renaming. Message actions use hover/context/long-press menus.

Group creation separates member selection from name/photo. Owner/admin permissions are enforced by server RPCs. Ownership transfer is explicit before an owner leaves. Polls, votes, pins, mute, mentions and shared history are connected to membership policies. Removal closes the thread and associated overlays and clears its cached DOM. An authenticated removal signal lets the client refresh even after access is revoked. Voice recording/upload/playback remains available from the composer.

With simultaneous live authenticated accounts, checks passed for bidirectional DM/group WebSocket inserts, read receipts and cleared unread totals, poll creation/votes, pins, reactions, library updates and removal signals. An unrelated account did not receive those messages. After removal, the former group member could not query history/state and received no subsequent messages.

## Installation, CSS and motion

Kaidra now includes `manifest.webmanifest`, branded 192/512/maskable icons, Apple touch icon, `js/pwa.js`, `sw.js` and `offline.html`. Settings → **Install Kaidra** uses the browser's native install prompt when available; otherwise it explains the browser menu or iOS Share → Add to Home Screen. App shortcuts open Messages and Discover. Standalone layout respects device safe areas.

Deploy the entire repository's static frontend at the root of an **HTTPS** site. A custom domain is optional; HTTPS hosting supports installability. Manifest/icon URLs must return their actual files rather than a rewritten app page. Serve the manifest as `application/manifest+json`, JavaScript as JavaScript, and icons as PNG. [Browser installability requirements](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).

The service worker caches only the public reconnect page and icons. It does not cache authenticated HTML, API responses, private chat data or libraries. Network failure on a page visit shows a reconnect screen; retry reloads the current destination. Updates activate on a subsequent launch rather than interrupt a message draft or recording. Installation alone does not add background push or offline chat.

Visual finishing keeps the permanent black/purple design: responsive setup typography, subtle step transitions, card hover/press feedback, focus outlines, safer message wrapping and standalone spacing. Reduced-motion settings disable decorative effects.

## Validation and deployment

Validation performed:

- Static DOM IDs, local assets/imports, browser JS and Edge Function syntax; message-state, feed/unread and auth-model assertions.
- Full browser interaction suite: discovery, hero, routing/history, friends, DM send/retry/reply/reaction, reconnect, voice recording, groups, library actions/rollback, shares, profiles, settings and notifications. Main layouts checked at 320/360/390/430/768/1280/1366/1600 pixels.
- Fresh-account browser suite: invalid inputs, duplicate-submit guard, verification refresh/cooldown, username conflict, private resume after reload, failed-save recovery, Back, optional unavailable favourites, completion and continued chatting. Account layouts checked at 320/360/375/390/412/430/768/1280/1600 pixels, including a small viewport representing an open keyboard.
- Focused library browser checks: the exact 400, shared concurrent requests, no automatic 400/401/403/404 repeats, explicit recovery, and updates arriving during an older snapshot.
- Chrome manifest validation, native-prompt handler and installation instructions, cache contents, actual server disconnection/offline fallback and reconnect.
- Rolled-back SQL regression suites: `chat-backend.sql`, `group-controls.sql`, `onboarding-backend.sql`, `media-reply-backend.sql`.
- Live authenticated HTTP/WebSocket checks described above, followed by cleanup and schema/profile read-back.

Browser fixtures are isolated from production and are never a production content fallback. Screenshots and local logs are in `/tmp/kaidra-qa/` and `/tmp/kaidra-*-latest.log` on this machine. The opt-in `tests/live-acceptance.mjs` requires Supabase CLI authentication and `KAIDRA_LIVE_QA=1`; it creates and removes temporary test accounts/chats. Never commit provider secrets or service-role credentials.

To publish these changes, push the frontend files and ensure the static host redeploys them. **This linked database does not need these migrations applied again.** For a different Supabase project, inspect its baseline and apply the compatible incremental migrations before publishing the frontend. Historical migration tracking is not reconciled; do not reset production or blindly run a blanket migration push.

Configure Supabase Auth's Site URL and allowed redirect URLs for the deployed origin's `/auth.html` and `/reset-password.html`. Real mailbox delivery, Google OAuth configuration, physical-device installation and closed-app/background push were not verified. Browser installation UI varies by device. Prolonged production load, scheduled workers and every historical data variant are outside these acceptance checks; this is not a claim of a flawless app.
