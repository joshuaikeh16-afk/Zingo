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
  toggleVideoBookmark, // generic bookmark toggle -- works for any article_id string, not YouTube-specific despite the name
  isVideoBookmarked,
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

  card.innerHTML = `
    ${article.imageUrl ? `<img src="${article.imageUrl}" alt="" loading="lazy" />` : ''}
    <div class="news-card-body">
      <span class="news-card-source">${article.source}</span>
      <h3 class="news-card-title">${article.title}</h3>
      <p class="news-card-summary">${article.summary}</p>
      <div class="news-card-footer">
        <span class="news-card-time">${formatRelativeTime(article.publishedAt)}</span>
        <button type="button" class="news-bookmark-btn" data-article-id="${article.articleId}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>
        </button>
      </div>
    </div>
  `;

  card.addEventListener('click', (e) => {
    if (e.target.closest('.news-bookmark-btn')) return;
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

  return card;
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
