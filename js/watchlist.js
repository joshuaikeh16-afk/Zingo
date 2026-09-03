/* ==========================================================================
   Kaidra — Watchlist Tab Logic
   Real persistence via user_watchlist (add, episode progress, status),
   trending recommendations so browsing doesn't require searching first,
   and AniList list import.
   ========================================================================== */

import {
  supabase,
  requireAuth,
  addToWatchlist,
  updateWatchlistProgress,
  getUserWatchlist,
  getTrendingAnime,
  importAniListByUsername,
} from './supabase-client.js';

document.addEventListener('DOMContentLoaded', async function () {

  const ANILIST_ENDPOINT = 'https://graphql.anilist.co';

  const searchInput = document.getElementById('anilist-search-input');
  const resultsBox = document.getElementById('anilist-results');
  const cardsContainer = document.getElementById('watchlist-cards-container');
  const recommendedRail = document.getElementById('watchlist-recommended-rail');

  let searchDebounceTimer = null;
  let activeStatus = 'watching';
  let currentUserId = null;
  let watchlistCache = [];

  const session = await requireAuth();
  if (!session) return;
  currentUserId = session.user.id;

  // ------------------------------------------------------------------
  // LOAD REAL WATCHLIST
  // ------------------------------------------------------------------

  function renderCard(entry) {
    if (!cardsContainer) return;

    const existing = cardsContainer.querySelector('[data-anime-id="' + entry.animeId + '"]');
    if (existing) existing.remove();

    const card = document.createElement('div');
    card.className = 'anime-card';
    card.setAttribute('data-anime-id', entry.animeId);
    card.setAttribute('data-status', entry.status);

    const current = entry.progress || 0;
    const total = entry.totalEpisodes ? '/' + entry.totalEpisodes : '';

    card.innerHTML =
      '<img class="anime-poster" src="' + (entry.coverUrl || '') + '" alt="Poster" />' +
      '<div class="anime-info">' +
        '<div class="anime-title">' + entry.title + '</div>' +
        '<div class="ep-counter">' +
          '<span>Ep <strong class="ep-val">' + current + '</strong>' + total + '</span>' +
          '<button class="ep-btn" data-action="increment-ep" title="Quick Increment">+1</button>' +
        '</div>' +
      '</div>';

    cardsContainer.appendChild(card);
    applyStatusFilter(activeStatus);
  }

  async function loadWatchlist() {
    if (!cardsContainer) return;
    cardsContainer.innerHTML = '<div class="watchlist-loading">Loading your list…</div>';
    watchlistCache = await getUserWatchlist(currentUserId);

    if (watchlistCache.length === 0) {
      cardsContainer.innerHTML = '<div class="watchlist-empty">Nothing here yet — search above or add something from Recommended.</div>';
      return;
    }

    cardsContainer.innerHTML = '';
    watchlistCache.forEach(renderCard);
    applyStatusFilter(activeStatus);
  }

  // ------------------------------------------------------------------
  // ANILIST SEARCH
  // ------------------------------------------------------------------

  const SEARCH_QUERY = 'query ($search: String) { Page(page: 1, perPage: 8) { media(search: $search, type: ANIME) { id title { romaji english } coverImage { large medium } episodes status } } }';

  function searchAniList(term) {
    return fetch(ANILIST_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ query: SEARCH_QUERY, variables: { search: term } })
    })
      .then((res) => res.json())
      .then((json) => {
        if (json.errors) throw new Error(json.errors[0].message);
        return json.data.Page.media;
      });
  }

  function renderResults(mediaList) {
    if (!resultsBox) return;
    resultsBox.innerHTML = '';

    if (!mediaList.length) {
      resultsBox.innerHTML = '<div class="search-result-empty">No matches found</div>';
      resultsBox.style.display = 'block';
      return;
    }

    mediaList.forEach((media) => {
      const title = media.title.english || media.title.romaji;
      const row = document.createElement('div');
      row.className = 'search-result-row';
      row.setAttribute('data-anime-id', media.id);
      row.innerHTML =
        '<img class="result-thumb" src="' + media.coverImage.medium + '" alt="' + title + '" />' +
        '<div class="result-info">' +
          '<span class="result-title">' + title + '</span>' +
          '<span class="result-meta">' + (media.episodes ? media.episodes + ' eps' : media.status) + '</span>' +
        '</div>' +
        '<button class="result-add-btn" type="button">Add</button>';

      row.querySelector('.result-add-btn').addEventListener('click', () => {
        addAnimeToList({
          animeId: media.id,
          title,
          coverUrl: media.coverImage.large,
          totalEpisodes: media.episodes || null,
        });
      });

      resultsBox.appendChild(row);
    });

    resultsBox.style.display = 'block';
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const term = searchInput.value.trim();
      clearTimeout(searchDebounceTimer);

      if (term.length < 2) {
        if (resultsBox) resultsBox.style.display = 'none';
        return;
      }

      searchDebounceTimer = setTimeout(() => {
        searchAniList(term)
          .then(renderResults)
          .catch((err) => {
            console.error('AniList search failed:', err);
            if (resultsBox) {
              resultsBox.innerHTML = '<div class="search-result-empty">Search failed — try again</div>';
              resultsBox.style.display = 'block';
            }
          });
      }, 350);
    });

    document.addEventListener('click', (e) => {
      if (resultsBox && !resultsBox.contains(e.target) && e.target !== searchInput) {
        resultsBox.style.display = 'none';
      }
    });
  }

  // ------------------------------------------------------------------
  // ADD TO WATCHLIST — real Supabase insert, then render for real.
  // ------------------------------------------------------------------

  async function addAnimeToList({ animeId, title, coverUrl, totalEpisodes }) {
    try {
      await addToWatchlist(currentUserId, animeId, activeStatus, totalEpisodes);
      renderCard({ animeId, title, coverUrl, totalEpisodes, progress: 0, status: activeStatus });
    } catch (err) {
      console.error('Failed to add to watchlist:', err);
    }

    if (resultsBox) resultsBox.style.display = 'none';
    if (searchInput) searchInput.value = '';
  }

  // ------------------------------------------------------------------
  // STATUS TAB FILTERING
  // ------------------------------------------------------------------

  function applyStatusFilter(status) {
    activeStatus = status;
    if (!cardsContainer) return;
    cardsContainer.querySelectorAll('.anime-card').forEach((card) => {
      const cardStatus = card.getAttribute('data-status') || 'watching';
      card.style.display = (cardStatus === status) ? '' : 'none';
    });
  }

  document.addEventListener('kaidra:watchlist-filter-change', (e) => {
    applyStatusFilter(e.detail.status);
  });

  // ------------------------------------------------------------------
  // EPISODE PROGRESS — real persistence, event delegation so it works
  // for cards added after initial load too.
  // ------------------------------------------------------------------

  cardsContainer?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="increment-ep"]');
    if (!btn) return;

    const card = btn.closest('.anime-card');
    const valEl = card?.querySelector('.ep-val');
    const animeId = card?.getAttribute('data-anime-id');
    if (!valEl || !animeId) return;

    const next = (parseInt(valEl.textContent, 10) || 0) + 1;
    valEl.textContent = next;

    updateWatchlistProgress(currentUserId, animeId, next).catch((err) => {
      console.error('Failed to save episode progress:', err);
      valEl.textContent = next - 1; // revert on failure
    });
  });

  // ------------------------------------------------------------------
  // RECOMMENDED / TRENDING — browsable without searching first.
  // ------------------------------------------------------------------

  async function loadRecommended() {
    if (!recommendedRail) return;
    const trending = await getTrendingAnime(12);
    if (trending.length === 0) {
      recommendedRail.innerHTML = '';
      return;
    }

    recommendedRail.innerHTML = trending.map((anime) => `
      <div class="recommended-card" data-anime-id="${anime.animeId}">
        <img class="recommended-poster" src="${anime.coverUrl || ''}" alt="${anime.title}" />
        <div class="recommended-title">${anime.title}</div>
        <button class="recommended-add-btn" type="button">+ Add</button>
      </div>
    `).join('');

    recommendedRail.querySelectorAll('.recommended-add-btn').forEach((btn, i) => {
      btn.addEventListener('click', () => addAnimeToList(trending[i]));
    });
  }

  // ------------------------------------------------------------------
  // ANILIST IMPORT — wired from the Settings panel's "Import External
  // Watchlist" item (app.js's tab router doesn't own this; it's a
  // self-contained flow here since it needs currentUserId).
  // ------------------------------------------------------------------

  const importBtn = document.getElementById('btn-import-list');
  importBtn?.addEventListener('click', async () => {
    const username = window.prompt('Enter your AniList username to import your list:');
    if (!username) return;

    const badge = importBtn.querySelector('.action-badge');
    const originalLabel = badge ? badge.textContent : null;
    if (badge) badge.textContent = 'Importing…';

    try {
      const result = await importAniListByUsername(currentUserId, username.trim());
      if (badge) badge.textContent = `Imported ${result.imported}`;
      await loadWatchlist();
    } catch (err) {
      console.error('AniList import failed:', err);
      if (badge) badge.textContent = 'Failed';
    } finally {
      setTimeout(() => { if (badge) badge.textContent = originalLabel; }, 2500);
    }
  });

  await loadWatchlist();
  await loadRecommended();
});
