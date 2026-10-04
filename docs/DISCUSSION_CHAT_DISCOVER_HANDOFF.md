# Focused Discussion, chat and Anime follow-up — 2026-10-04

The existing schema, RPCs, RLS, message/realtime code, battle entry points, Discover adapters and responsive styles were inspected before changes. This follow-up preserves the working Series banner, normal messaging, group controls, polls, sharing and the existing opinion battle engine.

## 1. Files changed

- `app.html`, `css/product.css`: compact Discussion composer/cards, typing status, receipts, swipe feedback, message density and Anime cover fallback.
- `js/chat-interactions.js` (new): Discussion cards, touch/pen swipe replies, private ephemeral typing and receipt presentation.
- `js/inbox.js`: Discussion mode and commands, contextual menus, author edit/delete, per-message acknowledgements, refresh routing, keyed thread rendering, keyboard/history handling and private photo/voice-note forwarding.
- `js/social.js`, `js/chat-groups.js`: direct and Discussion challenge entry, opponent selection, invitation actions and original-Discussion navigation.
- `js/supabase-client.js`, `js/message-state.js`: delivery subscriptions and deleted-message previews.
- `supabase/functions/_shared/anime.ts` (new), `_shared/browse.ts`, `content-api/index.ts`, `js/discover.js`: real Anime browsing/details/metadata/artwork, preserving MyAnimeList title IDs and the Series banner.
- `app.html`, `auth.html`, `index.html`, `onboarding.html`, `signup.html`, `reset-password.html`, `js/pwa.js`: generic mobile-web-app-capable metadata and user-triggered installation.
- New `tests/discussion-backend.sql`, `discussion-browser.mjs`, `discussion-live.mjs`, `anime.test.mjs`, `anime-live.mjs`; updated browse/browser fixtures and challenge assertions. This report covers this follow-up; other dirty files include the earlier product-quality work described in `PRODUCT_QUALITY_HANDOFF.md`.

## 2. Migrations added and deployment

`20261013_discussions_and_chat_interactions.sql` adds explicit Discussion messages/positions, immutable voted claims, delivery-recipient snapshots, acknowledgement/edit RPCs and direct/contextual challenge validation. `20261014_typing_membership_scope.sql` rotates private typing topics when membership changes and serializes position changes against membership removal.

Both migrations are applied and recorded on linked project `skmlktywdmsbjyybtmhm`. The updated `content-api` is deployed and live-tested. No new API key is needed for AniList. Existing TMDB and football secrets remain server-side. Do not blindly replay all historical migrations: the repository still lacks a complete fresh-install baseline.

Frontend publication remains outstanding and uses the existing Git/hosting flow:

```sh
git add .
git commit -m "Add discussions, direct challenges and real anime banners"
git push
```

After hosting updates, refresh/reopen Kaidra. No commit or push was performed by this follow-up.

## 3. RLS and server authorization

Positions have a unique `(discussion_message_id, user_id)` key. Direct table mutations are denied; the authenticated position RPC derives the user, verifies current conversation membership/send permission, rejects author votes and replaces a previous position. Raw position SELECT exposes only the reader's own accessible positions so an unvoted reader cannot reconstruct the split. Authorized summaries return totals but null split counts until that reader votes. Reactions remain independent.

Delivery rows are readable only within accessible conversations; acknowledgement changes only the caller's expected-recipient row and, when actually seen, their read row. Author editing/deletion is validated server-side. Discussion editing permanently locks after the first response, including if that response is later removed. Challenge creation checks the real Discussion FK and opposing participants; only the invited target can accept/decline. Existing friendship/block/battle rate limits remain enforced.

Typing uses private Realtime presence channels authorized against membership and the conversation's current topic revision. Membership changes rotate the topic because authorization can remain cached on an existing connection. Removed users cannot join the new topic or receive future presence there. See [Supabase Realtime authorization](https://supabase.com/docs/guides/realtime/authorization).

## 4. Discussion implementation

`+ → Start discussion` transforms the existing composer with a purple mode label, explanatory placeholder and cancel control. Sending resets it. `.discuss <statement>` is the same explicit message type; no automatic classification occurs.

Cards separate structured Agree/Disagree from emoji reactions, show respondent totals, hide group percentages before voting, and replace a position when switching sides. Authors cannot vote/count themselves. DMs use named responses and an optional Settle it invitation; groups use percentages and eligible opposing-person selection. Owner-specific scoped chat signals trigger authorized summary refreshes without broadcasting raw vote rows.

## 5. Direct and contextual challenges

`.challenge @username [optional flavour]`, profile/DM actions and group-member actions create direct invitations without a Discussion or typed stance. The command is not posted as chat text. Cards expose Accept/Decline only to the target, with server validation.

Discussion Challenge/Settle it stores the actual original message reference and validated opposing sides; the author implicitly supports the claim without adding a vote. Acceptance is required. View discussion navigates to and highlights the original. The existing opinion/contextual debate engine is retained; direct challenge records do not invent an additional combat engine.

## 6. Swipe-to-reply and chat presentation

