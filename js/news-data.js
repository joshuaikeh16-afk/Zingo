/* ==========================================================================
   Kaidra — News Feed Controller
   Scroll-only feed. Categories match the real interest taxonomy from
   onboarding (anime, news, gaming, idols_music, art_manga, vtubers) so
   personalization actually maps onto what shows here.
   ========================================================================== */

// ------------------------------------------------------------------
// Fallback dataset — used only if the real /api/news fetch fails
// (e.g. offline, or every upstream RSS source down at once).
// ------------------------------------------------------------------
const KAIDRA_NEWS_FALLBACK = [
  {
    id: "art-101",
    title: "Studio MAPPA Unveils Original Sci-Fi Anime Project Scheduled for Late 2026",
    category: "anime",
    categoryLabel: "Anime",
    badgeColor: "pink",
    author: "Kaidra",
    sourceUrl: "",
    timeAgo: "2 hours ago",
    coverImage: "https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=1000&q=80",
    snippet: "The studio behind major hits has revealed an ambitious original space drama project coming later this year.",
    relatedAnimeId: null,
    relatedAnimeTitle: null
  },
  {
    id: "art-102",
    title: "Chainsaw Man Sequel Movie Confirmed",
    category: "anime",
    categoryLabel: "Anime",
    badgeColor: "pink",
    author: "Kaidra",
    sourceUrl: "",
    timeAgo: "4 hours ago",
    coverImage: "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?auto=format&fit=crop&w=600&q=80",
    snippet: "Official teaser visuals confirming the upcoming theatrical continuation have been released online.",
    relatedAnimeId: 105778,
    relatedAnimeTitle: "Chainsaw Man"
  },
  {
    id: "art-105",
    title: "Global Markets Steady as Central Banks Hold Rates",
    category: "news",
    categoryLabel: "World News",
    badgeColor: "cyan",
    author: "Kaidra",
    sourceUrl: "",
    timeAgo: "1 hour ago",
    coverImage: "https://images.unsplash.com/photo-1495020689067-958852a7765e?auto=format&fit=crop&w=800&q=80",
    snippet: "A general news placeholder story -- this category is meant for everyone, not just anime fans.",
    relatedAnimeId: null,
    relatedAnimeTitle: null
  },
  {
    id: "art-104",
    title: "Top 10 Highly Anticipated Manga Adaptations Coming Soon",
    category: "art_manga",
    categoryLabel: "Art & Manga",
    badgeColor: "purple",
    author: "Kaidra",
    sourceUrl: "",
    timeAgo: "12 hours ago",
    coverImage: "https://images.unsplash.com/photo-1563089145-599997674d42?auto=format&fit=crop&w=600&q=80",
    snippet: "From dark fantasy epics to cozy slice-of-life titles, here are the top adaptations to keep on your radar.",
    relatedAnimeId: null,
    relatedAnimeTitle: null
  }
];

// ------------------------------------------------------------------
// State
// ------------------------------------------------------------------
let currentNewsData = [];
let activeCategory = 'all';
let bookmarkedArticleIds = new Set();
let likedArticleIds = new Set();

function getFilteredData() {
  return activeCategory === 'all'
    ? currentNewsData
    : currentNewsData.filter(item => item.category === activeCategory);
}

function findArticleById(id) {
  return currentNewsData.find(item => item.id === id);
}

// ------------------------------------------------------------------
// Shared markup helpers
// ------------------------------------------------------------------
function animeTagMarkup(item) {
  if (!item.relatedAnimeTitle) return '';
  return `<button class="anime-tag-badge" data-action="view-anime" data-anime-id="${item.relatedAnimeId || ''}" data-anime-title="${item.relatedAnimeTitle}">About: ${item.relatedAnimeTitle}</button>`;
}

// ------------------------------------------------------------------
// Render — scroll feed only
// ------------------------------------------------------------------
function renderNewsScroll(filteredData) {
  const scrollContainer = document.getElementById('scroll-feed-container');
  if (!scrollContainer) return;

  if (filteredData.length === 0) {
    scrollContainer.innerHTML = '<div class="news-empty-state">Nothing in this category yet.</div>';
    return;
  }

  scrollContainer.innerHTML = filteredData.map(item => {
    const liked = likedArticleIds.has(item.id);
    return `
    <article class="scroll-card" data-article-id="${item.id}">
      <div class="scroll-media" style="background-image: url('${item.coverImage}');"></div>
      <div class="scroll-overlay"></div>

      <div class="scroll-actions-rail">
        <button class="rail-btn ${bookmarkedArticleIds.has(item.id) ? 'active' : ''}" data-action="bookmark" data-article-id="${item.id}" title="Save Story">
          <svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>
        </button>
        <button class="rail-btn ${liked ? 'active' : ''}" data-action="like" data-article-id="${item.id}" title="Like">
          <svg class="heart-icon" viewBox="0 0 24 24"><path d="M20.8 4.6c-1.7-1.6-4.4-1.6-6.1 0L12 7.2 9.3 4.6c-1.7-1.6-4.4-1.6-6.1 0-1.8 1.7-1.8 4.5 0 6.2L12 19l8.8-8.2c1.8-1.7 1.8-4.5 0-6.2z"></path></svg>
        </button>
        <button class="rail-btn" data-action="forward" data-article-id="${item.id}" title="Forward to DM">
          <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
        ${item.sourceUrl ? `<a class="rail-btn" href="${item.sourceUrl}" target="_blank" rel="noopener" title="Read Original">
          <svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
        </a>` : ''}
      </div>

      <div class="featured-content">
        <span class="article-badge ${item.badgeColor}">${item.categoryLabel}</span>
        <h3 class="article-title-lg">${item.title}</h3>
        <div class="article-meta"><span>${item.author}</span> • <time>${item.timeAgo}</time></div>
        ${animeTagMarkup(item)}
      </div>
    </article>
  `;
  }).join('');
}

