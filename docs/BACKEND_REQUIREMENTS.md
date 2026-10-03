# Backend requirements for Kaidra

The chat repairs 20261003/04/05 were validated against the deployed schema with rollback fixtures and applied transactionally in this session. content-api was deployed, the TMDB secret name was corrected, and live providers responded. Live authenticated REST/WebSocket/private-media checks also passed; their temporary data was removed. The repository still lacks a complete baseline, and migration history was not automatically backfilled. Do not reset production or blindly push every historical migration.

## Existing frontend contracts

| Surface | Data / operation | Behaviour without it |
| --- | --- | --- |
| Account and profile | Supabase auth, profiles, avatars bucket | Account/profile error; onboarding for accounts without a profile |
| Tastes | profiles.recommendation_preferences JSONB; interests | Save reports an error if the column is unavailable |
| Friends | friend_requests, profiles, mutual friendship RPC | Search/request errors are visible |
| DM | conversations, conversation_participants, messages, get_or_create_conversation | Failed sends retain the same message ID for retry |
| Reply | messages.external_ref_id, an existing optional reference field | A reply cannot be persisted without this field; same-conversation references are validated server-side |
| Shared recommendation/match/story | messages.shared_content JSONB | Shared send fails visibly rather than silently dropping the card |
| Groups | kaidra_create_group, kaidra_add_group_members, kaidra_leave_group, kaidra_inbox, kaidra_chat_state | Direct messages use a legacy fallback; creation reports group chat unavailable |
| Reactions | kaidra_react, message_reactions | Controls appear only when extended chat state is available |
| Reads | kaidra_mark_read, message_reads; legacy DM read_at | Legacy direct read update is attempted only if the RPC is absent |
| Notifications | app_notifications, sports_alert_settings, football-sync | Load/save failures and retry states |
| Admin | get_community_admin_dashboard, publish_special_event | Access denied/unavailable state; event form remains hidden |

Group creation requires at least one accepted friend, a nonempty title of at most 80 characters, and a maximum group size of 50 according to the current draft RPC. Only the creator can add members. Leaving a group must revoke access server-side; hiding its row in the client is insufficient.

## Review the current SQL drafts before deployment

The repository does not contain a complete reproducible baseline for the existing deployed project. Several base tables/functions and configured seed data are absent. Do not assume a fresh database reset or pushing all migrations will reproduce the current cloud schema.

The applied repair removes obsolete persona additions from the new draft, rejects null/missing share kind/title, validates replies against the same conversation, bounds interaction aggregation to loaded message IDs, serializes DM/group changes and preserves author/membership checks. Group reads use member-specific receipts. The voice bucket is private with conversation membership access, MIME/size limits and three-minute message duration validation. The required message/read/reaction/member/friend/notification tables are published for Realtime. Existing historical migrations and populated data were retained.

Operational follow-up: check sustained multi-device performance, email/OAuth delivery, scheduler execution, moderation/rate limits and migration-history reconciliation before further schema deployment. Current live checks do not substitute for those operational tests.

## Battles: required server system

There is currently no battle table, event stream, state engine, result endpoint or authoritative XP ledger in the inspected project. No invented HP, levels, wins or XP are displayed.

Battle mechanics have not been decided. Do not select Attack/Defend/Special rules, HP, cooldowns or XP formulas on the frontend. Once product rules exist, the server contract needs:

1. A persisted challenge between eligible real conversation members, with explicit accept/decline/cancel/expiry and authorized status transitions.
2. Server-authoritative actions and results appropriate to the selected mechanic; clients cannot supply outcomes or rewards.
3. Concurrency/version control and idempotent action IDs so retries cannot consume a turn or award twice.
4. Authorized event snapshots, spectator/participant permissions, reconnection and history pagination.
5. An authoritative progression ledger if progression is part of the chosen product.
6. Tests for outsider access, removals, stale/concurrent actions, duplicate transitions and reward replay.

`js/message-content.js` provides a presentation registration point for structured challenge/result events after those contracts exist. Dedicated profile/activity/notification destinations can consume the same authorized objects. No challenge controls or fabricated scores are exposed today.

## Relationships: required server system

There is currently no eligibility ledger, relationship/request table or privacy-resolving API. No relationship meter, fabricated status or pretend acceptance controls are shown.

Required contracts:
1. Track connection progress from validated interactions, with spam/replay protection and explicit eligibility thresholds.
2. Store a request between real users; neither eligibility nor an interaction automatically creates a relationship.
3. Explicit accept/decline/cancel/end transitions with authorization and idempotency.
4. Enforce each participant’s request preference/blocking and eligibility at both request and accept time.
5. Support the specified visible/hidden state and optional friend announcements. Resolve visibility according to both users’ consent for every reader, including profiles, search, event payloads and caches. Do not invent relationship categories or treat announcement consent as public visibility.
6. More-private changes take effect immediately. Public expansion requires both users’ consent; do not infer consent from a previous setting.
7. Store announcement consent separately from visibility. Notifications/announcements require the appropriate explicit consent and must stop when revoked.
8. Ended/private relationships must not leak through XP/activity logs, notifications, realtime payloads or public profile JSON.
9. Persist request/result notifications with safe deep links and allow users to disable these requests.
10. Test viewer-specific visibility, consent races, withdrawal, friend removal, blocks, retries and old cached announcements.

After backend support, add discreet connection information to profile/conversation context, a confirmation sheet, explicit request decisions and privacy settings. No dating-app style pressure or fictional character pairing.

## Provider coverage and operational setup

- TMDB: needs TMDB_API_READ_TOKEN in content-api secrets. Movies, series and Japanese animation are supported. Service/language/genre/taste filters and favourite seeds drive the existing recommendation endpoint.
- Football: needs FOOTBALL_DATA_TOKEN and the provider’s supported competition/access level. Match cards show scores/metadata and a timestamp, not embedded full match broadcasts.
- Regional streaming: country defaults to Nigeria; metadata comes from title-specific provider responses. Official service links are used. Availability varies by title and region.
- News: RSS headlines/snippets link to publishers; full articles are not republished.
- Games, comics/manga, wrestling, additional sports: need genuine licensed/authoritative provider adapters and category-specific metadata. They are not silently represented by movie results.
- Match highlights: official platform links exist; no licensed inline highlight video source has been integrated.
- Scheduled reminders: deploy football-sync with FOOTBALL_SYNC_SECRET and a protected external scheduler. No scheduler was configured by this frontend task.
- Browser notifications: explicit user opt-in; delivered while the app is running. Full background web push needs subscriptions, a sending service and service-worker push events; it is not currently implemented.
- Google login: requires enabled provider credentials and allowed redirects in Supabase. Mock tests cannot verify OAuth consent.
- Authentication: confirm Site URL, auth/reset/onboarding redirect allowlist, SMTP delivery and password policy against the deployed project.
- Future presence/typing: needs real authenticated Realtime presence/broadcast channels; none is fabricated today.

## Live verification still required

Use two real participant accounts plus an unrelated account to test membership/RLS, DM insert/update delivery, read receipts, retries, shared content visibility, reactions, group creation/add/leave, uploads and notification privacy. Confirm actual provider responses in Nigeria and another configured region. Check worker authorization and scheduled reminders. These are integration checks; the isolated frontend browser suite is not a replacement.
