import { getMALDetail, getMALGenre } from './mal-client.js';

const genreGrid = document.getElementById('browse-genre-grid');
const mainBrowseView = document.getElementById('browse-main-view');
const genreView = document.getElementById('browse-genre-view');
const genreTitle = document.getElementById('browse-genre-title');
const genreDescription = document.getElementById('browse-genre-description');
const breadcrumbGenre = document.getElementById('browse-breadcrumb-genre');
const genreResults = document.getElementById('browse-genre-results');
const backButton = document.getElementById('browse-back-btn');
const sortYearSelect = document.getElementById('browse-sort-year');
const loadSentinel = document.getElementById('browse-load-sentinel');
const detailModal = document.getElementById('anime-detail-modal');
const detailClose = document.getElementById('anime-detail-close');
const detailCover = document.getElementById('anime-detail-cover');
const detailTitle = document.getElementById('anime-detail-title');
const detailMeta = document.getElementById('anime-detail-meta');
const detailSynopsis = document.getElementById('anime-detail-synopsis');
const detailAdd = document.getElementById('anime-detail-add');

const PAGE_SIZE = 20;
let activeGenreKey = null;
let offset = 0;
let loading = false;
let hasMore = true;
let requestId = 0;

const GENRES = {
  action: { id: 1, title: 'Action', description: 'For all your fist flying and huge explosion needs!' },
  adventure: { id: 2, title: 'Adventure', description: 'Big journeys, strange worlds, and unforgettable quests.' },
  comedy: { id: 4, title: 'Comedy', description: 'Lighthearted stories for a guaranteed mood boost.' },
  drama: { id: 8, title: 'Drama', description: 'Emotional stories that stay with you.' },
  fantasy: { id: 10, title: 'Fantasy', description: 'Magic, monsters, and worlds beyond imagination.' },
  music: { id: 19, title: 'Music', description: 'Anime powered by rhythm, performance, and sound.' },
  romance: { id: 22, title: 'Romance', description: 'Heartfelt stories about connection and love.' },
  'sci-fi': { id: 24, title: 'Sci-Fi', description: 'Future worlds, technology, and cosmic possibilities.' },
  seinen: { id: 42, title: 'Seinen', description: 'Layered stories made for mature anime fans.' },
  shojo: { id: 25, title: 'Shoujo', description: 'Character-driven stories with heart and style.' },
  shonen: { id: 27, title: 'Shonen', description: 'Rivals, heroes, training arcs, and big victories.' },
  'slice-of-life': { id: 36, title: 'Slice of Life', description: 'Small moments, warm friendships, and everyday magic.' },
};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function itemsFrom(payload) {
  return (payload?.data || []).map((item) => item.node || item).filter((item) => item.id && item.title);
}

function matchesSelectedYear(item, selectedYear) {
  if (!selectedYear || selectedYear === 'all') return true;
  const releaseYear = Number(String(item.start_date || '').slice(0, 4));
  if (!releaseYear) return false;
  if (/^\d{4}$/.test(selectedYear)) return releaseYear === Number(selectedYear);
  const range = /^(\d{4})-(\d{4})$/.exec(selectedYear);
  if (!range) return true;
  const high = Math.max(Number(range[1]), Number(range[2]));
  const low = Math.min(Number(range[1]), Number(range[2]));
  return releaseYear >= low && releaseYear <= high;
}

function updateUrl({ push = true } = {}) {
  const url = new URL(window.location.href);
  if (activeGenreKey) url.searchParams.set('genre', activeGenreKey);
  else url.searchParams.delete('genre');
  if (activeGenreKey && sortYearSelect?.value && sortYearSelect.value !== 'all') url.searchParams.set('sort_year', sortYearSelect.value);
  else url.searchParams.delete('sort_year');
  if (push) window.history.pushState({ genre: activeGenreKey }, '', url);
}

function renderCards(items) {
  if (!genreResults) return;
  genreResults.insertAdjacentHTML('beforeend', items.map((item) => {
    const cover = item.main_picture?.large || item.main_picture?.medium || '';
    return `<article class="browse-anime-card" data-anime-id="${item.id}" data-anime-title="${escapeHtml(item.title)}" data-anime-cover="${escapeHtml(cover)}" data-anime-episodes="${item.num_episodes || ''}"><img src="${escapeHtml(cover)}" alt="${escapeHtml(item.title)}" loading="lazy" /><p class="browse-anime-synopsis">${escapeHtml(item.synopsis || 'Discover this title and share your thoughts.')}</p><h5>${escapeHtml(item.title)}</h5><span>${item.mean ? `★ ${item.mean}` : 'Anime'} · ${item.num_episodes || '?'} eps</span></article>`;
  }).join(''));
}

