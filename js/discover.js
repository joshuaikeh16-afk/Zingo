import { supabase } from './supabase-client.js';
import { account } from './session.js';
import { element, avatar, actionButton, skeletons, emptyState, navigate, notify, viewProfile } from './ui.js';
import { contentRequest, renderNews, feedError } from './content-client.js';
import { richCard, matchCard } from './content-view.js';
import { preferencesFor } from './preferences.js';
import { categories, mediaCard, heroCarousel, heroEmpty } from './media.js';
import { messagePreview } from './message-state.js';
import { FeedPager } from './feed-pager.js';

let category = 'for-you', userId, stopHero, footballVersion = 0;
const grid = document.getElementById('discover-grid'), homeGrid = document.getElementById('recommendations-grid');
const search = document.getElementById('content-search'), region = document.getElementById('content-region');
const news = document.getElementById('entertainment-news'), hero = document.getElementById('featured-recommendation');
for (const item of categories.filter(item => item.enabled)) {
  const button = actionButton(item.label, item.icon); button.dataset.category = item.id; button.className = item.id === category ? 'active' : '';
  button.setAttribute('aria-pressed', String(item.id === category));
  button.addEventListener('click', () => {
    category = item.id; search.value = '';
    document.querySelectorAll('[data-category]').forEach(node => { node.classList.toggle('active', node === button); node.setAttribute('aria-pressed', String(node === button)); });
    loadCatalog();
  });
  document.getElementById('content-categories').append(button);
}
function createFeed({ target, buttonId, statusId, sentinelId, tab, getPayload, onPage, onUnavailable, onFailure }) {
  const pager = new FeedPager(), button = document.getElementById(buttonId), status = document.getElementById(statusId), sentinel = document.getElementById(sentinelId);
  let payload, failed = false, emptyPages = 0;
  function nearEnd() { const bounds = sentinel.getBoundingClientRect(); return document.body.dataset.activeTab === tab && !document.hidden && bounds.top < innerHeight + 120 && bounds.bottom > 0; }
  async function load(reset = false) {
    if (reset) { pager.reset(); payload = getPayload(); failed = false; emptyPages = 0; skeletons(target, 'media', 6); }
    if (!payload || pager.loading || !pager.hasMore) return;
    const generation = pager.generation;
    failed = false; button.disabled = true; button.hidden = false; button.textContent = 'Loading more picks…'; status.textContent = ''; target.setAttribute('aria-busy', 'true');
    try {
      const result = await pager.next(page => contentRequest('catalog', { ...payload, page }));
      if (!result) return;
      if (!result.data.configured) { onUnavailable?.(); feedError(target, () => load(true), 'Entertainment discovery is temporarily unavailable. Please try again shortly.'); button.hidden = true; return; }
      const fresh = onPage?.(result, payload, pager) ?? result.fresh;
      if (result.page === 1) target.replaceChildren();
      target.append(...fresh.map(mediaCard));
      if (!pager.items.size) target.append(emptyState('Nothing matched that search.', 'Try another title or a different category.', 'search', { label: 'Clear search', run: () => { search.value = ''; loadCatalog(); } }));
      emptyPages = fresh.length ? 0 : emptyPages + 1;
      button.hidden = !pager.hasMore; button.textContent = 'More picks'; status.textContent = pager.hasMore ? 'Keep scrolling for more picks' : pager.items.size ? 'You’ve explored these picks. Tune your tastes for a different mix.' : '';
      requestAnimationFrame(() => { if (generation === pager.generation && pager.hasMore && emptyPages < 3 && nearEnd()) load(); });
    } catch (error) {
      if (generation !== pager.generation) return; failed = true;
      if (!pager.page) { onFailure?.(error); feedError(target, () => load(true), error.message || "We couldn't load these picks."); button.hidden = true; }
      else { status.textContent = 'More picks could not load. Your earlier picks are still here.'; button.textContent = 'Try again'; button.hidden = false; }
    } finally { if (generation === pager.generation) { target.setAttribute('aria-busy', 'false'); button.disabled = false; } }
  }
  button.addEventListener('click', () => load(!pager.page));
  if ('IntersectionObserver' in window) new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting) && !failed && nearEnd()) load(); }, { rootMargin: '120px' }).observe(sentinel);
  return { reset: () => load(true), next: () => load(), pager };
}
const homeFeed = createFeed({ target: document.getElementById('home-feed-grid'), buttonId: 'load-home-more', statusId: 'home-feed-status', sentinelId: 'home-feed-sentinel', tab: 'home',
  getPayload: () => ({ category: 'for-you', region: region.value }),
  onPage: ({ data, fresh, page }) => {
    if (page !== 1) return fresh;
    stopHero?.(); document.getElementById('personal-feed-section').classList.remove('hidden');
    if (!data.items.length) { heroEmpty(hero, () => navigate('discover')); homeGrid.replaceChildren(emptyState('Your next pick is on its way.', 'Try another format or adjust your taste.', 'film')); return []; }
    stopHero = heroCarousel(hero, data.items); homeGrid.replaceChildren(...data.items.slice(0,12).map(mediaCard));
    document.getElementById('recommendation-context').textContent = data.context || 'Picked from your interests'; return fresh.slice(12);
  },
  onUnavailable: () => { stopHero?.(); heroEmpty(hero, () => navigate('discover')); feedError(homeGrid, loadHome, 'Recommendations are temporarily unavailable.'); document.getElementById('personal-feed-section').classList.add('hidden'); },
  onFailure: error => { stopHero?.(); heroEmpty(hero, () => navigate('discover')); feedError(homeGrid, loadHome, error.message); document.getElementById('personal-feed-section').classList.add('hidden'); }
});
const discoveryFeed = createFeed({ target: grid, buttonId: 'load-discover-more', statusId: 'discover-page-status', sentinelId: 'discover-sentinel', tab: 'discover',
  getPayload: () => ({ category: category === 'football' ? 'for-you' : category, query: search.value.trim(), region: region.value }),
  onPage: ({ data, fresh }, payload, pager) => {
    const label = categories.find(item => item.id === payload.category)?.label || 'For you';
    document.getElementById('discover-heading').textContent = payload.query ? `Results for “${payload.query}”` : label === 'For you' ? 'Explore your interests' : `Explore ${label.toLowerCase()}`;
    document.getElementById('discover-context').textContent = data.context || 'Find a story worth sharing';
    document.getElementById('discover-count').textContent = `${pager.items.size} picks`; return fresh;
  }
});
function loadHome() { document.getElementById('personal-feed-section').classList.remove('hidden'); skeletons(homeGrid, 'media', 5); return homeFeed.reset().finally(() => homeGrid.setAttribute('aria-busy', 'false')); }
async function loadCatalog() {
  const version = ++footballVersion;
  document.getElementById('discover-count').textContent = '';
  document.getElementById('discover-more').classList.toggle('hidden', category === 'football');
  if (category !== 'football') return discoveryFeed.reset();
  discoveryFeed.pager.reset(); discoveryFeed.pager.hasMore = false;
  document.getElementById('discover-heading').textContent = 'Matches';
  document.getElementById('discover-context').textContent = 'Fixtures and scores · times shown locally · football-data.org';
  skeletons(grid, 'person', 3);
  try {
    const data = await contentRequest('fixtures'); if (version !== footballVersion) return;
    if (!data.configured) { feedError(grid, loadCatalog, 'Match data is temporarily unavailable.'); return; }
    const matches = data.matches || []; grid.replaceChildren();
    const panel = element('div', 'fixtures-list discover-matches'); panel.append(...matches.map(matchCard)); grid.append(panel);
    if (!matches.length) grid.append(emptyState('No upcoming fixtures', 'Check again later.', 'ball'));
    document.getElementById('discover-count').textContent = `${matches.length} matches`;
  } catch { if (version === footballVersion) feedError(grid, loadCatalog, 'Could not load matches.'); }
  finally { if (version === footballVersion) grid.setAttribute('aria-busy', 'false'); }
}
async function loadNews() {
  skeletons(news, 'media', 2);
  try { const data = await contentRequest('news', { kind: 'entertainment' }); renderNews(news, data.items.slice(0, 3)); }
  catch { feedError(news, loadNews, "We couldn't load the latest stories."); }
  finally { news.setAttribute('aria-busy', 'false'); }
}
document.getElementById('content-search-form').addEventListener('submit', event => { event.preventDefault(); if (category === 'football') { category = 'for-you'; document.querySelectorAll('[data-category]').forEach(node => { const selected = node.dataset.category === category; node.classList.toggle('active', selected); node.setAttribute('aria-pressed', String(selected)); }); } loadCatalog(); });
region.addEventListener('change', async () => {
  const current = await account; if (!current) return;
  const preferences = { ...current.profile.recommendation_preferences, country: region.value };
  const { error } = await supabase.from('profiles').update({ recommendation_preferences: preferences }).eq('id', userId);
  if (error) notify('Using this region for now. Your preference could not be saved.'); else current.profile.recommendation_preferences = preferences;
  await Promise.all([loadCatalog(), loadHome()]);
});
document.getElementById('refresh-news-btn').addEventListener('click', loadNews);
document.addEventListener('kaidra:inbox-data', event => {
  const rows = event.detail.rows, target = document.getElementById('home-conversations'); target.replaceChildren();
  const unread = rows.filter(row => row.unreadCount && !row.muted); target.closest('section').classList.toggle('hidden', !unread.length);
  for (const row of unread.slice(0, 3)) {
    const button = element('button', 'rail-conversation'); button.type = 'button';
    const copy = element('span', 'rail-person-copy'); copy.append(element('strong', '', row.profile?.display_name || row.title || row.profile?.username), element('small', '', messagePreview(row.lastMessage)));
    button.append(avatar(row.profile), copy); button.addEventListener('click', () => document.dispatchEvent(new CustomEvent('kaidra:open-thread', { detail: row }))); target.append(button);
  }
  const shared = rows.filter(row => row.unreadCount && row.lastMessage?.shared_content).slice(0, 4), activity = document.getElementById('home-activity');
  document.getElementById('home-activity-section').classList.toggle('hidden', !shared.length); activity.replaceChildren();
  for (const row of shared) {
    const message = row.lastMessage, entry = element('div', 'activity-row');
    const copy = element('span', 'activity-copy'); copy.append(element('strong', '', message.sender_id === userId ? 'You shared a recommendation' : `A recommendation in ${row.profile?.display_name || row.title || 'your conversation'}`), element('small', '', new Date(message.created_at).toLocaleDateString()));
    entry.append(avatar(row.profile), copy, richCard(message.shared_content, true)); activity.append(entry);
  }
});
document.getElementById('home-social-summary').textContent = 'Find your next favorite. Bring your people along.';
let discoverLoaded = false;
document.addEventListener('kaidra:tab-change', event => { if (event.detail.tab === 'discover' && !discoverLoaded && userId) { discoverLoaded = true; loadCatalog(); } });
(async () => {
  const current = await account; if (!current) return; userId = current.userId;
  const prefs = preferencesFor(current.profile); region.value = prefs.country;
  document.getElementById('taste-summary').textContent = prefs.genres.length ? `For your ${prefs.genres.map(value => value === 'scifi' ? 'sci-fi' : value).join(', ')} side` : 'Selected from your interests';
  skeletons(hero, 'hero', 1);
  await Promise.all([loadHome(), loadNews()]);
  if (document.body.dataset.activeTab === 'discover') { discoverLoaded = true; loadCatalog(); }
})();
window.addEventListener('pagehide', () => stopHero?.());
window.addEventListener('pageshow', event => { if (event.persisted && userId) loadHome(); });
