/* ==========================================================================
   Kaidra — News Feed Controller
   ========================================================================== */

// ------------------------------------------------------------------
// Mock Dataset (Simulating Supabase Rows / RSS Output)
// Once your RSS-fetch function is live, call:
//   window.KaidraNews.setArticles(realArticlesArray)
// with objects shaped exactly like these, and everything below —
// filtering, likes, forwarding, anime tags — works unchanged.
// ------------------------------------------------------------------
const KAIDRA_NEWS_DATA = [
  {
    id: "art-101",
    title: "Studio MAPPA Unveils Original Sci-Fi Anime Project Scheduled for Late 2026",
    category: "announcements",
    categoryLabel: "Breaking News",
    badgeColor: "pink",
    author: "Kaidra Editorial",
    sourceUrl: "",
    timeAgo: "2 hours ago",
    readTime: "4 min read",
    coverImage: "https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=1000&q=80",
    snippet: "The studio behind major hits has revealed an ambitious original space drama project coming later this year...",
    content: "Studio MAPPA officially announced an ambitious original sci-fi anime project set in a futuristic deep-space colony. The upcoming title boasts an all-star production team, revolutionary composite animation techniques, and an original soundtrack. Further cast details and production stills are expected during next month's livestream.",
    relatedAnimeId: null,
    relatedAnimeTitle: null
  },
  {
    id: "art-102",
    title: "Chainsaw Man Sequel Movie Confirmed",
    category: "announcements",
    categoryLabel: "Teaser",
    badgeColor: "cyan",
    author: "News Desk",
    sourceUrl: "",
    timeAgo: "4 hours ago",
    readTime: "2 min read",
    coverImage: "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?auto=format&fit=crop&w=600&q=80",
    snippet: "Official teaser visuals confirming the upcoming theatrical continuation have been released online...",
    content: "Following massive theatrical box office success, the next arc of Chainsaw Man has been greenlit for a feature film release. Key staff will return to handle animation production.",
    relatedAnimeId: 105778,
    relatedAnimeTitle: "Chainsaw Man"
  },
  {
    id: "art-103",
    title: "Inside Key Animation Pipeline & Digital Compositing",
    category: "industry",
    categoryLabel: "Industry",
    badgeColor: "pink",
    author: "Tech & Animation",
    sourceUrl: "",
    timeAgo: "7 hours ago",
    readTime: "6 min read",
    coverImage: "https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=600&q=80",
    snippet: "An in-depth look into how modern studios blend traditional 2D keyframes with advanced 3D lighting...",
    content: "Modern digital animation pipelines are shifting rapidly toward unified compositing tools. In this feature, lead compositors discuss how 2D line-art integrates with hybrid lighting shaders.",
    relatedAnimeId: null,
    relatedAnimeTitle: null
  },
  {
    id: "art-104",
    title: "Top 10 Highly Anticipated Manga Adaptations Coming Soon",
    category: "manga",
    categoryLabel: "Manga & LNs",
    badgeColor: "cyan",
    author: "Community Staff",
    sourceUrl: "",
    timeAgo: "12 hours ago",
    readTime: "5 min read",
    coverImage: "https://images.unsplash.com/photo-1563089145-599997674d42?auto=format&fit=crop&w=600&q=80",
    snippet: "From dark fantasy epics to cozy slice-of-life titles, here are the top adaptations to keep on your watchlist...",
    content: "With dozens of serialized manga receiving greenlight announcements this season, we rank the ten most promising upcoming releases based on studio backing and source material quality.",
    relatedAnimeId: null,
    relatedAnimeTitle: null
  }
];

// ------------------------------------------------------------------
// State
// ------------------------------------------------------------------
let currentNewsData = KAIDRA_NEWS_DATA.slice();
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

