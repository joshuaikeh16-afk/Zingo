// Real Home video feed logic — TikTok-style: full-screen, one video
// active at a time via the YouTube Player API (pointer-events:none on
// the generated iframe so touch always reaches our own controls and
// the outer scroll container, not the embed itself), double-tap to
// like, long-press for temporary 2x speed, a compact 3-dot speed menu
// instead of a permanently-visible speed bar, real counts (YouTube's
// real view count + our own real Supabase like/bookmark counts, never
// placeholder numbers), a thin progress bar, and a retry state if a
// video embed fails to load.

import {
  requireAuth,
  requireProfile,
  searchYoutubeVideos,
  toggleVideoLike,
  isVideoLiked,
  getVideoLikeCount,
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
const players = {};

const feedContainer = document.getElementById('video-feed-container');
const loadingEl = document.getElementById('feed-loading');
const loadMoreTrigger = document.getElementById('feed-load-more-trigger');

const HEART_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-4.318-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>';
const HEART_FILLED = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.001 4.529c2.349-2.532 6.147-2.532 8.496 0 2.348 2.531 2.348 6.635 0 9.166L12 21.997l-8.497-8.302c-2.348-2.531-2.348-6.635 0-9.166 2.349-2.532 6.147-2.532 8.496 0z"/></svg>';
const BOOKMARK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>';
const BOOKMARK_FILLED = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>';
const SHARE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/></svg>';
const COMMENT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>';
const DOTS_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>';

function loadYouTubeApi() {
  if (ytApiReadyPromise) return ytApiReadyPromise;
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
loadYouTubeApi();

// ---------------------------------------------------------------------
// Card construction
// ---------------------------------------------------------------------

function buildVideoCard(video) {
  const article = document.createElement('article');
  article.className = 'video-card';
  article.dataset.videoId = video.videoId;

  const channelInitial = (video.channelTitle || '?')[0].toUpperCase();

  article.innerHTML = `
    <div class="video-player-embed" style="background-image:url('${video.thumbnailUrl ?? ''}')">
      <div class="player-mount"></div>
      <button type="button" class="video-tap-layer" aria-label="Play/Pause/Like"></button>
      <div class="double-tap-heart">${HEART_FILLED}</div>
      <div class="speed-boost-indicator">2x Speed</div>
      <div class="video-progress-track"><div class="video-progress-fill"></div></div>
    </div>

    <button type="button" class="speed-menu-btn" aria-label="Playback speed">${DOTS_ICON}</button>
    <div class="speed-menu-popover">
      <button type="button" class="speed-menu-item" data-speed="0.5">0.5x</button>
      <button type="button" class="speed-menu-item active" data-speed="1">1x (Normal)</button>
      <button type="button" class="speed-menu-item" data-speed="1.5">1.5x</button>
      <button type="button" class="speed-menu-item" data-speed="2">2x</button>
    </div>

    <div class="feed-actions-v3">
      <button type="button" class="action-btn-v3 like-btn" data-video-id="${video.videoId}">
        <span class="icon-circle">${HEART_ICON}</span>
        <span class="count-label like-count">0</span>
      </button>
      <button type="button" class="action-btn-v3 comment-btn" aria-label="Comments not available for this video">
        <span class="icon-circle">${COMMENT_ICON}</span>
        <span class="count-label">—</span>
      </button>
      <button type="button" class="action-btn-v3 bookmark-btn" data-video-id="${video.videoId}">
        <span class="icon-circle">${BOOKMARK_ICON}</span>
        <span class="count-label bookmark-count">0</span>
      </button>
      <div class="share-wrapper">
        <button type="button" class="action-btn-v3 share-btn" data-video-id="${video.videoId}">
          <span class="icon-circle">${SHARE_ICON}</span>
          <span class="count-label">Share</span>
        </button>
        <div class="share-menu hidden">
          <button type="button" class="share-menu-item" data-action="forward">Send to a friend</button>
          <button type="button" class="share-menu-item" data-action="status">Post as status <span class="soon-tag">soon</span></button>
          <button type="button" class="share-menu-item" data-action="copy">Copy link</button>
        </div>
      </div>
    </div>

    <div class="video-info-v3">
      <div class="channel-row">
        <div class="channel-avatar">${channelInitial}</div>
        <span class="channel-name">${video.channelTitle}</span>
        <span class="source-badge">YouTube</span>
      </div>
      <p class="video-title">${video.title}${video.viewCount ? ` <span style="opacity:.55">• ${video.viewCount} views</span>` : ''}</p>
    </div>
  `;

  wireCardActions(article, video);
  return article;
}

function wireCardActions(article, video) {
  const videoId = video.videoId;
  const likeBtn = article.querySelector('.like-btn');
  const likeCountEl = article.querySelector('.like-count');
  const bookmarkBtn = article.querySelector('.bookmark-btn');
  const bookmarkCountEl = article.querySelector('.bookmark-count');
  const shareBtn = article.querySelector('.share-btn');
  const shareMenu = article.querySelector('.share-menu');
  const commentBtn = article.querySelector('.comment-btn');
  const tapLayer = article.querySelector('.video-tap-layer');
  const heartEl = article.querySelector('.double-tap-heart');
  const speedMenuBtn = article.querySelector('.speed-menu-btn');
  const speedMenuPopover = article.querySelector('.speed-menu-popover');
  const speedMenuItems = article.querySelectorAll('.speed-menu-item');
  const speedBoostIndicator = article.querySelector('.speed-boost-indicator');

  // --- Real counts ---
  isVideoLiked(currentUserId, videoId).then((liked) => setLikeState(likeBtn, liked));
  getVideoLikeCount(videoId).then((count) => {
    if (likeCountEl) likeCountEl.textContent = formatCount(count);
  });
  isVideoBookmarked(currentUserId, videoId).then((saved) => setBookmarkState(bookmarkBtn, saved));
  // Bookmark count intentionally not shown as a number (no aggregate
  // bookmark-count query built yet) -- showing 0 for everyone would be
  // misleading, so this stays blank rather than fake.
  if (bookmarkCountEl) bookmarkCountEl.textContent = '';

  async function doLike() {
    const nowLiked = await toggleVideoLike(currentUserId, videoId);
    setLikeState(likeBtn, nowLiked);
    const count = await getVideoLikeCount(videoId);
    if (likeCountEl) likeCountEl.textContent = formatCount(count);
    return nowLiked;
  }

  likeBtn?.addEventListener('click', doLike);

  bookmarkBtn?.addEventListener('click', async () => {
    const nowSaved = await toggleVideoBookmark(currentUserId, videoId);
    setBookmarkState(bookmarkBtn, nowSaved);
  });

  commentBtn?.addEventListener('click', () => {
    flashLabel(commentBtn.querySelector('.count-label'), 'No comments');
  });

  // --- Share menu ---
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
      } else if (action === 'forward') {
        openForwardPicker(video);
      }
    });
  });

  // --- Speed menu (3-dot, replaces the old permanent speed bar) ---
  speedMenuBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.speed-menu-popover').forEach((p) => {
      if (p !== speedMenuPopover) p.classList.remove('open');
    });
    speedMenuPopover?.classList.toggle('open');
  });

  speedMenuItems.forEach((item) => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const rate = parseFloat(item.dataset.speed);
      players[videoId]?.setPlaybackRate(rate);
      speedMenuItems.forEach((i) => i.classList.remove('active'));
      item.classList.add('active');
      speedMenuPopover.classList.remove('open');
    });
  });

  // --- Tap interactions: single tap = play/pause, double tap = like
  // with heart animation at tap position, long press = temp 2x speed ---
  let tapTimeout = null;
  let longPressTimer = null;
  let longPressActive = false;
  let normalSpeedBeforeBoost = 1;

  function togglePlayback() {
    const player = players[videoId];
    if (!player || typeof player.getPlayerState !== 'function') return;
    player.getPlayerState() === 1 ? player.pauseVideo() : player.playVideo();
  }

  function showHeartAt(x, y) {
    if (!heartEl) return;
    heartEl.style.left = `${x}px`;
    heartEl.style.top = `${y}px`;
    heartEl.classList.remove('animate');
    void heartEl.offsetWidth; // restart animation
    heartEl.classList.add('animate');
  }

  tapLayer?.addEventListener('click', (e) => {
    if (tapTimeout) {
      // Second click within the window = double tap
      clearTimeout(tapTimeout);
      tapTimeout = null;
      const rect = tapLayer.getBoundingClientRect();
      showHeartAt(e.clientX - rect.left, e.clientY - rect.top);
      doLike();
    } else {
      tapTimeout = setTimeout(() => {
        tapTimeout = null;
        togglePlayback();
      }, 260);
    }
  });

  tapLayer?.addEventListener('pointerdown', () => {
    longPressActive = false;
    longPressTimer = setTimeout(() => {
      longPressActive = true;
      const player = players[videoId];
      if (player?.getPlaybackRate) {
        normalSpeedBeforeBoost = player.getPlaybackRate();
        player.setPlaybackRate(2);
      }
      speedBoostIndicator?.classList.add('visible');
    }, 500);
  });

  function endLongPress() {
    clearTimeout(longPressTimer);
    if (longPressActive) {
      const player = players[videoId];
      player?.setPlaybackRate(normalSpeedBeforeBoost);
      speedBoostIndicator?.classList.remove('visible');
      longPressActive = false;
    }
  }
  tapLayer?.addEventListener('pointerup', endLongPress);
  tapLayer?.addEventListener('pointerleave', endLongPress);
}