Touch/pen swipes move the message with the finger, progressively reveal the reply icon and activate at 60px with optional haptics. Short swipes reset; vertical/diagonal motion and pointer cancellation preserve scrolling. Incoming, outgoing and Discussion messages are supported; long press remains available. Quotes show a compact author/snippet and jump/highlight their original.

Consecutive messages group naturally with tighter spacing. Keyed rendering preserves active gestures and media elements. VisualViewport changes keep the composer and latest messages visible when previously near the bottom, while preserving intentionally viewed history. Sending shows the new message. Photo/voice-note forwarding copies the private object into the destination conversation's folder rather than passing a source signed URL.

## 7. Typing and receipts

Typing is throttled private presence, not a database message. It expires, stops on idle/blur/hide/close and cleans up subscriptions; displayed names resolve from actual conversation members.

One tick means persisted/sent. Two ticks require recipient-client delivery acknowledgements; colored ticks require actual visible-message reads. A group message snapshots each expected recipient and reports partial delivery/read counts in its accessible label. Seen acknowledgements skip hidden documents and covered threads; loading an old page does not mark all of it read.

## 8. Anime root cause

Observed `502 / UPSTREAM_TIMEOUT` responses came from the existing Jikan upstream path; the provider could not be reached during live checks. This was separate from the PWA console messages. The old Anime payload also primarily supplied portrait covers, leaving the wide hero without a suitable backdrop.

The deprecated capability warning is addressed by adding `mobile-web-app-capable`. Chrome's deferred-install-banner message is informational: Kaidra saves the install event and calls `prompt()` when the user presses Install. Pages without that control no longer suppress the browser prompt.

## 9. Anime fix

Authenticated Edge Function Anime browse/metadata now uses real AniList GraphQL data with bounded timeouts, cache/deduplication and honest failure states. Detail resolves by MyAnimeList ID, retaining saved/shared title identity; the legacy Jikan detail fallback remains. Titles without a MAL mapping are omitted rather than assigned a conflicting ID.

The hero prefers the current result set's real `bannerImage`. Cover-only results produce a contextual cover collage instead of stretching a portrait poster. Genre/tag filters are provider metadata, combined server-side; historical year/season navigation uses actual catalogue date bounds. Calendar years do not promise that every season contains titles. Empty seasons remain empty. Old numeric Jikan filter links ask for a reset instead of silently changing meaning. No static unrelated artwork is inserted. Series still uses its existing full-width TMDB backdrop and readable overlay.

## 10. Tests and build results

Passed:

- Five unit suites: auth, feed/unread, message state, browse and Anime provider contracts.
- Static DOM-ID/asset/import/browser-JS/Edge-syntax checks, six Edge TypeScript semantic files and `git diff --check`.
- Rolled-back database checks for the new migrations and existing messaging, groups, media/replies and social authorization.
- Focused Chrome checks for ordinary menus, Discussion mode/commands/switching/refresh/reactions, group split visibility, DM contextual invitation, direct commands, touch gestures/reply navigation, keyboard latest/history, typing expiry, receipt transitions and private media-forward paths.
- Broad responsive smoke checks at 320–1600px, product flows and install/manifest/private-cache/offline reconnect checks.
- Live authenticated DM/group WebSocket delivery, Discussion updates, independent reactions, per-recipient receipts and target-only challenge acceptance.
- Live private typing/stop, outsider rejection, public/private-topic isolation and membership-removal topic rotation.
- Live deployed Anime metadata (18 genres, 361 nonadult tags), Popular (24 real titles), Romance, Isekai, Fall 2010, Fall 2026, New and MAL-identity detail; real wide artwork and existing Series TMDB backdrops returned. Cover-only rendering also passed the browser fallback check.

Temporary live-test accounts were removed and the database count was confirmed zero. Screenshots are under `/tmp/kaidra-qa`, outside the release.

Reproducible commands (use Node normally; this workspace uses `ELECTRON_RUN_AS_NODE=1 /usr/share/code/code`):

```sh
node --test tests/auth-model.test.mjs tests/feed-and-unread.test.mjs tests/message-state.test.mjs tests/browse.test.mjs tests/anime.test.mjs
node tests/static-check.mjs
node tests/edge-types.mjs
node tests/discussion-browser.mjs
node tests/browser-smoke.mjs
node tests/product-browser.mjs
node tests/pwa-browser.mjs
KAIDRA_LIVE_QA=1 node tests/discussion-live.mjs
KAIDRA_LIVE_QA=1 KAIDRA_TYPING_ONLY=1 node tests/discussion-live.mjs
KAIDRA_LIVE_QA=1 node tests/anime-live.mjs
```

Run browser suites sequentially because they share local ports. SQL tests intentionally roll back fixtures. There is no package build/lint pipeline in this repository. Edge semantic checks exclude external Deno declarations; deployed integration checks verify actual execution, but a standalone full Deno check was unavailable.

## 11. Intentionally deferred

Pets/creatures and battle expansion remain deferred as requested. No football-provider replacement or unrelated Discover redesign was introduced. Physical Android/iOS keyboard and haptic testing, sustained multi-device load and real uploaded-media playback after forwarding still need device checks; Chrome covered touch input, simulated viewport changes and media-copy paths. Provider uptime/quota cannot be guaranteed. Background push and the operational items in the previous handoff remain separate work.
