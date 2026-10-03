# Kaidra product and interaction audit (3 October 2026)

## Current implementation

Static HTML, browser ES modules and plain CSS. `index.html` redirects to auth. Signup/signin/recovery use Supabase Auth; `session.js` shares one authenticated profile check. Missing profiles go through the three-step taste setup. Admin is separately guarded by server RPC authorization. The optional Python backend is not called by this frontend.

The shell loads main/components/layout/entertainment/friends/chat/profile CSS. Auth loads main/components/auth; onboarding loads main/components/tastes; admin loads main/components/admin. The old styles directory and CSS for videos, watchlists and news have no remaining HTML/import references. Keep historical database migrations; they describe older deployed schemas.

Home and Discover call the authenticated content-api Edge Function. TMDB supplies real artwork, detail, trailers and regional JustWatch availability. football-data.org supplies match objects; BBC supplies news. Preference fields are `profiles.interests` and `recommendation_preferences`. Never put provider secrets in frontend configuration. Content failures must be local to their section.

Friends use accepted/pending friend_requests plus profiles. Inbox uses kaidra_inbox, kaidra_chat_state, kaidra_mark_read, group RPCs, messages, per-recipient message_reads and reactions. Private voice objects are stored under conversation membership paths. Message IDs remain stable across optimistic sends, storage retries and realtime echoes. Realtime subscriptions reconcile with snapshots and polling. Actual online presence/typing is not implemented.

## Problems found

Navigation replaces the current hash instead of creating object history. Other-user profiles overwrite the My Profile pane. Football category redirects into Home. Title and conversation selections have no persistent destination. Find People searches usernames only and incoming requests lack an immediate Decline action. The profile accent selector offers two values rejected by the live database. Headers, sidebar promotion, empty states and repeated slogans consume useful viewport space. All require coordination between markup and handlers, not only CSS edits.

## Dependencies to preserve

`app.js` owns tab activation, protected forms, modal focus, settings and viewport sizing. `ui.js` owns safe DOM creation, avatar/artwork fallback, modal stack/inert and semantic navigation events. Feature modules subscribe to kaidra:tab-change, friends-data, inbox-data, message-user, open-thread and share-content. Main IDs are used across modules: conversation-list, chat-view-drawer, message-thread-container, profile-*, home-friends/home-conversations, content-region, content-detail-*, alerts-*, and group-*.

Keep edit-profile and recorder IDs stable; add a separate user-profile view. Establish a hash router for primary destinations and user/title/match/article/conversation objects. Route-aware modal closing must support Back without recursion or reopening an already closed sheet. Do not mark unseen new messages read optimistically. Preserve regional availability disclaimers and visible TMDB attribution.

## Controlled implementation

Foundation → routing → social/profile → Home → Discover → detail → supporting UX → motion/responsive → cleanup. Validate static references after structural changes and browser interactions after routing/social changes. Use isolated test fixtures for browser QA; production must use real provider data. SQL rollback tests have passed against the live schema; selected chat migrations were applied and content-api was deployed in this session. SMTP/OAuth, two-device Realtime latency and scheduled notifications still require operational verification.

## Future contracts

No XP, levels, achievements, battles or relationships have an authoritative backend today. Keep these out of production displays. A future server-authorized structured event renderer can attach to messages; profile progression can attach to identity, and activity/notifications can consume server-approved objects. Challenge rules remain a product decision. Relationship visibility must be enforced in queries/RLS before any profile, feed, search or notification payload is returned; hiding HTML is insufficient. Never synthesize online presence, wins or private relationships from local state.
