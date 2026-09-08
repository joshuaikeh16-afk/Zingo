/* ==========================================================================
   Kaidra — Watchlist Tab Logic
   Real persistence via user_watchlist (add, episode progress, status),
   MAL-based recommendation rows, MAL list sync, and a status
   picker so adding an anime always asks which list it goes to.
   ========================================================================== */

import {
  supabase,
  requireAuth,
  addToWatchlist,
  updateWatchlistProgress,
  removeFromWatchlist,
  getUserWatchlist,
  getUserPreferences,
} from './supabase-client.js';
import { searchMAL, getMALRanking, connectMAL, finishMALAuth, getMALAnimeList, isMALConnected, updateMALListEntry, deleteMALListEntry } from './mal-client.js';

document.addEventListener('DOMContentLoaded', async function () {

  const GENRE_ROWS = ['Top anime', 'Most popular manga'];

  const searchInput = document.getElementById('anilist-search-input');
  const resultsBox = document.getElementById('anilist-results');
  const cardsContainer = document.getElementById('watchlist-cards-container');
  const genreRowsContainer = document.getElementById('watchlist-genre-rows');

  let searchDebounceTimer = null;
  let activeStatus = 'watching';
  let currentUserId = null;
  let watchlistCache = [];
  let activeMediaType = 'ANIME';
  let allowSensitive = false;

  async function syncMALList() {
    const payload = await getMALAnimeList('', 100);
    const rows = (payload.data || []).map((entry) => {
      const node = entry.node || entry;
      const list = entry.list_status || node.my_list_status || {};
      return {
        user_id: currentUserId,
        anime_id: node.id,
        mal_id: node.id,
        media_type: node.media_type || 'anime',
        status: list.status || 'plan_to_watch',
        progress: list.num_episodes_watched || 0,
        total_episodes: node.num_episodes || null,
        title: node.title || 'Unknown title',
        cover_url: node.main_picture?.large || node.main_picture?.medium || null,
        score: list.score || null,
        start_date: list.start_date || null,
        finish_date: list.finish_date || null,
        tags: list.tags || [],
        notes: list.comments || null,
        times_rewatched: list.num_times_rewatched || 0,
        is_rewatching: !!list.is_rewatching,
        updated_at: new Date().toISOString(),
      };
    });
    if (rows.length) {
      const { error } = await supabase.from('user_watchlist').upsert(rows, { onConflict: 'user_id,anime_id' });
      if (error) throw error;
    }
  }

  const session = await requireAuth();
  if (!session) return;
  currentUserId = session.user.id;
  try {
    const connected = await finishMALAuth();
    if (connected) await syncMALList();
  } catch (error) { console.error('MAL authorization failed:', error); }
  allowSensitive = !!(await getUserPreferences(currentUserId)).nsfw_filter;
  document.addEventListener('kaidra:content-preference-change', (event) => {
    allowSensitive = !!event.detail?.allowSensitive;
    loadWatchlist();
    loadGenreRows();
  });

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
          '<span><button class="ep-btn" data-action="increment-ep" title="Quick Increment">+1</button><button class="ep-btn" data-action="remove-entry" title="Remove from watchlist">×</button></span>' +
        '</div>' +
      '</div>';

    cardsContainer.appendChild(card);
    applyStatusFilter(activeStatus);
  }

  async function loadWatchlist() {
    if (!cardsContainer) return;
    cardsContainer.innerHTML = '<div class="watchlist-loading">Loading your list…</div>';
    watchlistCache = await getUserWatchlist(currentUserId, allowSensitive);

    if (watchlistCache.length === 0) {
      cardsContainer.innerHTML = '<div class="watchlist-empty">Nothing here yet — search above or add something from Recommended.</div>';
      return;
    }

    cardsContainer.innerHTML = '';
    watchlistCache.forEach(renderCard);
    applyStatusFilter(activeStatus);
  }

  // ------------------------------------------------------------------
  // MYANIMELIST SEARCH
  // ------------------------------------------------------------------

  function searchMALTitles(term, type) {
    return searchMAL(term, type === 'MANGA' ? 'manga' : 'anime', 8).then((payload) => payload.data ?? []);
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
      const title = media.node?.title || media.title || 'Unknown title';
      const mediaId = media.node?.id || media.id;
      const picture = media.node?.main_picture || media.main_picture || {};
      const coverUrl = picture.large || picture.medium || '';
      const isManga = activeMediaType === 'MANGA';
      const row = document.createElement('div');
      row.className = 'search-result-row';
      row.setAttribute('data-anime-id', mediaId);
      row.innerHTML =
        '<img class="result-thumb" src="' + coverUrl + '" alt="' + title + '" />' +
        '<div class="result-info">' +
          '<span class="result-title">' + title + '</span>' +
          '<span class="result-meta">' + (isManga ? (media.node?.num_chapters ? media.node.num_chapters + ' chapters' : media.node?.status) : (media.node?.num_episodes ? media.node.num_episodes + ' eps' : media.node?.status)) + '</span>' +
        '</div>' +
        '<button class="result-add-btn" type="button">Add</button>';

      row.querySelector('.result-add-btn')?.addEventListener('click', () => {
        if (isManga) return;
        openStatusPicker({
          animeId: mediaId,
          title,
          coverUrl,
          totalEpisodes: isManga ? (media.node?.num_chapters || null) : (media.node?.num_episodes || null),
          mediaType: isManga ? 'manga' : 'anime',
          score: media.node?.mean ?? null,
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
        searchMALTitles(term, activeMediaType)
          .then(renderResults)
          .catch((err) => {
            console.error('MyAnimeList search failed:', err);
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

  document.querySelectorAll('.media-type-btn').forEach((button) => {
    button.addEventListener('click', () => {
      activeMediaType = button.dataset.mediaType || 'ANIME';
      document.querySelectorAll('.media-type-btn').forEach((item) => {
        const active = item === button;
        item.classList.toggle('active', active);
        item.setAttribute('aria-selected', String(active));
      });
      if (searchInput) {
        searchInput.placeholder = activeMediaType === 'MANGA'
          ? 'Search manga via MyAnimeList...'
          : 'Search anime via MyAnimeList...';
        if (searchInput.value.trim().length >= 2) searchInput.dispatchEvent(new Event('input'));
      }
    });
  });

  // ------------------------------------------------------------------
  // STATUS PICKER — shown every time "Add" is tapped (from search or
  // from a recommended card), so which list it goes into is always a
  // deliberate choice, not whatever tab happened to be selected.
  // ------------------------------------------------------------------

  const statusPicker = document.getElementById('watchlist-status-picker');
  const statusPickerCover = document.getElementById('status-picker-cover');
  const statusPickerTitle = document.getElementById('status-picker-title');
  const statusPickerCancelBtn = document.getElementById('status-picker-cancel-btn');

  let pendingAnime = null;

  function openStatusPicker(anime) {
    pendingAnime = anime;
    if (statusPickerCover) statusPickerCover.src = anime.coverUrl || '';
    if (statusPickerTitle) statusPickerTitle.textContent = anime.title;
    statusPicker?.classList.remove('hidden');
  }

  function closeStatusPicker() {
    pendingAnime = null;
    statusPicker?.classList.add('hidden');
  }

  statusPickerCancelBtn?.addEventListener('click', closeStatusPicker);

  statusPicker?.querySelectorAll('.status-picker-option').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!pendingAnime) return;
      const status = btn.getAttribute('data-status');
      await addAnimeToList(pendingAnime, status);
      closeStatusPicker();
    });
  });

  // ------------------------------------------------------------------
  // ADD TO WATCHLIST — real Supabase insert, then render for real.
  // ------------------------------------------------------------------

  async function addAnimeToList({ animeId, title, coverUrl, totalEpisodes, mediaType, score }, status) {
    try {
      await addToWatchlist(currentUserId, animeId, status, totalEpisodes, { title, coverUrl, mediaType, score });
      if (mediaType !== 'manga' && await isMALConnected(currentUserId)) {
        await updateMALListEntry(animeId, { status, num_watched_episodes: 0, score: score || 0 });
      }
      renderCard({ animeId, title, coverUrl, totalEpisodes, progress: 0, status, mediaType });
    } catch (err) {
      console.error('Failed to add to watchlist:', err);
    }

    if (resultsBox) resultsBox.style.display = 'none';
    if (searchInput) searchInput.value = '';
  }

  // ------------------------------------------------------------------
  // STATUS TAB FILTERING (for "Your List" only)
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

  cardsContainer?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="increment-ep"]');
    const removeBtn = e.target.closest('[data-action="remove-entry"]');
    if (removeBtn) {
      const removeCard = removeBtn.closest('.anime-card');
      const removeId = removeCard?.getAttribute('data-anime-id');
      if (!removeId) return;
      await removeFromWatchlist(currentUserId, removeId);
      if (await isMALConnected(currentUserId)) await deleteMALListEntry(removeId).catch(() => {});
      removeCard.remove();
      return;
    }
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
    if (await isMALConnected(currentUserId)) updateMALListEntry(animeId, { num_watched_episodes: next }).catch(() => {});
  });

  // ------------------------------------------------------------------
  // RECOMMENDED — MAL ranking rails.
  // ------------------------------------------------------------------

  async function loadGenreRows() {
    if (!genreRowsContainer) return;
    genreRowsContainer.innerHTML = '<div class="watchlist-loading">Loading recommendations…</div>';

    const results = await Promise.all([
      getMALRanking('anime', 'bypopularity', 10).then((payload) => payload.data ?? []),
      getMALRanking('manga', 'bypopularity', 10).then((payload) => payload.data ?? []),
    ]);

    genreRowsContainer.innerHTML = '';
    GENRE_ROWS.forEach((genre, i) => {
      const list = results[i].map((item) => {
        const node = item.node || item;
        return { animeId: node.id, title: node.title, coverUrl: node.main_picture?.large || node.main_picture?.medium || '', totalEpisodes: node.num_episodes || node.num_chapters || null, mediaType: i === 1 ? 'manga' : 'anime' };
      });
      if (!list || list.length === 0) return;

      const section = document.createElement('div');
      section.className = 'genre-row-section';
      section.innerHTML = `
        <div class="genre-row-title">${genre}</div>
        <div class="recommended-rail" data-genre="${genre}"></div>
      `;
      genreRowsContainer.appendChild(section);

      const rail = section.querySelector('.recommended-rail');
      rail.innerHTML = list.map((anime) => `
        <div class="recommended-card" data-anime-id="${anime.animeId}">
          <img class="recommended-poster" src="${anime.coverUrl || ''}" alt="${anime.title}" />
          <div class="recommended-title">${anime.title}</div>
          <button class="recommended-add-btn" type="button">+ Add</button>
        </div>
      `).join('');

      rail.querySelectorAll('.recommended-add-btn').forEach((btn, idx) => {
        btn.addEventListener('click', () => openStatusPicker(list[idx]));
      });
    });

    if (!genreRowsContainer.children.length) {
      genreRowsContainer.innerHTML = '<div class="watchlist-empty">Recommendations unavailable right now.</div>';
    }
  }

  // ------------------------------------------------------------------
  // ANILIST IMPORT — wired from the Settings panel's "Import External
  // Watchlist" item (app.js's tab router doesn't own this; it's a
  // self-contained flow here since it needs currentUserId).
  // ------------------------------------------------------------------

  const importBtn = document.getElementById('btn-import-list');
  const importModal = document.getElementById('anilist-import-modal');
  const importCloseBtn = document.getElementById('anilist-import-close-btn');
  const importSubmitBtn = document.getElementById('anilist-import-submit-btn');
  const importErrorEl = document.getElementById('anilist-import-error');

  function setImportError(message) {
    if (!importErrorEl) return;
    importErrorEl.textContent = message || '';
    importErrorEl.classList.toggle('hidden', !message);
  }

  importBtn?.addEventListener('click', () => {
    setImportError(null);
    importModal?.classList.remove('hidden');
  });

  importCloseBtn?.addEventListener('click', () => {
    importModal?.classList.add('hidden');
  });

  importSubmitBtn?.addEventListener('click', async () => {
    setImportError(null);
    importSubmitBtn.disabled = true;
    importSubmitBtn.textContent = 'Connecting…';

    try {
      await connectMAL();
    } catch (err) {
      console.error('MAL connection failed:', err);
      setImportError('MyAnimeList connection failed. Check your MAL app configuration and try again.');
    } finally {
      importSubmitBtn.disabled = false;
      importSubmitBtn.textContent = 'Connect & Sync My List';
    }
  });

  await loadWatchlist();
  await loadGenreRows();
});
