// Real News feed logic: the original Kaidra concept, restored as its
// own Home sub-section (separate from Videos, not interleaved). Pulls
// from the news-feed Edge Function (ANN, Crunchyroll News, Anime
// Corner RSS, parsed server-side), renders article cards, wires
// bookmarking to the existing user_bookmarks table (article_id was
// always free-form text, so no schema change needed here).

import {
  requireAuth,
  requireProfile,
  fetchNewsFeed,
  toggleVideoBookmark,
  isVideoBookmarked,
  getMutualFriends,
  getOrCreateConversation,
  sendMessage,
  recordFriendInteraction,
} from './supabase-client.js';

let currentUserId = null;

const newsContainer = document.getElementById('news-feed-container');
const newsLoading = document.getElementById('news-loading');
const newsEmptyState = document.getElementById('news-empty-state');

function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diffMs / 3600000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function buildNewsCard(article) {
  const card = document.createElement('article');
  card.className = 'news-card';
  card.dataset.articleId = article.articleId;

  const fallbackImage = `https://placehold.co/600x320/1a1625/f2ede4?text=${encodeURIComponent(article.source)}`;

  card.innerHTML = `
    <img src="${article.imageUrl || fallbackImage}" alt="" loading="lazy" onerror="this.src='${fallbackImage}'" />
    <div class="news-card-body">
      <span class="news-card-source">${article.source}</span>
      <h3 class="news-card-title">${article.title}</h3>
      <p class="news-card-summary">${article.summary}</p>
      <div class="news-card-footer">
        <span class="news-card-time">${formatRelativeTime(article.publishedAt)}</span>
        <div class="flex items-center gap-3">
          <button type="button" class="news-forward-btn" data-article-id="${article.articleId}" aria-label="Forward">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/></svg>
          </button>
          <button type="button" class="news-bookmark-btn" data-article-id="${article.articleId}" aria-label="Bookmark">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>
          </button>
        </div>
      </div>
    </div>
  `;

  card.addEventListener('click', (e) => {
    if (e.target.closest('.news-bookmark-btn') || e.target.closest('.news-forward-btn')) return;
    window.open(article.link, '_blank', 'noopener');
  });

  const bookmarkBtn = card.querySelector('.news-bookmark-btn');
  isVideoBookmarked(currentUserId, article.articleId).then((saved) => {
    bookmarkBtn?.classList.toggle('active', saved);
  });
  bookmarkBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const nowSaved = await toggleVideoBookmark(currentUserId, article.articleId);
    bookmarkBtn.classList.toggle('active', nowSaved);
  });

  const forwardBtn = card.querySelector('.news-forward-btn');
  forwardBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    openNewsForwardPicker(article);
  });

  return card;
}

async function openNewsForwardPicker(article) {
  const friends = await getMutualFriends(currentUserId);
  if (friends.length === 0) {
    alert('You need a mutual friend to forward articles to.');
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
        content: article.title,
        messageType: 'forwarded_news',
        externalRefId: article.articleId,
      });
      await recordFriendInteraction(friendId);
      overlay.remove();
    });
  });
}

async function loadNews() {
  if (!newsContainer) return;
  newsLoading?.classList.remove('hidden');
  newsEmptyState?.classList.add('hidden');

  try {
    const articles = await fetchNewsFeed();
    newsContainer.innerHTML = '';

    if (articles.length === 0) {
      newsEmptyState?.classList.remove('hidden');
      newsEmptyState?.classList.add('flex');
      return;
    }

    articles.forEach((article) => newsContainer.appendChild(buildNewsCard(article)));
  } catch (err) {
    console.error('Failed to load news:', err);
    newsContainer.innerHTML = '<p class="text-sm text-slate-500 text-center py-6">Could not load news right now.</p>';
  } finally {
    newsLoading?.classList.add('hidden');
  }
}

(async () => {
  const session = await requireAuth();
  if (!session) return;
  const profile = await requireProfile(session);
  if (!profile) return;

  currentUserId = session.user.id;
  await loadNews();
})();
