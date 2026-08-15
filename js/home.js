// Real Home feed logic: pulls videos from the youtube-feed Edge
// Function, renders real video cards using the YouTube IFrame Player
// API (not a raw <iframe src>), custom play/pause + speed controls,
// a real share menu (forward to friend / copy link), and thumbnail-
// first loading for perceived speed.
//
// IMPORTANT: the raw <iframe src="...embed/ID"> approach used
// previously captures every touch/swipe gesture itself on mobile,
// which is why scrolling only worked with a desktop mouse -- touch
// drags never reached the outer scroll container. The Player API +
// pointer-events:none on the iframe (real controls live in our own
// overlay instead) fixes this at the root, not just the symptom.

import {
  requireAuth,
  requireProfile,
  searchYoutubeVideos,
  toggleVideoLike,
  isVideoLiked,
  toggleVideoBookmark,
  isVideoBookmarked,
  getMutualFriends,
  getOrCreateConversation,
  sendMessage,
  recordFriendInteraction,
} from './supabase-client.js';

let currentUserId = null;
let nextPageToken = null;
let isLoadingMore = false;
let feedExhausted = false;
let ytApiReadyPromise = null;
const players = {}; // videoId -> YT.Player instance

const feedContainer = document.getElementById('video-feed-container');
const loadingEl = document.getElementById('feed-loading');
const loadMoreTrigger = document.getElementById('feed-load-more-trigger');

const HEART_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-4.318-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>';
const HEART_FILLED = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.001 4.529c2.349-2.532 6.147-2.532 8.496 0 2.348 2.531 2.348 6.635 0 9.166L12 21.997l-8.497-8.302c-2.348-2.531-2.348-6.635 0-9.166 2.349-2.532 6.147-2.532 8.496 0z"/></svg>';
const BOOKMARK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>';
const BOOKMARK_FILLED = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>';
const SHARE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/></svg>';
const PLAY_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>';

// ---------------------------------------------------------------------
// YouTube IFrame Player API loader (loaded once, shared by all cards)
// ---------------------------------------------------------------------
function loadYouTubeApi() {
  if (ytApiReadyPromise) return ytApiReadyPromise;

  // Pre-connect to YouTube's domains immediately (before the script tag
  // is even added) so the DNS/TLS handshake is already warm by the time
  // the first player actually needs it -- shaves real time off the
  // first video's start.
  ['https://www.youtube.com', 'https://s.ytimg.com'].forEach((origin) => {
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = origin;
    document.head.appendChild(link);
  });

  ytApiReadyPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve();
      return;
    }
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
    window.onYouTubeIframeAPIReady = () => resolve();
  });
  return ytApiReadyPromise;
}

// Loads the YT API the moment the module runs, not on-demand when the
// first card becomes active -- the script has time to finish loading
// in the background while the user is still on onboarding/auth-adjacent
// navigation, so it's usually already warm by the time Home renders.
loadYouTubeApi();

// ---------------------------------------------------------------------
// Card construction
// ---------------------------------------------------------------------

function buildVideoCard(video) {
  const article = document.createElement('article');
  article.className = 'video-card';
  article.dataset.videoId = video.videoId;

  article.innerHTML = `
    <div class="video-player-embed" style="background-image:url('${video.thumbnailUrl ?? ''}')">
      <div class="player-mount"></div>
      <button type="button" class="video-tap-layer" aria-label="Play/Pause"></button>
    </div>
    <div class="feed-controls">
      <button type="button" class="control-btn play-pause-btn">${PLAY_ICON}</button>
      <div class="speed-control">
        <button type="button" class="speed-btn" data-speed="0.5">0.5x</button>
        <button type="button" class="speed-btn active" data-speed="1">1x</button>
        <button type="button" class="speed-btn" data-speed="2">2x</button>
      </div>
    </div>
    <div class="feed-actions">
      <button type="button" class="feed-action-btn like-btn" data-video-id="${video.videoId}">${HEART_ICON}<span>Like</span></button>
      <button type="button" class="feed-action-btn bookmark-btn" data-video-id="${video.videoId}">${BOOKMARK_ICON}<span>Save</span></button>
      <div class="share-wrapper">
        <button type="button" class="feed-action-btn share-btn" data-video-id="${video.videoId}">${SHARE_ICON}<span>Share</span></button>
        <div class="share-menu hidden">
          <button type="button" class="share-menu-item" data-action="forward">Send to a friend</button>
          <button type="button" class="share-menu-item" data-action="status">Post as status <span class="soon-tag">soon</span></button>
          <button type="button" class="share-menu-item" data-action="copy">Copy link</button>
        </div>
      </div>
    </div>
    <div class="feed-overlay">
      <p class="video-title">${video.title}</p>
      <p class="video-channel">${video.channelTitle}</p>
    </div>
  `;

  wireCardActions(article, video);
  return article;
}