async function loadGenrePage({ reset = false } = {}) {
  const genre = GENRES[activeGenreKey];
  if (!genre || (loading && !reset) || (!hasMore && !reset)) return;
  const currentRequestId = reset ? ++requestId : requestId;
  if (reset) {
    offset = 0;
    hasMore = true;
    genreResults.innerHTML = '<p class="discovery-empty">Loading anime…</p>';
  }
  loading = true;
  if (loadSentinel) loadSentinel.textContent = 'Loading more anime…';
  try {
    const payload = await getMALGenre(genre.id, sortYearSelect?.value || 'all', PAGE_SIZE, offset);
    if (currentRequestId !== requestId) return;
    const selectedYear = sortYearSelect?.value || 'all';
    const items = itemsFrom(payload)
      .filter((item) => matchesSelectedYear(item, selectedYear))
      .sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')));
    if (reset) genreResults.innerHTML = '';
    renderCards(items);
    offset += items.length;
    hasMore = items.length === PAGE_SIZE;
    if (!items.length && reset) genreResults.innerHTML = '<p class="discovery-empty">No anime found for this genre.</p>';
  } catch (error) {
    if (currentRequestId !== requestId) return;
    console.error('Browse genre failed:', error);
    if (reset) genreResults.innerHTML = '<p class="discovery-empty">Genre results are unavailable. Check the MAL connection and try again.</p>';
    hasMore = false;
  } finally {
    if (currentRequestId === requestId) {
      loading = false;
      if (loadSentinel) loadSentinel.textContent = hasMore ? 'Scroll for more' : 'You reached the end of this genre';
    }
  }
}

function showGenre(key, { push = true } = {}) {
  const genre = GENRES[key];
  if (!genre) return;
  activeGenreKey = key;
  if (push) updateUrl();
  mainBrowseView?.classList.add('hidden');
  genreView?.classList.remove('hidden');
  if (genreTitle) genreTitle.textContent = `${genre.title} Anime`;
  if (breadcrumbGenre) breadcrumbGenre.textContent = genre.title;
  if (genreDescription) genreDescription.textContent = genre.description;
  loadGenrePage({ reset: true });
}

function activateBrowseTab() {
  document.querySelectorAll('.tab-pane').forEach((pane) => pane.classList.toggle('active', pane.id === 'tab-watchlist'));
  document.querySelectorAll('#app-bottom-nav .nav-item').forEach((item) => item.classList.toggle('active', item.dataset.tab === 'watchlist'));
}

genreGrid?.addEventListener('click', (event) => {
  const card = event.target.closest('[data-browse-genre]');
  if (card) showGenre(card.dataset.browseGenre);
});

sortYearSelect?.addEventListener('change', () => {
  if (!activeGenreKey) return;
  updateUrl();
  loadGenrePage({ reset: true });
});

backButton?.addEventListener('click', () => {
  activeGenreKey = null;
  updateUrl();
  genreView?.classList.add('hidden');
  mainBrowseView?.classList.remove('hidden');
});

window.addEventListener('popstate', () => {
  const key = new URLSearchParams(window.location.search).get('genre');
  if (key && GENRES[key]) showGenre(key, { push: false });
  else backButton?.click();
});

document.addEventListener('click', (event) => {
  const card = event.target.closest('.browse-anime-card');
  if (!card) return;
  openDetails(card.dataset.animeId, card.dataset.animeTitle, card.dataset.animeCover, card.dataset.animeEpisodes);
});

let selectedAnime = null;
async function openDetails(id, fallbackTitle, fallbackCover, fallbackEpisodes) {
  selectedAnime = { animeId: Number(id), title: fallbackTitle, coverUrl: fallbackCover, totalEpisodes: Number(fallbackEpisodes) || null, mediaType: 'anime' };
  if (detailTitle) detailTitle.textContent = fallbackTitle;
  if (detailCover) { detailCover.src = fallbackCover; detailCover.alt = fallbackTitle; }
  if (detailMeta) detailMeta.textContent = 'Loading details…';
  if (detailSynopsis) detailSynopsis.textContent = 'Loading synopsis…';
  detailModal?.classList.remove('hidden');
  try {
    const detail = await getMALDetail(id, 'anime');
    selectedAnime = { ...selectedAnime, title: detail.title || selectedAnime.title, coverUrl: detail.main_picture?.large || detail.main_picture?.medium || selectedAnime.coverUrl, totalEpisodes: detail.num_episodes || selectedAnime.totalEpisodes, score: detail.mean || null };
    if (detailTitle) detailTitle.textContent = selectedAnime.title;
    if (detailCover) { detailCover.src = selectedAnime.coverUrl; detailCover.alt = selectedAnime.title; }
    if (detailMeta) detailMeta.textContent = [detail.mean ? `★ ${detail.mean}` : '', detail.status || '', detail.num_episodes ? `${detail.num_episodes} episodes` : ''].filter(Boolean).join(' · ');
    if (detailSynopsis) detailSynopsis.textContent = detail.synopsis || 'No synopsis is available for this title yet.';
  } catch (error) {
    if (detailMeta) detailMeta.textContent = 'Anime details unavailable';
    if (detailSynopsis) detailSynopsis.textContent = 'The title could not be loaded right now.';
  }
}

detailAdd?.addEventListener('click', () => {
  if (selectedAnime) document.dispatchEvent(new CustomEvent('kaidra:browse-add-anime', { detail: selectedAnime }));
});
detailClose?.addEventListener('click', () => detailModal?.classList.add('hidden'));
detailModal?.addEventListener('click', (event) => { if (event.target === detailModal) detailModal.classList.add('hidden'); });

if (loadSentinel && 'IntersectionObserver' in window) {
  new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) loadGenrePage();
  }, { rootMargin: '500px' }).observe(loadSentinel);
}

const params = new URLSearchParams(window.location.search);
const initialGenre = params.get('genre');
if (initialGenre && GENRES[initialGenre]) {
  activateBrowseTab();
  if (sortYearSelect) sortYearSelect.value = params.get('sort_year') || 'all';
  showGenre(initialGenre, { push: false });
}