function cardActionsMarkup(item) {
  const liked = likedArticleIds.has(item.id);
  return `
    <div class="news-card-actions">
      <button class="rail-btn-mini like-btn ${liked ? 'liked' : ''}" data-action="like" data-article-id="${item.id}" title="Like">
        <svg class="heart-icon" viewBox="0 0 24 24"><path d="M20.8 4.6c-1.7-1.6-4.4-1.6-6.1 0L12 7.2 9.3 4.6c-1.7-1.6-4.4-1.6-6.1 0-1.8 1.7-1.8 4.5 0 6.2L12 19l8.8-8.2c1.8-1.7 1.8-4.5 0-6.2z"></path></svg>
      </button>
      <button class="rail-btn-mini forward-btn" data-action="forward" data-article-id="${item.id}" title="Forward to DM">
        <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
      </button>
    </div>
  `;
}

// ------------------------------------------------------------------
// Render Functions
// ------------------------------------------------------------------
function renderNewsGrid(filteredData) {
  const secondaryGrid = document.getElementById('secondary-news-grid');
  const sideNewsStack = document.getElementById('side-news-container');
  if (!secondaryGrid || !sideNewsStack) return;

  const sideItems = filteredData.slice(1, 3);
  sideNewsStack.innerHTML = sideItems.map(item => `
    <article class="side-card" data-article-id="${item.id}">
      <img class="side-thumb" src="${item.coverImage}" alt="Cover" />
      <div class="side-content">
        <span class="article-badge ${item.badgeColor}">${item.categoryLabel}</span>
        <h4 class="side-title">${item.title}</h4>
        <div class="article-meta"><time>${item.timeAgo}</time> • <span>${item.readTime}</span></div>
        ${animeTagMarkup(item)}
      </div>
      ${cardActionsMarkup(item)}
    </article>
  `).join('');

  const secondaryItems = filteredData.slice(3);
  secondaryGrid.innerHTML = secondaryItems.map(item => `
    <article class="side-card" data-article-id="${item.id}">
      <img class="side-thumb" src="${item.coverImage}" alt="Cover" />
      <div class="side-content">
        <span class="article-badge ${item.badgeColor}">${item.categoryLabel}</span>
        <h4 class="side-title">${item.title}</h4>
        <div class="article-meta"><time>${item.timeAgo}</time> • <span>${item.readTime}</span></div>
        ${animeTagMarkup(item)}
      </div>
      ${cardActionsMarkup(item)}
    </article>
  `).join('');
}

function renderNewsScroll(filteredData) {
  const scrollContainer = document.getElementById('scroll-feed-container');
  if (!scrollContainer) return;

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
        <button class="rail-btn" data-action="share" title="Share Story">
          <svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
        </button>
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
  const filtered = getFilteredData();
  renderNewsGrid(filtered);
  renderNewsScroll(filtered);
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

  // Bookmark
  const bookmarkBtn = e.target.closest('[data-action="bookmark"]');
  if (bookmarkBtn) {
    const articleId = bookmarkBtn.getAttribute('data-article-id') || bookmarkBtn.closest('[data-article-id]')?.getAttribute('data-article-id');
    if (articleId) {
      if (bookmarkedArticleIds.has(articleId)) {
        bookmarkedArticleIds.delete(articleId);
        bookmarkBtn.classList.remove('bookmarked', 'active');
      } else {
        bookmarkedArticleIds.add(articleId);
        bookmarkBtn.classList.add('bookmarked', 'active');
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
      likeBtn.classList.add('liked', 'active');
    } else {
      likedArticleIds.delete(articleId);
      likeBtn.classList.remove('liked', 'active');
    }

    document.dispatchEvent(new CustomEvent('kaidra:news-like-toggle', {
      detail: { articleId: articleId, liked: nowLiked }
    }));
    return;
  }

  // Forward to DM — hands off to app.js, which owns the chat drawer.
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

  // Anime tag — jump to Watchlist and search for the real title, so a
  // user can check what a story is actually about vs. a misleading thumbnail.
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
// Public hook — call this once your RSS-fetch function returns real
// articles (shaped like KAIDRA_NEWS_DATA entries).
// ------------------------------------------------------------------
window.KaidraNews = {
  setArticles: function(articles) {
    currentNewsData = articles;
    renderAll();
  }
};

// Initial Load
document.addEventListener('DOMContentLoaded', function() {
  renderAll();
});
