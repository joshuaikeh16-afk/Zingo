// Real Home Videos logic — no longer YouTube-sourced. Shows real
// user-posted videos from mutual friends (same visibility rule as
// everything else in `posts`: mutual friends only, 24h expiry). Same
// TikTok-style interaction model as before (double-tap to like,
// long-press for 2x speed, real counts) but now driven by our own
// video files in Supabase Storage instead of embedded YouTube iframes,
// and comments are real now since there's an actual author to comment
// at (unlike YouTube content, which had none).

import {
  requireAuth,
  requireProfile,
  getFriendsVideoPosts,
  toggleVideoLike,
  isVideoLiked,
  getVideoLikeCount,
  getComments,
  addComment,
  getCommentCount,
  getMutualFriends,
  getOrCreateConversation,
  sendMessage,
  recordFriendInteraction,
} from './supabase-client.js';

let currentUserId = null;
const feedContainer = document.getElementById('video-feed-container');
const emptyState = document.getElementById('video-feed-empty-state');

const HEART_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-4.318-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>';
const HEART_FILLED = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.001 4.529c2.349-2.532 6.147-2.532 8.496 0 2.348 2.531 2.348 6.635 0 9.166L12 21.997l-8.497-8.302c-2.348-2.531-2.348-6.635 0-9.166 2.349-2.532 6.147-2.532 8.496 0z"/></svg>';
const COMMENT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>';
const SHARE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/></svg>';

function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diffMs / 3600000);
  if (hours < 1) return 'just now';
  return `${hours}h ago`;
}

function formatCount(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

function buildVideoCard(post) {
  const author = post.profiles ?? {};
  const name = author.display_name || author.username || 'Kaidra user';
  const initial = name[0]?.toUpperCase() ?? '?';

  const article = document.createElement('article');
  article.className = 'video-card';
  article.dataset.postId = post.id;

  article.innerHTML = `
    <div class="video-player-embed">
      <video class="video-el" src="${post.media_url}" playsinline loop muted></video>
      <button type="button" class="video-tap-layer" aria-label="Play/Pause/Like"></button>
      <div class="double-tap-heart">${HEART_FILLED}</div>
      <div class="speed-boost-indicator">2x Speed</div>
      <div class="video-progress-track"><div class="video-progress-fill"></div></div>
    </div>

    <div class="feed-actions-v3">
      <button type="button" class="action-btn-v3 like-btn">
        <span class="icon-circle">${HEART_ICON}</span>
        <span class="count-label like-count">0</span>
      </button>
      <button type="button" class="action-btn-v3 comment-btn">
        <span class="icon-circle">${COMMENT_ICON}</span>
        <span class="count-label comment-count">0</span>
      </button>
      <div class="share-wrapper">
        <button type="button" class="action-btn-v3 share-btn">
          <span class="icon-circle">${SHARE_ICON}</span>
          <span class="count-label">Share</span>
        </button>
        <div class="share-menu hidden">
          <button type="button" class="share-menu-item" data-action="forward">Send to a friend</button>
        </div>
      </div>
    </div>

    <div class="video-info-v3">
      <div class="channel-row">
        <div class="channel-avatar">${initial}</div>
        <span class="channel-name">${name}</span>
      </div>
      <p class="video-title">${post.caption ?? ''} <span style="opacity:.55">• ${timeAgo(post.created_at)}</span></p>
    </div>

    <div class="comment-sheet hidden">
      <div class="comment-sheet-header">
        <h4>Comments</h4>
        <button type="button" class="comment-sheet-close">✕</button>
      </div>
      <div class="comment-list"></div>
      <div class="comment-input-row">
        <input type="text" class="comment-input" placeholder="Add a comment..." />
        <button type="button" class="comment-send-btn">Send</button>
      </div>
    </div>
  `;

  wireCardActions(article, post);
  return article;
}

function wireCardActions(article, post) {
  const postId = post.id;
  const videoEl = article.querySelector('.video-el');
  const tapLayer = article.querySelector('.video-tap-layer');
  const heartEl = article.querySelector('.double-tap-heart');
  const speedBoostIndicator = article.querySelector('.speed-boost-indicator');
  const progressFill = article.querySelector('.video-progress-fill');
  const likeBtn = article.querySelector('.like-btn');
  const likeCountEl = article.querySelector('.like-count');
  const commentBtn = article.querySelector('.comment-btn');
  const commentCountEl = article.querySelector('.comment-count');
  const commentSheet = article.querySelector('.comment-sheet');

  isVideoLiked(currentUserId, postId).then((liked) => setLikeState(likeBtn, liked));
  getVideoLikeCount(postId).then((c) => (likeCountEl.textContent = formatCount(c)));
  getCommentCount(postId).then((c) => (commentCountEl.textContent = formatCount(c)));

  async function doLike() {
    const nowLiked = await toggleVideoLike(currentUserId, postId);
    setLikeState(likeBtn, nowLiked);
    getVideoLikeCount(postId).then((c) => (likeCountEl.textContent = formatCount(c)));
  }
  likeBtn?.addEventListener('click', doLike);

  // --- Tap: single = play/pause, double = like + heart animation ---
  let tapTimeout = null;
  let longPressTimer = null;
  let longPressActive = false;

  function togglePlayback() {
    if (videoEl.paused) videoEl.play(); else videoEl.pause();
  }

  function showHeartAt(x, y) {
    heartEl.style.left = `${x}px`;
    heartEl.style.top = `${y}px`;
    heartEl.classList.remove('animate');
    void heartEl.offsetWidth;
    heartEl.classList.add('animate');
  }

  tapLayer?.addEventListener('click', (e) => {
    if (tapTimeout) {
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
      videoEl.playbackRate = 2;
      speedBoostIndicator?.classList.add('visible');
    }, 500);
  });
  function endLongPress() {
    clearTimeout(longPressTimer);
    if (longPressActive) {
      videoEl.playbackRate = 1;
      speedBoostIndicator?.classList.remove('visible');
      longPressActive = false;
    }
  }
  tapLayer?.addEventListener('pointerup', endLongPress);
  tapLayer?.addEventListener('pointerleave', endLongPress);

  videoEl?.addEventListener('timeupdate', () => {
    if (videoEl.duration > 0 && progressFill) {
      progressFill.style.width = `${(videoEl.currentTime / videoEl.duration) * 100}%`;
    }
  });

  // --- Comments ---
  commentBtn?.addEventListener('click', () => openComments());

  // --- Share (forward to a mutual friend) ---
  const shareBtn = article.querySelector('.share-btn');
  const shareMenu = article.querySelector('.share-menu');
  shareBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.share-menu').forEach((m) => {
      if (m !== shareMenu) m.classList.add('hidden');
    });
    shareMenu?.classList.toggle('hidden');
  });
  shareMenu?.querySelector('[data-action="forward"]')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    shareMenu.classList.add('hidden');
    openForwardPicker(post);
  });

  async function openComments() {
    commentSheet.classList.remove('hidden');
    videoEl.pause();
    await renderComments();
  }

  async function renderComments() {
    const list = article.querySelector('.comment-list');
    const comments = await getComments(postId);
    list.innerHTML = comments.length
      ? comments
          .map((c) => {
            const cName = c.profiles?.display_name || c.profiles?.username || 'User';
            return `<div class="comment-row"><strong>${cName}</strong><span>${c.content}</span></div>`;
          })
          .join('')
      : '<p class="text-xs text-slate-500 text-center py-6">Be the first to comment.</p>';
  }

  article.querySelector('.comment-sheet-close')?.addEventListener('click', () => {
    commentSheet.classList.add('hidden');
  });

  const commentInput = article.querySelector('.comment-input');
  article.querySelector('.comment-send-btn')?.addEventListener('click', async () => {
    const text = commentInput.value.trim();
    if (!text) return;
    commentInput.value = '';
    await addComment(postId, currentUserId, text);
    await renderComments();
    getCommentCount(postId).then((c) => (commentCountEl.textContent = formatCount(c)));
  });
  commentInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') article.querySelector('.comment-send-btn')?.click();
  });
}

