import { getMALRanking, getMALSeasonal, getMALUpcoming } from './mal-client.js';

const grid = document.getElementById('discovery-grid');
const tabs = document.querySelectorAll('[data-discovery]');

function cards(payload, type = 'anime') {
  const items = (payload?.data || []).map((item) => item.node || item);
  if (!items.length) {
    grid.innerHTML = '<p class="discovery-empty">No titles found right now.</p>';
    return;
  }
  grid.innerHTML = items.map((item) => {
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
