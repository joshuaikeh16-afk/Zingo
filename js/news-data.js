/* ==========================================================================
   Kaidra — News Feed Controller
   Scroll-snap, one card at a time. Categories match the real interest
   taxonomy from onboarding. Defaults to the signed-in user's own
   selected interests (that's what they're for) rather than showing
   everything -- "All" means "all of your interests," not "all news."
   No like button: it was never wired to persist anywhere, so it
   shouldn't be there pretending to do something.
   ========================================================================== */

import { supabase, fetchNewsFeed } from './supabase-client.js';

// ------------------------------------------------------------------
// Fallback dataset — used only if the real /api/news fetch fails.
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
let userInterests = null; // null = unknown/not logged in -> no personalization filter
let bookmarkedArticleIds = new Set();

function getFilteredData() {
  // Feed is filtered to the user's own selected interests, if known.
  // No manual category chips -- this is the whole feed, personalized.
  if (userInterests && userInterests.length > 0) {
    return currentNewsData.filter(item => userInterests.includes(item.category));
  }
  return currentNewsData;
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
// Render — one card per screen, scroll-snap
// ------------------------------------------------------------------
function renderNewsScroll(filteredData) {
  const scrollContainer = document.getElementById('scroll-feed-container');
  if (!scrollContainer) return;

  if (filteredData.length === 0) {
    scrollContainer.innerHTML = '<div class="news-empty-state">Nothing here yet. Try a different category, or add more interests in your profile.</div>';
    return;
  }

  scrollContainer.innerHTML = filteredData.map(item => `
    <article class="scroll-card" data-article-id="${item.id}">
      <div class="scroll-media" style="background-image: url('${item.coverImage}');">
        <div class="scroll-actions-rail">
          <button class="rail-btn ${bookmarkedArticleIds.has(item.id) ? 'active' : ''}" data-action="bookmark" data-article-id="${item.id}" title="Save Story">
            <svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>
          </button>
          <button class="rail-btn" data-action="forward" data-article-id="${item.id}" title="Forward to DM">
            <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          </button>
          ${item.sourceUrl ? `<a class="rail-btn" href="${item.sourceUrl}" target="_blank" rel="noopener" title="Read Original">
            <svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
          </a>` : ''}
        </div>
      </div>

      <div class="scroll-card-content">
        <span class="article-badge ${item.badgeColor}">${item.categoryLabel}</span>
        <h3 class="article-title-lg">${item.title}</h3>
        <div class="article-meta"><span>${item.author}</span> • <time>${item.timeAgo}</time></div>
        ${animeTagMarkup(item)}
      </div>
    </article>
  `).join('');
}

function renderAll() {
  renderNewsScroll(getFilteredData());
}

// ------------------------------------------------------------------
// Delegated Click Handlers — bookmark, forward, anime tag
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
// Load the signed-in user's interests, then load the news itself.
// ------------------------------------------------------------------
async function loadUserInterests() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { data: profile } = await supabase
      .from('profiles')
      .select('interests')
      .eq('id', session.user.id)
      .maybeSingle();

    userInterests = profile?.interests ?? null;
  } catch (err) {
    console.warn('Could not load interests for personalization:', err);
  }
}

async function loadRealNews() {
  const scrollContainer = document.getElementById('scroll-feed-container');
  if (scrollContainer) {
    scrollContainer.innerHTML = '<div class="news-loading-state">Loading news…</div>';
  }

  try {
    const articles = await fetchNewsFeed();
    if (!articles || articles.length === 0) throw new Error('no articles returned');
    currentNewsData = articles;
  } catch (err) {
    console.warn('Live news fetch failed, using fallback dataset:', err);
    currentNewsData = KAIDRA_NEWS_FALLBACK;
  }

  renderAll();
}

window.KaidraNews = {
  setArticles: function(articles) {
    currentNewsData = articles;
    renderAll();
  }
};

document.addEventListener('DOMContentLoaded', async () => {
  await loadUserInterests();
  await loadRealNews();
});
