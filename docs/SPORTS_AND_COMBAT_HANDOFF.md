Kaidra Sports, combat and messenger update

This report covers the Sports request, the newer eight-class RPG combat brief and the latest chat references. The newer battle brief expands the five permanent classes to eight; existing permanent identities and unfinished V1 exams are preserved.

Deployment status

- Applied incrementally to the linked Supabase project: migrations 20261017–20261029, including the meaningful-action XP fix, party/rivalry realtime, and private messenger/group links.
- Sports API and Sports notification worker deployed. The Sports scheduler runs every 30 minutes and uses an encrypted Vault credential. No API key is embedded in browser files.
- Combat API deployed, including authoritative actions and invitation expiry on access.
- Party/rivalry migration 20261021 was applied after the user's explicit “Approve live migration” reply. Real four-account 2v2 acceptance, initiative, surrender and results checks passed, and their temporary accounts were removed.
- Private combat timeout/expiry maintenance runs every minute. Sports maintenance runs every 30 minutes. Both jobs were verified active; credentials remain in Supabase Secrets/Vault.
- Messenger migration 20261026 is applied. Rollback security checks and real private PNG/PDF uploads, group join approval and revoked-link HTTP checks passed.
- Frontend changes are in the workspace. No Git commit or push was performed.

Sports completion report

1. **Inspection:** reused the existing static frontend, authenticated Supabase RPCs, Edge functions, messaging, Discover routes, notification preferences and legacy Football objects. No replacement chat or auth service.
2. **Files:** new js/sports-client.js, js/sports.js, js/sports-home.js, js/sports-profile.js, js/challenge-target.js, css/sports.css; Edge sports-api, sports-sync and _shared/sports.ts; migrations 17/18; Sports unit, browser, live and rollback SQL tests. Existing app, routes, Discover, search, sharing, inbox, social and notification modules integrate them.
3. **API wiring:** API_SPORTS_KEY remains server-only. All browser requests authenticate through sports-api; verified provider metadata is registered by trusted server functions.
4. **Provider boundary:** whitelisted actions, bounded IDs/pages/query lengths and rejected unknown arguments; no arbitrary URLs or exposed provider headers. Errors are sanitized.
5. **Sports registry:** Football is available. Basketball and Formula 1 are explicitly planned, without fake live data.
6. **Hub:** Sports sits alongside Movies, Series and Anime in Discover. Club search, competitions, players, fixtures and personalized support are separate exploration controls. Legacy Football links still work.
7. **Club search:** provider-backed search after three characters, with debouncing and shared caching. Arsenal, Chelsea, Barcelona and Real Madrid live searches returned real provider identities.
8. **Club pages:** real provider venue art, club metadata and lazy sections for fixtures, results, squad and standings.
9. **Player search/details:** provider-backed identity, photo and available metadata; statistics requested only when selected.
10. **Current squads:** verified squad membership is kept distinct from player identity. Later player lookup does not discard the registered squad relationship; fixture registration does not overwrite a full club snapshot.
11. **Competitions:** provider directory, coverage/current-season checks, participating clubs, standings and fixtures. Pagination prevents rendering the entire directory at once.
12. **Primary Support:** one primary club per sport/provider, private by default; changing it requires confirming the previous club.
13. **Follow:** users may follow multiple entities independently of primary Support.
14. **Friends:** friends-only public support context through RPCs; raw private follows remain owner-only. A public choice is not a public roster of unrelated users.
15. **Match choices:** neutral/home/away support, private by default, locked for finished fixtures. Neither Support nor Follow supplies a combat bonus.
16. **Match Center:** real score/status/venue and lazy events, statistics and official lineups. Empty or restricted provider sections are stated honestly.
17. **Discussion:** verified optional Sports entity context is attached to the existing Discussion message type. Agreement/disagreement remains the existing social mechanism.
18. **Challenges:** sports Discussion context survives into the existing challenge path. Opposing participants are validated on the server.
19. **Bare DM command:** .challenge automatically targets the other DM participant. Groups require an explicit valid member; self and outsider targets are rejected.
20. **Sharing:** club/player/competition/event cards route inside Kaidra and can be shared into DMs/groups or attached to a Discussion.
21. **Notifications:** optional reminders/results/official lineups; defaults off; per-category and global preference checks; unique deduplication keys. Cached unofficial/stale lineups do not produce alerts.
22. **Scheduler:** one shared worker, not fan-by-fan browser polling. No eligible subscriptions means no provider call. Encrypted Vault credential and service-only scheduling/delivery helpers.
23. **Caching/quota:** persistent cache, request leases, negative caching, shared daily budget, per-user rate limits, provider remaining-quota protection and browser request coalescing. Browser memory is bounded and session-local.
24. **Plan limits:** the actual provider plan rejected next/last fixture queries. The server can return clearly labeled today-only results using the shared today's fixture cache. This does not pretend to be a full upcoming/archive feed. Some current-season statistics may require a provider plan upgrade.
25. **Home:** a compact supported-club context, rather than changing Home into a football dashboard. Movies/Series/Anime recommendations and chatting remain intact.
26. **Privacy/security:** trusted canonical entities, no user-supplied provider snapshots, owner-only choices/preferences and friend-scoped public context. Mutating cache/ingest/delivery RPCs are service-only.
27. **Responsive tests:** real browser journey passed at 390px and desktop, including search, primary changes/privacy, squads, players, standings, Match Center, Discussion sharing and settings persistence. Screenshot review performed. Physical phone tests remain outstanding.
28. **API/testing:** unit provider/URL/cache tests and real-database rollback security/notification tests passed. Live provider checks passed club searches, club/squad/player/directory and today's fixtures; provider plan limitations were observed, not hidden. Browser tests use provider fixtures separately from live provider verification.
29. **Deferred:** more sports providers, broader commercial coverage, push delivery to a fully closed app and deep player-transfer presentation. No claim of broadcaster video rights or in-app premium match streaming.

