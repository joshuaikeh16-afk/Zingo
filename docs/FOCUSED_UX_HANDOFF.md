# Kaidra UX and chat handoff — 2026-10-03

The earlier urgent checkpoint has been completed and verified. The missing library/group migration **20261006 is now applied** to the linked Supabase project, along with the tested resumable onboarding and saved-media/reply identity migrations **20261007 and 20261008**. The frontend and live database now use the same message, group and library fields.

Contextual content/message actions, private Favorites/Watchlist, immediate sharing, staged group creation, permissions/ownership, polls, pins, mentions, replies and shared history are connected. Membership revocation closes cached group views. Legacy saved MAL items retain their provider and a usable destination. Home hero, Friends and profile identity are preserved.

The full responsive browser suite passed at 320–1600 pixels. Fresh-account onboarding and PWA install/offline checks passed separately. Rolled-back authorization/regression SQL tests passed. Live authenticated WebSocket tests verified DM/group delivery, reads, reactions, polls/votes/pins, private library persistence and removed-member access revocation. Temporary live fixtures were cleaned up.

See [the current release handoff](ONBOARDING_AND_INSTALL.md) for the exact Watchlist 400 diagnosis, deployment details, changed account flow, test coverage and remaining limitations. Publish the complete static frontend together; do not blindly reapply historical migrations or commit secrets.
