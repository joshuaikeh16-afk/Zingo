# Kaidra Web — Layout Spec for Google AI Studio

Claude is handling all Supabase wiring and app logic (JS files, already written). Google AI Studio should build the **HTML/CSS layout only** — no Supabase calls, no auth logic, no business logic. Each JS file below expects specific element IDs/classes to exist somewhere in the page; as long as those are present, any visual design works.

**Design freedom:** full creative control on look and feel. Suggested direction (not mandatory) — dark theme, anime/social app for a younger-adult audience, avoid generic dark-mode-neon clichés. Whatever direction you take, keep it mobile-first (this will primarily be used on phones) and keep load speed high — minimal animation, fast paint, per the project's stated design priority.

---

## Page 1: `auth.html`

Sign in / sign up, single page that toggles between both modes.

**Required element IDs:**
- `#email-input` — `<input type="email">`
- `#password-input` — `<input type="password">`
- `#auth-submit-btn` — `<button>`, starts labeled "Sign In"
- `#auth-toggle-mode` — link/button, e.g. "Don't have an account? Sign Up"
- `#auth-error-message` — hidden by default, shown with an error string
- `#auth-loading` — optional, shown while a request is in flight

**Behavior already wired (in `js/auth.js`):** toggling between sign-in/sign-up fires a `kaidra:auth-mode-changed` custom event with `{ mode: 'signin' | 'signup' }` in `detail` — layout can listen for this to swap a heading or copy without needing any of the auth logic itself.

**Script tag needed:** `<script type="module" src="/js/auth.js"></script>`

---

## Page 2: `onboarding.html`

Runs immediately after sign-up: username, birthdate (13+ gate), interests, optional avatar.

**Required element IDs:**
- `#username-input` — `<input type="text">`
- `#username-availability` — text element, script writes "Available" / "Already taken" into it and toggles `.available`/`.taken` classes for styling
- `#birthdate-input` — `<input type="date">`
- `#avatar-input` — `<input type="file" accept="image/*">` (optional step, can be skippable)
- `#onboarding-submit-btn` — `<button>`
- `#onboarding-error` — hidden by default, shown with an error string

**Interest chips — important, specific pattern:** render one element per interest, each with:
```html
<button class="interest-chip" data-interest="anime">Anime</button>
<button class="interest-chip" data-interest="news">News</button>
<button class="interest-chip" data-interest="idols_music">Idols &amp; Music</button>
```
The script toggles a `.selected` class on click — style `.interest-chip.selected` however fits the design (filled background, border highlight, etc.). Use exactly these `data-interest` values (`anime`, `news`, `idols_music`) since they're stored directly into the database as-is — don't rename them without checking with Claude first, since they need to match values used elsewhere (Home feed filtering, Discover tailoring).

**Script tag needed:** `<script type="module" src="/js/onboarding.js"></script>`

---

## Page 3: `app.html` — main shell + bottom nav

Wraps every screen below. Confirmed 5-tab structure (not the earlier Discover/Create/Profile mockup — see main handoff doc, this was corrected):