Combat completion report

1. **Inspection/preservation:** retained permanent identities, accounts, private progression, conversation membership, challenges, notifications and realtime infrastructure. Existing vote/debate records are retained as combat_version=0; new RPG battles use version 1.
2. **Files:** new js/combat-arena.js, js/combat-commands.js, js/battle-hub.js, css/combat.css; server _shared/combat.ts and combat-api; migrations 19–25; pure engine, browser, live HTTP and rollback SQL combat/party/expiry tests. Updated class registry, routing, challenge cards, inbox and Awakening tests.
3. **Schema:** battle_teams, battle_participants, battle_combat_state, battle_status_effects, battle_cooldowns and battle_events; eight trusted class kits in battle_classes. Party/rivalry tables are deployed by migration 21; private realtime publication is enabled by migration 25.
4. **Authoritative engine:** clients send ability/target intent, request ID and expected revision. Authenticated identity, class, damage, HP, resource, effects, cooldowns, turn ownership and winner are calculated or validated server-side.
5. **Races/idempotency:** locked compare-and-swap commits; unique per-battle request IDs; conflicting reused IDs rejected. A live race committed exactly one action. A repeated successful request does not deal damage twice.
6. **Permanent classes:** Warrior, Wizard, Ninja, Guardian, Rogue, Healer, Ranger and Berserker. Existing classes remain unchanged. No selector, reset or reroll.
7. **Exam V2:** 24 base scenarios with multi-trait weights and 56 pair-specific determinant scenarios; a balanced randomized frozen 12-question subset plus at most two determinants. Hidden definitions are private server data, not sent with UI questions.
8. **Scoring/resume:** server scoring, saved answer IDs and session snapshots, bounded tie resolution, deterministic secondary scoring and permanent assignment before acknowledgement. V1 sessions retain V1 scoring. SQL security and resume tests passed for the deployed V2 flow.
9. **Warrior:** heavy damage, guard breaking, parry, battle cry and conditional Last Stand.
10. **Wizard:** mana management, weakening, shielding and an interruptible charging burst.
11. **Ninja:** fast initiative, damage mitigation through evasion, multi-hit pressure and low-HP execution opportunities.
12. **Guardian:** defensive timing, counterattacks, shield, interrupt and ally interception. Self-protection is rejected because it would be ineffective.
13. **Rogue:** resource disruption, vulnerability, marking, exploitation and risky recoil damage; distinct from Ninja.
14. **Healer:** ally restoration, purification, shielding and regeneration, alongside viable light damage. Healing remains bounded.
15. **Ranger:** precision marks, piercing shots, traps, positioning and an attack against all living enemies.
16. **Berserker:** rage, HP costs, low-HP pressure and risky offensive buffs. Recoil can defeat the caster; no free infinite sustain.
17. **Turn system:** speed orders initiative; every living fighter gets one action per cycle. Defeated fighters are skipped; taking over another fighter is rejected.
18. **Timer/reconnect:** 25-second server deadline, safe timeout guard, three consecutive timeouts forfeit the fighter; authoritative catch-up on access/reconnect. The deployed private minute scheduler handles battles while all clients are absent.
19. **Expiry/concurrency:** pending RPG invitations expire after ten minutes without wins/losses/XP. Late acceptance cannot revive them. One pending or active RPG battle per conversation is enforced by a unique index and serialized creation. Membership removal closes the combat state.
20. **Forfeit:** .forfeit resolves the current conversation's active RPG battle and asks confirmation. Only a living participant's own fighter can surrender. In 2v2 the teammate can continue. Spectators cannot concede another fighter.
21. **HP result/XP:** victory comes from surviving teams, never votes. Results update private XP, wins, losses, draws, current/best streak once. Voluntary action requirements exclude automatic timeout farming. Existing new-account safeguards, diminishing repeat-opponent rewards and daily caps remain. Friendly matches do not change League.
22. **Predictions:** spectators may predict before combat starts. Predictions have no damage, winner or XP authority. They cannot call combat actions.
23. **Arena/UI:** mobile/desktop fighter panels, HP/resource bars, status labels, large abilities with costs/cooldowns/details, eligible target selection and confirmation, timeline history, surrender, private results and a fresh-invitation rematch.
24. **VFX/reveals:** distinct motion for heavy impact, arcane glyphs, rapid afterimages, protective bracing, feints, restoration, projectile trails and rage. Eight SVG emblems; CSS/SVG effects and reduced-motion handling. No large video assets or emoji-as-class graphics.
25. **Parties:** deployed migration adds max-four membership, friend invitations/consent, one party per account, leader transfer, remove/leave/disband and an existing group chat. Generic group membership controls cannot bypass party consent. UI exposes these controls, with private realtime roster/invitation updates.
26. **2v2/rivalries:** deployed server path validates two fighters per party including leaders, four distinct awakened available fighters, allowed connections and all four acceptances. Three meaningful matches permit mutual rivalry recognition; private series/streak records; no stat bonuses. Party/rivalry SQL checks passed with rollback; live four-account HTTP checks also passed after deployment.
27. **Security validation:** deployed live HTTP checks passed outsider denial, turn ownership, forged class/damage rejection, invalid abilities/targets, hidden seed, competing actions, HP victory, result finality, post-result rejection and private history/stats. Temporary live accounts/conversations were removed. SQL checks additionally passed raw mutation denial, permanent identity, party controls, all-four consent, late acceptance and no expiry progression.
28. **Responsive/checks:** eight-class browser actions, keyboard confirmation, 2v2 ally healing/targeting, realtime updates, victory/XP, return to chat, party creation/invite and mobile/landscape/desktop bounds passed. Static JS/assets/import checks and 11-file Edge TypeScript semantic checks passed. Engine tests cover eight mirrors, all 64 ordered class pairings, three team compositions, anti-stall, casting interruption, protection, targeting and timeouts. These are implementation checks, not a competitive balance certification. There is no npm lint/build pipeline; complete Deno runtime typechecking and physical-device testing were not run.
29. **Deferred/pending:** Ranked ratings/matchmaking, 3v3, spectator chat, audio and final competitive balance need later work. No pets, companions, shops, inventory, paid changes or rerolls were introduced.