function flashLabel(el, message) {
  if (!el) return;
  const original = el.textContent;
  el.textContent = message;
  setTimeout(() => (el.textContent = original), 1500);
}

function formatCount(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

document.addEventListener('click', () => {
  document.querySelectorAll('.share-menu').forEach((m) => m.classList.add('hidden'));
  document.querySelectorAll('.speed-menu-popover').forEach((p) => p.classList.remove('open'));
});

// ---------------------------------------------------------------------
// Forward-to-friend picker
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
  const iconEl = btn.querySelector('.icon-circle');
  if (iconEl) iconEl.innerHTML = liked ? HEART_FILLED : HEART_ICON;
  btn.classList.toggle('active', liked);
}

function setBookmarkState(btn, saved) {
  if (!btn) return;
  const iconEl = btn.querySelector('.icon-circle');
  if (iconEl) iconEl.innerHTML = saved ? BOOKMARK_FILLED : BOOKMARK_ICON;
  btn.classList.toggle('active', saved);
}

// ---------------------------------------------------------------------
// Active-card playback, progress bar, preload, error/retry state
// ---------------------------------------------------------------------

let progressInterval = null;

function startProgressTracking(card, videoId) {
  clearInterval(progressInterval);
  const fill = card.querySelector('.video-progress-fill');
  if (!fill) return;
  progressInterval = setInterval(() => {
    const player = players[videoId];
    if (!player || typeof player.getDuration !== 'function') return;
    const duration = player.getDuration();
    const current = player.getCurrentTime();
    if (duration > 0) {
      fill.style.width = `${Math.min(100, (current / duration) * 100)}%`;
    }
  }, 250);
}