function wireCardActions(article, video) {
  const videoId = video.videoId;
  const likeBtn = article.querySelector('.like-btn');
  const bookmarkBtn = article.querySelector('.bookmark-btn');
  const shareBtn = article.querySelector('.share-btn');
  const shareMenu = article.querySelector('.share-menu');
  const playPauseBtn = article.querySelector('.play-pause-btn');
  const tapLayer = article.querySelector('.video-tap-layer');
  const speedBtns = article.querySelectorAll('.speed-btn');

  isVideoLiked(currentUserId, videoId).then((liked) => setLikeState(likeBtn, liked));
  isVideoBookmarked(currentUserId, videoId).then((saved) => setBookmarkState(bookmarkBtn, saved));

  likeBtn?.addEventListener('click', async () => {
    const nowLiked = await toggleVideoLike(currentUserId, videoId);
    setLikeState(likeBtn, nowLiked);
  });

  bookmarkBtn?.addEventListener('click', async () => {
    const nowSaved = await toggleVideoBookmark(currentUserId, videoId);
    setBookmarkState(bookmarkBtn, nowSaved);
  });

  // Share menu toggle
  shareBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.share-menu').forEach((m) => {
      if (m !== shareMenu) m.classList.add('hidden');
    });
    shareMenu?.classList.toggle('hidden');
  });

  shareMenu?.querySelectorAll('.share-menu-item').forEach((item) => {
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = item.dataset.action;
      shareMenu.classList.add('hidden');

      if (action === 'copy') {
        await navigator.clipboard.writeText(`https://www.youtube.com/watch?v=${videoId}`);
        flashShareFeedback(shareBtn, 'Copied!');
      } else if (action === 'forward') {
        openForwardPicker(video);
      } else if (action === 'status') {
        flashShareFeedback(shareBtn, 'Coming soon');
      }
    });
  });

  // Play/pause: both the dedicated button and tapping anywhere on the
  // video area toggle playback -- this only works via the Player API
  // because the iframe itself has pointer-events:none (see CSS), so
  // these two elements are what actually receive the touch/click.
  const togglePlayback = () => {
    const player = players[videoId];
    if (!player || typeof player.getPlayerState !== 'function') return;
    const state = player.getPlayerState();
    if (state === 1) {
      player.pauseVideo();
    } else {
      player.playVideo();
    }
  };
  playPauseBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePlayback();
  });
  tapLayer?.addEventListener('click', togglePlayback);

  speedBtns.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const rate = parseFloat(btn.dataset.speed);
      const player = players[videoId];
      player?.setPlaybackRate(rate);
      speedBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

function flashShareFeedback(shareBtn, message) {
  const label = shareBtn.querySelector('span');
  if (!label) return;
  const original = label.textContent;
  label.textContent = message;
  setTimeout(() => (label.textContent = original), 1500);
}

// Close any open share menu when tapping elsewhere on the page
document.addEventListener('click', () => {
  document.querySelectorAll('.share-menu').forEach((m) => m.classList.add('hidden'));
});

// ---------------------------------------------------------------------
// Forward-to-friend picker (lightweight, built inline -- not the full
// compose modal, just enough to pick a mutual friend and send)
// ---------------------------------------------------------------------