function setLikeState(btn, liked) {
  if (!btn) return;
  const iconEl = btn.querySelector('.icon-circle');
  if (iconEl) iconEl.innerHTML = liked ? HEART_FILLED : HEART_ICON;
  btn.classList.toggle('active', liked);
}

async function openForwardPicker(post) {
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
        content: post.caption || 'Check out this video',
        messageType: 'forwarded_video',
        externalRefId: post.id,
      });
      await recordFriendInteraction(friendId);
      overlay.remove();
    });
  });
}

let activeCardObserver = null;

function observeCardsForAutoplay() {
  activeCardObserver?.disconnect();
  activeCardObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const videoEl = entry.target.querySelector('.video-el');
        if (!videoEl) return;
        if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
          videoEl.play().catch(() => {});
        } else {
          videoEl.pause();
        }
      });
    },
    { root: feedContainer, threshold: [0, 0.6, 1] }
  );
  feedContainer?.querySelectorAll('.video-card').forEach((card) => activeCardObserver.observe(card));
}

async function loadVideos() {
  if (!feedContainer) return;
  const posts = await getFriendsVideoPosts(currentUserId);
  feedContainer.innerHTML = '';

  if (posts.length === 0) {
    emptyState?.classList.remove('hidden');
    emptyState?.classList.add('flex');
    return;
  }
  emptyState?.classList.add('hidden');
  emptyState?.classList.remove('flex');

  posts.forEach((post) => feedContainer.appendChild(buildVideoCard(post)));
  observeCardsForAutoplay();
}

let hasLoadedOnce = false;

document.addEventListener('click', () => {
  document.querySelectorAll('.share-menu').forEach((m) => m.classList.add('hidden'));
});

(async () => {
  const session = await requireAuth();
  if (!session) return;
  const profile = await requireProfile(session);
  if (!profile) return;

  currentUserId = session.user.id;

  const videosTabButtons = [
    document.getElementById('home-subtab-videos'),
    document.getElementById('home-subtab-videos-from-news'),
  ];
  videosTabButtons.forEach((btn) => {
    btn?.addEventListener('click', () => {
      if (!hasLoadedOnce) {
        hasLoadedOnce = true;
        loadVideos();
      }
    });
  });
})();
