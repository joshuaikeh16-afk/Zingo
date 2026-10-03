# Focused UX overhaul checkpoint — 2026-10-03

Saved for the requested urgent GitHub backup. This is an implementation checkpoint, not a production-ready release.

Implemented locally: contextual entertainment actions; separate Favorites and Watchlist using the existing user_watchlist table; Profile library; immediate rich-content sharing; contextual message actions; reply navigation; composer menu; staged group creation; group roles, permissions, ownership transfer, polls, mentions, pins, shared history and system events. Home hero, Friends, and profile identity are preserved.

## Database

`supabase/migrations/20261006_library_and_group_controls.sql` is **not applied**. New features require this migration after the existing 20261003–20261005 schema. Both new authorization tests (`tests/group-controls.sql`) and existing chat regression tests (`tests/chat-backend.sql`) passed against it in rolled-back database transactions. No test fixtures were retained.

Do not run all historical migrations blindly: this project has an existing live schema and older migration history is not reconciled.

## Checks and remaining work

Final static syntax checks, message-state tests, feed/unread tests, and git diff whitespace checks passed. The final browser attempt could not start Chrome; the updated full browser suite has not passed. New simultaneous-account live Realtime acceptance checks have not run, and the new schema has not been deployed. Prior live checks documented elsewhere cover the previous version only.

Before production: finish the browser suite (including mobile long press and keyboard menus), inspect responsive screenshots, close all cached group overlays on membership revocation, verify migrated MAL items have a usable detail destination, and verify bidirectional DM/group delivery, polls, replies, reactions, mentions, ownership transfer and private library persistence with two authenticated accounts. Review library/group realtime reconnect handling and stale group-info panels. Apply the incremental migration only after those checks are complete.

No API secrets belong in GitHub. Local environment files and the local CLI installation are ignored.
