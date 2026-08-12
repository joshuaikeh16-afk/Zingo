// Real Home feed logic: pulls videos from the youtube-feed Edge
// Function, renders real video cards, wires like/bookmark, and handles
// infinite scroll. Runs alongside inbox.js -- both attach independently
// to app.html.

import {
  requireAuth,
  requireProfile,
  searchYoutubeVideos,
  toggleVideoLike,
  isVideoLiked,
  toggleVideoBookmark,
  isVideoBookmarked,
} from './supabase-client.js';

let currentUserId = null;
let nextPageToken = null;
let isLoadingMore = false;
let feedExhausted = false;

const feedContainer = document.getElementById('video-feed-container');
const loadingEl = document.getElementById('feed-loading');
const loadMoreTrigger = document.getElementById('feed-load-more-trigger');

const HEART_ICON = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-4.318-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>';
const HEART_FILLED = '<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12.001 4.529c2.349-2.532 6.147-2.532 8.496 0 2.348 2.531 2.348 6.635 0 9.166L12 21.997l-8.497-8.302c-2.348-2.531-2.348-6.635 0-9.166 2.349-2.532 6.147-2.532 8.496 0z"/></svg>';
const BOOKMARK_ICON = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>';
const BOOKMARK_FILLED = '<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>';

function buildVideoCard(video) {
  const article = document.createElement('article');
  article.className = 'video-card glass-panel rounded-2xl overflow-hidden border border-slate-800/80 shadow-lg';

  const publishedLabel = video.publishedAt
    ? new Date(video.publishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  article.innerHTML = `
    <div class="video-player-embed relative aspect-video bg-slate-900 overflow-hidden group">
      <iframe class="w-full h-full" src="https://www.youtube.com/embed/${video.videoId}" title="${video.title}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
    </div>
    <div class="p-3.5 space-y-2">
      <h3 class="video-title text-sm font-semibold text-white line-clamp-2">${video.title}</h3>
      <p class="video-channel text-xs text-slate-400 font-medium">${video.channelTitle}${publishedLabel ? ' • ' + publishedLabel : ''}</p>
      <div class="flex items-center justify-between pt-2 border-t border-slate-800/60 text-xs">
        <button type="button" class="like-btn text-slate-400 hover:text-rose-400 flex items-center gap-1.5 transition-colors cursor-pointer" data-video-id="${video.videoId}">
          ${HEART_ICON}<span>Like</span>
        </button>
        <button type="button" class="bookmark-btn text-slate-400 hover:text-amber-400 flex items-center gap-1.5 transition-colors cursor-pointer" data-video-id="${video.videoId}">
          ${BOOKMARK_ICON}<span>Save</span>
        </button>
        <button type="button" class="share-btn text-slate-400 hover:text-violet-400 flex items-center gap-1.5 transition-colors cursor-pointer" data-video-id="${video.videoId}">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/></svg>
          <span>Share</span>
        </button>
      </div>
    </div>
  `;

  wireCardActions(article, video.videoId);
  return article;
}

function wireCardActions(article, videoId) {
  const likeBtn = article.querySelector('.like-btn');
  const bookmarkBtn = article.querySelector('.bookmark-btn');
  const shareBtn = article.querySelector('.share-btn');

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

  shareBtn?.addEventListener('click', async () => {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    if (navigator.share) {
      navigator.share({ url }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(url);
      const label = shareBtn.querySelector('span');
      if (label) {
        const original = label.textContent;
        label.textContent = 'Copied!';
        setTimeout(() => (label.textContent = original), 1500);
      }
    }
  });
}

function setLikeState(btn, liked) {
  if (!btn) return;
  btn.innerHTML = liked
    ? `${HEART_FILLED}<span>Liked</span>`
    : `${HEART_ICON}<span>Like</span>`;
  btn.classList.toggle('text-rose-400', liked);
  btn.classList.toggle('text-slate-400', !liked);
}

function setBookmarkState(btn, saved) {
  if (!btn) return;
  btn.innerHTML = saved
    ? `${BOOKMARK_FILLED}<span>Saved</span>`
    : `${BOOKMARK_ICON}<span>Save</span>`;
  btn.classList.toggle('text-amber-400', saved);
  btn.classList.toggle('text-slate-400', !saved);
}

async function loadVideos({ append = false } = {}) {
  if (isLoadingMore || feedExhausted) return;
  isLoadingMore = true;
  if (loadingEl) loadingEl.classList.remove('hidden');

  try {
    const result = await searchYoutubeVideos({
      query: 'anime amv OR anime trailer OR anime OST',
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

    nextPageToken = result.nextPageToken;
    if (!nextPageToken) feedExhausted = true;
  } catch (err) {
    console.error('Failed to load YouTube feed:', err);
    if (feedContainer && !append) {
      const errorEl = document.createElement('p');
      errorEl.className = 'text-sm text-slate-500 text-center py-6';
      errorEl.textContent = 'Could not load videos. The YouTube API key may not be set yet.';
      feedContainer.appendChild(errorEl);
    }
  } finally {
    isLoadingMore = false;
    if (loadingEl) loadingEl.classList.add('hidden');
  }
}

// Infinite scroll
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
