/* ==========================================================================
   Kaidra — Watchlist Tab Logic
   Handles: AniList search, add-to-list, status filtering, episode progress.

   This file only touches the DOM + AniList's public GraphQL API. It does
   NOT talk to Supabase — persistence is left to hook points marked below
   so it can be wired into your data layer.
   ========================================================================== */

document.addEventListener('DOMContentLoaded', function () {

  var ANILIST_ENDPOINT = 'https://graphql.anilist.co';

  var searchInput = document.getElementById('anilist-search-input');
  var resultsBox = document.getElementById('anilist-results');
  var cardsContainer = document.getElementById('watchlist-cards-container');

  var searchDebounceTimer = null;
  var activeStatus = 'watching';

  // ------------------------------------------------------------------
  // ANILIST SEARCH
  // ------------------------------------------------------------------

  var SEARCH_QUERY = 'query ($search: String) { Page(page: 1, perPage: 8) { media(search: $search, type: ANIME) { id title { romaji english } coverImage { large medium } episodes status } } }';

  function searchAniList(term) {
    return fetch(ANILIST_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ query: SEARCH_QUERY, variables: { search: term } })
    })
      .then(function (res) { return res.json(); })
      .then(function (json) {
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

    mediaList.forEach(function (media) {
      var title = media.title.english || media.title.romaji;
      var row = document.createElement('div');
      row.className = 'search-result-row';
      row.setAttribute('data-anime-id', media.id);
      row.innerHTML =
        '<img class="result-thumb" src="' + media.coverImage.medium + '" alt="' + title + '" />' +
        '<div class="result-info">' +
          '<span class="result-title">' + title + '</span>' +
          '<span class="result-meta">' + (media.episodes ? media.episodes + ' eps' : media.status) + '</span>' +
        '</div>' +
        '<button class="result-add-btn" type="button">Add</button>';

      row.querySelector('.result-add-btn').addEventListener('click', function () {
        requestAddToWatchlist(media);
      });

      resultsBox.appendChild(row);
    });

    resultsBox.style.display = 'block';
  }

  if (searchInput) {
    searchInput.addEventListener('input', function () {
      var term = searchInput.value.trim();
      clearTimeout(searchDebounceTimer);

      if (term.length < 2) {
        if (resultsBox) resultsBox.style.display = 'none';
        return;
      }

      searchDebounceTimer = setTimeout(function () {
        searchAniList(term)
          .then(renderResults)
          .catch(function (err) {
            console.error('AniList search failed:', err);
            if (resultsBox) {
              resultsBox.innerHTML = '<div class="search-result-empty">Search failed — try again</div>';
              resultsBox.style.display = 'block';
            }
          });
      }, 350);
    });

    // Close the dropdown on outside click
    document.addEventListener('click', function (e) {
      if (resultsBox && !resultsBox.contains(e.target) && e.target !== searchInput) {
        resultsBox.style.display = 'none';
      }
    });
  }

  // ------------------------------------------------------------------
  // ADD TO WATCHLIST
  //
  // HOOK: listen for 'kaidra:watchlist-add-request' in your Supabase
  // logic, insert the row, then call window.KaidraWatchlist.addCard(...)
  // once it succeeds so the UI reflects the confirmed state.
  // ------------------------------------------------------------------

  function requestAddToWatchlist(media) {
    document.dispatchEvent(new CustomEvent('kaidra:watchlist-add-request', {
      detail: {
        animeId: media.id,
        title: media.title.english || media.title.romaji,
        coverUrl: media.coverImage.large,
        totalEpisodes: media.episodes || null,
        status: activeStatus
      }
    }));

    if (resultsBox) resultsBox.style.display = 'none';
    if (searchInput) searchInput.value = '';
  }

  function addCard(entry) {
    // entry: { animeId, title, coverUrl, totalEpisodes, currentEpisode, status }
    if (!cardsContainer) return;

    var existing = cardsContainer.querySelector('[data-anime-id="' + entry.animeId + '"]');
    if (existing) existing.remove();

    var card = document.createElement('div');
    card.className = 'anime-card';
    card.setAttribute('data-anime-id', entry.animeId);
    card.setAttribute('data-status', entry.status);

    var current = entry.currentEpisode || 0;
    var total = entry.totalEpisodes ? '/' + entry.totalEpisodes : '';

    card.innerHTML =
      '<img class="anime-poster" src="' + entry.coverUrl + '" alt="Poster" />' +
      '<div class="anime-info">' +
        '<div class="anime-title">' + entry.title + '</div>' +
        '<div class="ep-counter">' +
          '<span>Ep <strong class="ep-val">' + current + '</strong>' + total + '</span>' +
          '<button class="ep-btn" data-action="increment-ep" title="Quick Increment">+1</button>' +
        '</div>' +
      '</div>';

    bindEpisodeButton(card);
    cardsContainer.appendChild(card);
    applyStatusFilter(activeStatus);
  }

  // ------------------------------------------------------------------
  // STATUS TAB FILTERING
  // Listens for 'kaidra:watchlist-filter-change', already dispatched
  // by app.js whenever a status pill is clicked.
  // ------------------------------------------------------------------

  function applyStatusFilter(status) {
    activeStatus = status;
    if (!cardsContainer) return;

    cardsContainer.querySelectorAll('.anime-card').forEach(function (card) {
      var cardStatus = card.getAttribute('data-status') || 'watching';
      card.style.display = (cardStatus === status) ? '' : 'none';
    });
  }

  document.addEventListener('kaidra:watchlist-filter-change', function (e) {
    applyStatusFilter(e.detail.status);
  });

  // ------------------------------------------------------------------
  // EPISODE PROGRESS
  //
  // HOOK: dispatches 'kaidra:watchlist-episode-update' with the new
  // count so your Supabase logic can persist it. The UI updates
  // optimistically and does not wait for confirmation.
  // ------------------------------------------------------------------

  function bindEpisodeButton(card) {
    var btn = card.querySelector('[data-action="increment-ep"]');
    if (!btn) return;

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var valEl = card.querySelector('.ep-val');
      if (!valEl) return;

      var current = parseInt(valEl.textContent, 10) || 0;
      var next = current + 1;
      valEl.textContent = next;

      document.dispatchEvent(new CustomEvent('kaidra:watchlist-episode-update', {
        detail: {
          animeId: card.getAttribute('data-anime-id'),
          newEpisodeCount: next
        }
      }));
    });
  }

  // Bind buttons on any cards already in the DOM at load (e.g. seeded/demo cards)
  if (cardsContainer) {
    cardsContainer.querySelectorAll('.anime-card').forEach(bindEpisodeButton);
    applyStatusFilter(activeStatus);
  }

  // ------------------------------------------------------------------
  // PUBLIC HOOKS — call these from your Supabase logic once a request
  // (add / episode update / import) resolves successfully.
  // ------------------------------------------------------------------

  window.KaidraWatchlist = {
    addCard: addCard,
    applyStatusFilter: applyStatusFilter
  };

});