function renderAll() {
  renderNewsScroll(getFilteredData());
}

// ------------------------------------------------------------------
// Category Filter Listener (dispatched by app.js's filter-chip handler)
// ------------------------------------------------------------------
document.addEventListener('kaidra:news-filter-change', function(e) {
  activeCategory = e.detail.category;
  renderAll();
});

// ------------------------------------------------------------------
// Delegated Click Handlers — bookmark, like, forward, anime tag
// ------------------------------------------------------------------
document.addEventListener('click', function(e) {

  const bookmarkBtn = e.target.closest('[data-action="bookmark"]');
  if (bookmarkBtn) {
    const articleId = bookmarkBtn.getAttribute('data-article-id');
    if (articleId) {
      if (bookmarkedArticleIds.has(articleId)) {
        bookmarkedArticleIds.delete(articleId);
        bookmarkBtn.classList.remove('active');
      } else {
        bookmarkedArticleIds.add(articleId);
        bookmarkBtn.classList.add('active');
      }
    }
    return;
  }

  // Like — internal signal only, no public count shown anywhere.
  // HOOK: listen for 'kaidra:news-like-toggle' to persist to news_likes
  // and use it to bias future ranking/recommendations.
  const likeBtn = e.target.closest('[data-action="like"]');
  if (likeBtn) {
    const articleId = likeBtn.getAttribute('data-article-id');
    if (!articleId) return;

    const nowLiked = !likedArticleIds.has(articleId);
    if (nowLiked) {
      likedArticleIds.add(articleId);
      likeBtn.classList.add('active');
    } else {
      likedArticleIds.delete(articleId);
      likeBtn.classList.remove('active');
    }

    document.dispatchEvent(new CustomEvent('kaidra:news-like-toggle', {
      detail: { articleId: articleId, liked: nowLiked }
    }));
    return;
  }

  const forwardBtn = e.target.closest('[data-action="forward"]');
  if (forwardBtn) {
    const articleId = forwardBtn.getAttribute('data-article-id');
    const article = findArticleById(articleId);
    if (article) {
      document.dispatchEvent(new CustomEvent('kaidra:news-forward-request', {
        detail: article
      }));
    }
    return;
  }

  const tagBtn = e.target.closest('[data-action="view-anime"]');
  if (tagBtn) {
    document.dispatchEvent(new CustomEvent('kaidra:news-view-anime', {
      detail: {
        animeId: tagBtn.getAttribute('data-anime-id'),
        title: tagBtn.getAttribute('data-anime-title')
      }
    }));
  }
});

// ------------------------------------------------------------------
// Real fetch — hits the /api/news serverless function (server-side RSS
// aggregation, avoids CORS). Falls back to the small bundled dataset
// above only if that request fails outright.
// ------------------------------------------------------------------
async function loadRealNews() {
  const scrollContainer = document.getElementById('scroll-feed-container');
  if (scrollContainer) {
    scrollContainer.innerHTML = '<div class="news-loading-state">Loading news…</div>';
  }

  try {
    const res = await fetch('/api/news');
    if (!res.ok) throw new Error('news API responded ' + res.status);
    const data = await res.json();
    if (!data.articles || data.articles.length === 0) throw new Error('no articles returned');

    currentNewsData = data.articles;
    if (data.failedFeeds && data.failedFeeds.length) {
      console.warn('Some news sources failed to fetch:', data.failedFeeds);
    }
  } catch (err) {
    console.warn('Live news fetch failed, using fallback dataset:', err);
    currentNewsData = KAIDRA_NEWS_FALLBACK;
  }

  renderAll();
}

// ------------------------------------------------------------------
// Public hook — for manually pushing a fresh article set (e.g. from a
// future personalization-aware refetch) without reloading the page.
// ------------------------------------------------------------------
window.KaidraNews = {
  setArticles: function(articles) {
    currentNewsData = articles;
    renderAll();
  }
};

document.addEventListener('DOMContentLoaded', loadRealNews);