**Required element IDs:**
- `#nav-home`, `#nav-friends`, `#nav-compose`, `#nav-inbox`, `#nav-profile` — the 5 bottom nav buttons/links, in that order. `#nav-compose` is the center `[+]` button — style it distinctly (per earlier reference: gradient ring), the other four are plain tab icons.
- `#view-container` — the element whose content swaps between tabs (if this is a single-page-app style shell rather than separate HTML files per tab — Claude will confirm which pattern AI Studio used once the code arrives, and adjust the JS accordingly either way)
- Each tab needs a way to show an "active" state (`.active` class toggled by JS is the simplest pattern, but any convention works as long as it's consistent)

**Note:** whether this is one `app.html` with JS-swapped views, or five separate HTML files (`home.html`, `friends.html`, etc.) each behaves slightly differently at the wiring level — either is fine, just flag which pattern was used when the code comes in.

---

## Page 4: Home (YouTube-sourced feed)

**Required element IDs/classes:**
- `#video-feed-container` — the scrollable container holding video cards
- `.video-card` — one per video, must contain within it:
  - `.video-player-embed` — where the YouTube iframe/player gets inserted
  - `.video-title`, `.video-channel` — text elements
  - `.like-btn`, `.bookmark-btn`, `.share-btn` — action buttons, each needs `data-video-id="..."` set by JS at render time
- **No comment button/element** — confirmed no commenting on this feed (content isn't user-posted, nothing to comment "at")
- `#feed-loading` — shown while fetching more videos
- `#feed-load-more-trigger` — optional, an element near the bottom of the loaded list JS can watch via IntersectionObserver for infinite scroll

**Backend note:** videos come from the `youtube-feed` Edge Function (already deployed), not a direct YouTube API call from the browser.

---

## Page 5: Friends tab (24hr mutual-friend statuses)

**Required element IDs/classes:**
- `#friends-status-container` — holds the list/row of friends with active statuses
- `.friend-status-avatar` — one per friend with an unexpired status, needs `data-user-id="..."`
- `.friend-status-avatar` should support an overlay indicator when that friend also has an active SOTD sent to the viewer — e.g. a small musical-note badge element `.sotd-indicator` nested inside, toggled visible/hidden by JS
- `#status-viewer-modal` — full-screen viewer opened on tap, containing:
  - `.status-media` — image/video display area
  - `#status-reply-input` — text input for a private reply (goes to that friend's Inbox, not a public comment — see main doc)
  - `#status-reply-submit-btn`
  - `#status-quick-react-btn` — single-tap default reaction (separate from typing a reply)
  - `#status-close-btn`
- Exact layout (avatar-ring row vs. grid vs. list) was left as an open design decision in the main doc — whatever AI Studio produced here is fine, just confirm the above elements exist within it somewhere

---

## Page 6: Inbox (conversation list + thread view) — highest priority, check this first

**Conversation list required elements:**
- `#conversation-list` — container
- `.conversation-row` — one per conversation, `data-conversation-id="..."`, containing:
  - `.conversation-avatar` (may also carry a `.sotd-indicator` and/or `.streak-badge` — a flame icon + number element)
  - `.conversation-username`, `.conversation-preview` (last message text), `.conversation-unread-badge`

**Thread view required elements:**
- `#message-thread-container` — scrollable message list
- `.message-bubble` — one per message, needs `data-message-id`, `data-message-type` (`text`/`image`/`voice_note`/`sticker`/`status_reply`/`forwarded_video`/`forwarded_news`/`forwarded_sotd`) set by JS so CSS can style each type differently (e.g. `.message-bubble[data-message-type="sticker"]` gets no bubble background)
- `#message-text-input`, `#message-send-btn`
- `#message-image-btn` (opens file picker), `#message-voice-btn` (starts/stops recording), `#message-sticker-btn` (opens sticker tray)
- `#sticker-tray` — hidden by default, grid of `.sticker-option` elements
- `.message-reaction-badge` — small pill on a bubble showing emoji + count, and a way to trigger the reaction picker (e.g. long-press handled in JS, just needs the bubble itself to exist)

---

## Page 7: `[+]` Compose flow

Opens as a modal/overlay, not a separate page, when `#nav-compose` is tapped.

**Required element IDs:**
- `#compose-modal` — the overlay itself, hidden by default
- `#compose-option-status`, `#compose-option-sotd` — the two initial choice buttons ("Post a status" / "Send a Song of the Day")

**Status sub-flow:**
- `#status-media-input` (file picker, optional for text-only), `#status-caption-input`, `#status-post-btn`

**SOTD sub-flow:**
- `#sotd-search-input`, `#sotd-search-results` (container for track results from the `spotify-search` Edge Function), `.sotd-track-result` (one per result, `data-spotify-track-id`)
- `#sotd-recipient-picker` — friend multi-select, `.friend-option` per mutual friend, `data-user-id`
- `#sotd-send-btn`

---

## Page 8: Profile

**Required element IDs:**
- `#profile-avatar`, `#profile-username`, `#profile-bio`
- `#stat-following`, `#stat-followers`, `#stat-likes` — numbers
- `#follow-btn` — only rendered/shown when viewing someone else's profile, not your own
- `#currently-watching-badge` — hidden unless the profile has an active `watching`-status entry
- `#compatibility-score` — only shown on a mutual friend's profile, hidden otherwise
- `#streak-badge` — flame + count, only on a mutual friend's profile
- `#profile-posts-grid` — grid container for that user's statuses (once posts exist, or empty-state otherwise)

---

## Page 9: Discover (anime search/recommendations only)

**Required element IDs:**
- `#anime-search-input`, `#anime-search-results`
- `#seasonal-countdown-widget` — hidden if no upcoming premieres in range, otherwise shows title/art/days-remaining per title
- **No hashtag/trending-audio elements** — confirmed not part of this app, that assumed user-uploaded content which isn't the model

---

If AI Studio already built full pages for all of this without seeing the spec above, that's fine — once the code comes in, check it against this list and either it already lines up (great, straight merge) or Claude retrofits the IDs/classes onto AI Studio's existing markup without touching its visual structure.

---

## Gaps found after integrating the first pass — needed to finish the app

The first delivery (`auth.html`, `onboarding.html`, `app.html`) covered nearly everything in this spec, but three things are missing:

### 1. SOTD "listen" modal (receiving side)

The compose flow's SOTD *sending* side exists (`#sotd-search-input`, `#sotd-recipient-picker`, etc.) — but there's no modal for the *receiving* side: what happens when someone taps the musical-note bubble on a friend's avatar to actually listen to the song they were sent.

**Required element IDs:**
- `#sotd-listen-modal` — hidden by default, opened when a `.sotd-indicator` badge is tapped
- `#sotd-listen-album-art`, `#sotd-listen-track-name`, `#sotd-listen-artist-name` — display elements
- `#sotd-listen-embed-container` — where an embedded audio preview gets inserted
- `#sotd-listen-open-spotify-btn` — deep-links to the track in the user's own Spotify app
- `#sotd-listen-close-btn`

### 2. Message bubble designs for `image` and `voice_note` types

Text, sticker, and forwarded-content bubble styles exist. Image and voice note messages don't have a visual treatment yet — need:

- An **image bubble** pattern: rounded image thumbnail inside (or replacing) the bubble shape, tappable to view full-size
- A **voice note bubble** pattern: play/pause button + waveform or progress bar + duration label (e.g. "0:14") — doesn't need to be a real animated waveform, a static bar visual is fine

Both should follow the same self-end/self-start (sender vs. receiver) styling logic already used for text bubbles.

### 3. Empty states

Currently unstyled/missing across the app — right now these fall back to plain unstyled text when there's nothing to show:

- Empty Inbox (no conversations yet)
- Empty Friends tab (no active friend statuses)
- Empty Profile grid (no posts yet)
- No results in Discover search

Doesn't need to be elaborate — just something visually consistent with the rest of the app (an icon + short message) rather than plain fallback text, since right now those states look broken/unfinished compared to everywhere else.

Once these three are added, the app is visually complete — no other layout work anticipated after this pass.