async function setCardActive(card, active) {
  const videoId = card.dataset.videoId;
  if (active) {
    await ensurePlayerCreated(card);
    players[videoId]?.playVideo();
    startProgressTracking(card, videoId);
    preloadAdjacentCards(card);
  } else if (players[videoId]) {
    players[videoId].pauseVideo();
    clearInterval(progressInterval);
  }
}

async function ensurePlayerCreated(card) {
  const videoId = card.dataset.videoId;
  const mount = card.querySelector('.player-mount');
  if (players[videoId] || !mount) return;

  await loadYouTubeApi();
  players[videoId] = new YT.Player(mount, {
    videoId,
    host: 'https://www.youtube-nocookie.com',
    playerVars: { autoplay: 0, playsinline: 1, controls: 0, rel: 0, modestbranding: 1, loop: 1, playlist: videoId },
    events: {
      onError: () => showErrorState(card),
    },
  });
}

function showErrorState(card) {
  if (card.querySelector('.video-error-state')) return;
  const errorEl = document.createElement('div');
  errorEl.className = 'video-error-state';
  errorEl.innerHTML = `<p>Video unavailable</p><button type="button">Retry</button>`;
  errorEl.querySelector('button')?.addEventListener('click', () => {
    errorEl.remove();
    delete players[card.dataset.videoId];
    ensurePlayerCreated(card).then(() => players[card.dataset.videoId]?.playVideo());
  });
  card.querySelector('.video-player-embed')?.appendChild(errorEl);
}

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

let hasLoadedOnce = false;

(async () => {
  const session = await requireAuth();
  if (!session) return;
  const profile = await requireProfile(session);
  if (!profile) return;

  currentUserId = session.user.id;

  const videosTab = document.getElementById('home-subtab-videos');
  videosTab?.addEventListener('click', () => {
    if (!hasLoadedOnce) {
      hasLoadedOnce = true;
      loadVideos({ append: false });
    }
  });
})();