Messenger update from the latest references

Live ten-minute invitation expiry was verified through the private Vault-backed maintenance worker, with no browser access, no expiry XP and rejected late acceptance. The final database audit confirmed migrations 17–26, both active maintenance schedules, protected combat seeds and zero remaining QA accounts.

The direct composer now has stickers, attachments, camera/gallery, and a microphone. The microphone becomes Send when there is text; Discussions/challenges/polls remain in the secondary tools row. Photos/video capture uses the device's native file/camera chooser. JPG/PNG/WebP/GIF photos are limited to 5 MB; MP4/WebM videos to 25 MB; PDF/text/ZIP/Office documents to 20 MB. Videos play inside the conversation. Documents use signed downloads rather than arbitrary inline executable previews.

Private sticker import supports multiple saved WebP/PNG/GIF files, 2 MB each, preserving animation/transparency without converting them. Stickers are kept in each user's own library, then uploaded separately into the destination conversation. Forward buttons sit beside photos/videos/stickers. Forwarding creates a destination-scoped private copy; it does not point another group at a source group's storage. Existing reply, reaction, receipt, group author colours, long press and swipe workflows remain.

Voice messages have play/pause, a waveform decoded from actual audio on demand, a keyboard-accessible seek slider, duration, playback speed and sender avatar. Other playing notes pause. Audio decoding failure leaves the seek/player usable. Playback is never automatic. Recording still uses browser MediaRecorder, preview/discard, a three-minute cap and retry UUIDs. HTTPS or localhost and microphone permission are required.

