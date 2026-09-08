import { getMALRanking, getMALSeasonal, getMALUpcoming } from './mal-client.js';

const grid = document.getElementById('discovery-grid');
const tabs = document.querySelectorAll('[data-discovery]');
const heroCover = document.getElementById('anime-hero-cover');
const heroTitle = document.getElementById('anime-hero-title');
const heroMeta = document.getElementById('anime-hero-meta');
const heroSynopsis = document.getElementById('anime-hero-synopsis');
const heroAction = document.getElementById('anime-hero-action');
let heroAnime = null;

function renderHero(item) {
  if (!item) return;
  heroAnime = item;
  if (heroCover) heroCover.src = item.main_picture?.large || item.main_picture?.medium || '';
  if (heroTitle) heroTitle.textContent = item.title || 'Featured anime';
  if (heroMeta) heroMeta.textContent = [item.mean ? `★ ${item.mean}` : '', item.num_episodes ? `${item.num_episodes} episodes` : '', item.status || ''].filter(Boolean).join(' · ');
  if (heroSynopsis) heroSynopsis.textContent = item.synopsis || 'Discover your next favorite anime and share it with the community.';
}

heroAction?.addEventListener('click', () => {
  if (!heroAnime) return;
  document.dispatchEvent(new CustomEvent('kaidra:hero-add-anime', { detail: {
    animeId: heroAnime.id,
    title: heroAnime.title,
    coverUrl: heroAnime.main_picture?.large || heroAnime.main_picture?.medium || '',
    totalEpisodes: heroAnime.num_episodes || null,
    mediaType: 'anime',
    score: heroAnime.mean || null,
  }}));
});

function cards(payload, type = 'anime') {
  const items = (payload?.data || []).map((item) => item.node || item);
  if (!items.length) {
    grid.innerHTML = '<p class="discovery-empty">No titles found right now.</p>';
    return;
  }
  renderHero(items[0]);
  grid.innerHTML = items.slice(1).map((item) => {
    const title = item.title || 'Untitled';
    const cover = item.main_picture?.large || item.main_picture?.medium || '';
    const meta = [item.media_type?.toUpperCase(), item.num_episodes ? `${item.num_episodes} eps` : '', item.mean ? `★ ${item.mean}` : ''].filter(Boolean).join(' · ');
    return `<article class="recommendation-card"><img src="${cover}" alt="${title}" /><div><span>${meta || type.toUpperCase()}</span><h3>${title}</h3><p>${(item.synopsis || 'Discover this title and share your thoughts with the community.').slice(0, 120)}</p><button type="button" data-mal-title="${title}">Discuss</button></div></article>`;
  }).join('');
}

async function loadDiscovery(kind) {
  if (!grid) return;
  grid.innerHTML = '<p class="discovery-empty">Loading titles from MyAnimeList…</p>';
  try {
    const year = new Date().getUTCFullYear();
    const season = ['winter', 'spring', 'summer', 'fall'][Math.floor(new Date().getUTCMonth() / 3)];
    if (kind === 'seasonal') cards(await getMALSeasonal(year, season, 18));
    else if (kind === 'upcoming') cards(await getMALUpcoming(18));
    else if (kind === 'manga') cards(await getMALRanking('manga', 'bypopularity', 18), 'manga');
    else cards(await getMALRanking('anime', kind === 'ranking' ? 'all' : 'bypopularity', 18));
  } catch (error) {
    console.error('MAL discovery failed:', error);
    grid.innerHTML = '<p class="discovery-empty">MyAnimeList discovery is unavailable. Configure the MAL Edge Function first.</p>';
  }
}

tabs.forEach((tab) => tab.addEventListener('click', () => {
  tabs.forEach((item) => item.classList.toggle('active', item === tab));
  loadDiscovery(tab.dataset.discovery);
}));

loadDiscovery('recommendations');