async function openForwardPicker(video) {
  const friends = await getMutualFriends(currentUserId);
  if (friends.length === 0) {
    alert('You need a mutual friend to forward videos to.');
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'forward-picker-overlay';
  overlay.innerHTML = `
    <div class="forward-picker-panel">
      <h4>Send to a friend</h4>
      <div class="forward-picker-list">
        ${friends
          .map(
            (f) => `<button type="button" class="forward-picker-item" data-user-id="${f.id}">
              <img src="${f.avatar_url || `https://placehold.co/60x60/1a1625/f2ede4?text=${(f.display_name || f.username || '?')[0].toUpperCase()}`}" alt="" />
              <span>${f.display_name || f.username}</span>
            </button>`
          )
          .join('')}
      </div>
      <button type="button" class="forward-picker-cancel">Cancel</button>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('.forward-picker-cancel')?.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelectorAll('.forward-picker-item').forEach((item) => {
    item.addEventListener('click', async () => {
      const friendId = item.dataset.userId;
      const conversationId = await getOrCreateConversation(friendId);
      await sendMessage({
        conversationId,
        senderId: currentUserId,
        content: video.title,
        messageType: 'forwarded_video',
        externalRefId: video.videoId,
      });
      await recordFriendInteraction(friendId);
      overlay.remove();
    });
  });
}

function setLikeState(btn, liked) {
  if (!btn) return;
  btn.innerHTML = liked ? `${HEART_FILLED}<span>Liked</span>` : `${HEART_ICON}<span>Like</span>`;
  btn.classList.toggle('active', liked);
}

function setBookmarkState(btn, saved) {
  if (!btn) return;
  btn.innerHTML = saved ? `${BOOKMARK_FILLED}<span>Saved</span>` : `${BOOKMARK_ICON}<span>Save</span>`;
  btn.classList.toggle('active', saved);
}

// ---------------------------------------------------------------------
// Active-card playback via the Player API
// ---------------------------------------------------------------------

async function setCardActive(card, active) {
  const videoId = card.dataset.videoId;
  const mount = card.querySelector('.player-mount');
  const playPauseBtn = card.querySelector('.play-pause-btn');
  if (!mount) return;

  if (active) {
    await ensurePlayerCreated(card);
    players[videoId]?.playVideo();
    preloadAdjacentCards(card);
  } else if (players[videoId]) {
    players[videoId].pauseVideo();
  }
}

/** Creates (but doesn't necessarily play) a player for a card, if it doesn't already have one. */
async function ensurePlayerCreated(card) {
  const videoId = card.dataset.videoId;
  const mount = card.querySelector('.player-mount');
  const playPauseBtn = card.querySelector('.play-pause-btn');
  if (players[videoId] || !mount) return;

  await loadYouTubeApi();
  players[videoId] = new YT.Player(mount, {
    videoId,
    host: 'https://www.youtube-nocookie.com',
    playerVars: { autoplay: 0, playsinline: 1, controls: 0, rel: 0, modestbranding: 1 },
    events: {
      onStateChange: (e) => {
        if (playPauseBtn) playPauseBtn.innerHTML = e.data === 1 ? PAUSE_ICON : PLAY_ICON;
      },
    },
  });
}

/**
 * Quietly creates (paused, not playing) players for the card directly
 * after the active one, so scrolling to it is instant instead of
 * cold-starting a fresh player at that moment. This is the main real
 * fix for "loading feels slow" -- the network/init work happens ahead
 * of time while the user is still watching the current video.
 */
function preloadAdjacentCards(activeCard) {
  const next = activeCard.nextElementSibling;
  if (next && next.classList.contains('video-card')) {
    ensurePlayerCreated(next);
  }
}

let activeCardObserver = null;

function observeCardsForAutoplay() {
  activeCardObserver?.disconnect();
  activeCardObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        setCardActive(entry.target, entry.isIntersecting && entry.intersectionRatio > 0.6);
      });
    },
    { root: feedContainer, threshold: [0, 0.6, 1] }
  );
  feedContainer?.querySelectorAll('.video-card').forEach((card) => activeCardObserver.observe(card));
}

// ---------------------------------------------------------------------
// Feed loading
// ---------------------------------------------------------------------

async function loadVideos({ append = false } = {}) {
  if (isLoadingMore || feedExhausted) return;
  isLoadingMore = true;
  if (loadingEl) loadingEl.classList.remove('hidden');

  try {
    const result = await searchYoutubeVideos({
      query: 'anime amv',
      maxResults: 10,
      pageToken: append ? nextPageToken : undefined,
    });

    if (!append && feedContainer) {
      feedContainer.querySelectorAll('.video-card').forEach((el) => el.remove());
    }

    if (!result.videos || result.videos.length === 0) {
      feedExhausted = true;
      return;
    }

    result.videos.forEach((video) => {
      if (video.videoId) feedContainer?.appendChild(buildVideoCard(video));
    });

    observeCardsForAutoplay();

    nextPageToken = result.nextPageToken;
    if (!nextPageToken) feedExhausted = true;
  } catch (err) {
    console.error('Failed to load YouTube feed:', err);
    if (feedContainer && !append) {
      const errorEl = document.createElement('p');
      errorEl.className = 'text-sm text-slate-500 text-center py-6';
      errorEl.textContent = 'Could not load videos. Check the connection or try again shortly.';
      feedContainer.appendChild(errorEl);
    }
  } finally {
    isLoadingMore = false;
    if (loadingEl) loadingEl.classList.add('hidden');
  }
}

if (loadMoreTrigger) {
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting) loadVideos({ append: true });
    },
    { rootMargin: '200px' }
  );
  observer.observe(loadMoreTrigger);
}

(async () => {
  const session = await requireAuth();
  if (!session) return;
  const profile = await requireProfile(session);
  if (!profile) return;

  currentUserId = session.user.id;
  await loadVideos({ append: false });
})();