Group info now fills the mobile viewport with a sticky heading, large group identity, Add/Search/Invite quick controls, private media previews, Media/Links/Documents/Entertainment tabs, compact settings, searchable members, admin badges and existing owner/admin role/leave/delete controls. Permission switches save the existing server rules. Invite approval is separate and server enforced.

Invite links have 256-bit random tokens; only SHA-256 hashes are stored. They expire after seven days. Admins can create replacements/revoke links, and approve/decline requests. Rotating/revoking invalidates old links, including ones already previewed. Authenticated previews expose group identity/count/description, not member rosters or messages. Pending join requests grant no membership or media access. Joining is serialized and idempotent with a 50-member limit. Blocked/banned users are rejected. Party groups cannot use these links to bypass party consent. Group info routes party membership/leadership operations to the existing Party view rather than displaying generic controls that the server will refuse. Login/onboarding retain only strictly validated local invitation destinations.

New messenger files: css/messenger.css; js/chat-media.js, js/voice-player.js, js/group-invites.js; migration 20261026_messenger_media_and_group_links.sql; tests/messenger-browser.mjs, tests/messenger-backend.sql, tests/messenger-live.mjs. Modified integration: app.html, inbox, groups, icons, Supabase client, auth/onboarding, router, message previews and voice recorder.

Schema additions: messages.media_metadata; conversations.join_approval; user_stickers, group_invite_links, group_join_requests; private chat-media and user-stickers buckets; media access/validation functions, group link/join/request RPCs and shared-history extension. RLS protects sticker libraries, conversation attachments and admin/requester access. New message metadata is read from trusted Storage object metadata, not accepted from client claims.

WhatsApp's official sticker specification uses [WebP files](https://github.com/WhatsApp/stickers/blob/main/Android/README.md). Kaidra imports files a user supplies; it does not connect to or automatically read a WhatsApp account. ZIP/.wasticker pack parsing is not implemented. Calls/voice rooms, disappearing-message timers, message-history sharing controls and QR codes were not added as inactive UI. Physical Android/iOS camera and microphone tests remain outstanding.

