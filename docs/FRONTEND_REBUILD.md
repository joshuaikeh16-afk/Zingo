# Kaidra frontend and verification

## Product flow

The signed-in shell is permanently dark. Compact headings put actual people, conversations and entertainment in the first viewport. Global navigation has For you, Discover, Friends, Inbox and My profile; the promotional sidebar card and top-right avatar are removed. Desktop uses a sidebar and split messenger, tablet/mobile use five bottom destinations and fullscreen conversations. Motion uses shared timing tokens, reduced-motion preferences and restrained transitions. No fake presence or progression is displayed.

Home opens with a personal greeting, real friend/unread totals and recent conversations, followed by artwork-led featured titles, personalized picks, actual shared conversation cards, optional matchday content and supporting editorial news. Recommendations append real provider pages with duplicate suppression and retry that preserves earlier results. Featured titles have manual/pause controls; rotation pauses with focus/hover, background tabs and reduced motion.

Discover has immediate search, supported category filters, regional availability selection and provider artwork. Football stays in Discover as actual score/status/team cards rather than redirecting to Home. Global search expands into a focused overlay with title artwork/metadata and a separate People group; `/`, arrows, Enter and Escape support keyboard use. People search covers names and usernames.

Movies/series open immersive backdrop/poster detail views, synopsis, genres/rating, official trailers, streaming lookup and sharing. Match/article objects have their own presentations. Structured recommendation/match/news shares reopen on the recipient’s side. TMDB attribution remains in the source disclosure; external services and highlights use official destinations. No licensed full-film/full-match player is available.

Friends exposes actual friend cards and a Requests filter. Find People shows friendship/request state, cancellation and immediate incoming Accept/Decline controls. My profile is always the authenticated user. Other users have a separate identity view with real interests, favourites, friend counts and deliberate friendship/messaging actions. Profile accents use values accepted by the database and do not change the app theme.

Inbox preserves stable optimistic message IDs, deduplication, retry, reconnect snapshots and membership checks. Counts sum individual unread messages, not conversations. Read updates are bounded to the loaded message and stored per reader. Groups can start with one accepted friend; creation includes searchable friend selection, removable member chips and live identity preview. Replies, mentions, reactions, shared objects, member management, unread dividers and a jump-to-latest control are supported. Voice recording uses an actual microphone, preview/discard/send, a three-minute/10 MB limit, private storage and retry under one stable object/message ID. Tracks stop on cancellation, navigation and backgrounding.

The bell combines pending requests, actual unread conversations and saved matchday updates. Requests open the requester’s profile; messages open the specific conversation; match updates open their match. Mark-updates-as-read does not silently clear unread messages. Settings remain utility-focused. Forms protect unsaved edits, and logout, friend removal and leaving a group require confirmation.

## Destinations and extension points

`js/router.js` handles `#home`, `#discover`, `#friends`, `#inbox`, `#profile`, `#user/{id}`, `#inbox/{conversationId}`, `#title/{movie|tv}/{id}`, `#match/{id}` and encoded article-source destinations. Browser Back/Forward restores the underlying view and closes/reopens object detail sheets. Legacy `?user=` links resolve to the dedicated user destination. User/title/conversation routes work on static hosting without rewrite rules.

`js/message-content.js` registers renderers for actual persisted message types. New structured event renderers can attach here after authoritative server contracts exist. A renderer does not establish permission, battle results, XP or relationship visibility. Profile progression can attach to the profile identity component once an authenticated API supplies real data. See BACKEND_REQUIREMENTS.md; battle mechanics remain a product decision, and private relationships require query/RLS enforcement before payloads reach the browser. No speculative battle/relationship engine or inbox AI was added.

## Verified in this session

- Static checks: unique DOM IDs, referenced assets, local imports, browser JS and stripped Edge Function syntax; git whitespace checks.
- State checks: optimistic ordering/deduplication, retries, personalized provider paging, duplicate suppression, stale search responses, individual unread totals and precise read boundaries.
- Chrome with isolated fixtures: auth/signup confirmation/recovery, taste setup, search keyboard focus, separate profiles, object Back/Forward, category/search/error/empty/retry, DM send/echo/reply/reaction/reconnect, groups/membership, shared titles/matches, actual MediaRecorder with Chrome’s test microphone, private playback wiring, upload retry/cancellation, settings/unsaved changes, notifications and reduced motion.
- Responsive checks/screenshots: 320, 360, 390, 430, 768, 1280, 1366 and 1600 px; the 1366 px check uses 768 px height. No horizontal overflow; mobile conversations occupy the viewport and desktop composer stays visible. Screenshots are in `/tmp/kaidra-qa` and contain explicitly labelled fixture artwork.
- Live rollback SQL checks against the deployed schema: DM/group separation, group membership/creator rules, 7 + 3 = 10 unread messages, bounded/idempotent reads, independent group receipts, reactions, creator transfer and outsider access.
- Live authenticated API checks: inbox/notifications HTTP 200, 40 real personalized titles on each of the first two pages, real artwork/detail/Nigeria provider lookup, 18 BBC stories and 19 football fixtures at test time. A sampled title had no Nigeria provider entries; availability is title-specific.
- Live authenticated WebSockets and REST using temporary accounts: actual group delivery, read receipt/reaction events, unread 1 → 0, outsider message denial, private voice upload/signed download, outsider signing denial and former-member access revocation. All temporary accounts, messages, conversations, reads, reactions and storage objects were deleted.

Selected chat repair SQL (20261003/04/05) was applied to the inspected cloud database, and content-api was deployed. The TMDB secret name was corrected; live movie and football providers responded successfully. These are actual verification results, not a promise of universal reliability. SMTP/OAuth configuration, prolonged multi-device latency/load, scheduled reminders, background push and future progression/social systems remain outside this verification.