Validation: focused Discussion and full product browser regressions passed; the new messenger browser journey covers recording, actual playback, seek/speed, sticker library/forwarding, group search/permissions/invite routing and 320/390/768/1366 px bounds. Native file-chooser checks passed sticker import, PDF/photo uploads and a playable browser-recorded WebM video. The broader smoke suite passed at 320/360/390/430/768/1280/1366/1600 px, including recording retry, group controls, reconnect, auth and entertainment flows. Live HTTP checks passed approval-before-access, denied outsider approval, actual private PNG/PDF upload and canonical metadata, private saved-sticker URLs, shared documents and replaced/revoked invites; QA media/accounts were removed. SQL rollback checks additionally passed expired and blocked links, duplicate joining, wrong-conversation media paths, nonexistent uploads and forged MIME/size claims. Screenshots were inspected for mobile voice/group layouts. Mock browser checks and live backend checks are reported separately.

Verification commands

Use standalone Node if installed. In this workspace replace node with ELECTRON_RUN_AS_NODE=1 /usr/share/code/code. Browser suites use ports 8765/9222 and run sequentially.

```sh
node tests/static-check.mjs
node tests/edge-types.mjs
node tests/combat.test.mjs
node tests/sports.test.mjs
node tests/combat-browser.mjs
node tests/discussion-browser.mjs
node tests/messenger-browser.mjs
node tests/sports-browser.mjs
node tests/product-browser.mjs
node tests/awakening-browser.mjs
KAIDRA_LIVE_QA=1 node tests/combat-live.mjs
KAIDRA_LIVE_QA=1 node tests/party-live.mjs
KAIDRA_LIVE_QA=1 node tests/messenger-live.mjs
```

Rollback-only SQL tests: tests/combat-backend.sql, tests/parties-backend.sql, tests/battle-invitations-backend.sql, tests/sports-backend.sql, tests/awakening-backend.sql, tests/messenger-backend.sql. Do not run db reset or indiscriminately push this repository's historical migrations: it has no complete baseline for the existing linked database.

Battle-state HTTP 405 fix

Migration 20261027_battle_state_transaction_mode.sql is applied. The party wrapper had been marked STABLE while delegating to an existing expiry UPDATE. PostgREST executes STABLE RPCs in a read-only transaction even for POST, producing SQLSTATE 25006 / HTTP 405. The fix changes only the public wrapper's volatility to VOLATILE and reloads the API schema cache; function bodies, authentication, membership checks and private reward filtering are preserved. See [PostgREST transaction rules](https://docs.postgrest.org/en/v12/references/transactions.html).

A new live regression (tests/battle-state-live.mjs) first reproduced the exact 405/read-only UPDATE failure, then passed HTTP 200 for both authenticated participants after the fix, class metadata, outsider denial, existing expiry updates and closed combat state. Temporary users and their conversation were removed. Rollback attribute/privilege checks (tests/battle-state-backend.sql), JS syntax and git diff checks passed. The party live regression now also checks the four-participant challenge card; that added assertion has not been run in this fix's verification.

### Battle creation 409 and closed invitation cleanup

Migrations 20261028 and 20261029 are applied to the linked project. The observed 409 was SQLSTATE 23505 on `battles_open_pair_idx`: an accepted pre-combat direct challenge occupied the same pair slot while the newer wrapper checked only the current conversation. A temporary-account live test reproduced the 409 before the fix. Creation now serializes by fighter pair, reports a visible existing battle instead of a raw 409, rejects request-ID reuse with changed intent, and expires stale pending RPG invitations across chats. The client offers **Open existing battle**, keeps retry IDs tied to unchanged intent, and lets a participant explicitly close an old direct challenge without XP. Deployment did not alter any existing battle status.

On expiry, cancellation or decline, a server trigger removes that invitation's system chat cards and battle alerts and invalidates the participants' inboxes. The battle attempt audit record remains for rate limits; resolved combat and reward records remain. The chat discards removed rows during refresh, and Battle history omits these closed invitations. Rollback SQL and live temporary-account checks passed for cleanup, privacy, retry races, legacy closure and expiry. The revised migration avoided bulk closure of real users' old challenges after the first proposed bulk update was rejected by automatic approval review.

Frontend polish in css/messenger.css makes chat rows, bubbles, date markers, composer focus, challenge errors and challenge cards more legible at mobile and desktop sizes. Static imports/syntax, unread/message-state tests and `git diff --check` passed after this edit; browser visual testing after the final CSS edit was not run.
