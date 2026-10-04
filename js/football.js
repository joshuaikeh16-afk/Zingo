import { goRoute } from './router.js';
import { supabase } from './supabase-client.js';
import { account } from './session.js';
import { element, actionButton, skeletons, emptyState } from './ui.js';
import { contentRequest, highlights, renderNews, feedError, externalLink } from './content-client.js';
import { matchCard } from './content-view.js';
import {footballPreferences} from './social.js';
import { preferencesFor } from './preferences.js';
const panel = document.getElementById('interest-football'), matches = document.getElementById('fixtures-list');
const headlines = document.getElementById('football-news'), events = document.getElementById('sports-events'), league = document.getElementById('football-league');
let data = [], version = 0, ready = false, enabled = false,profile;
function relevance(match){const prefs=profile?.recommendation_preferences||{};return ((prefs.football_clubs||[]).map(Number).some(id=>[match.homeId,match.awayId].includes(id))?4:0)+((prefs.football_competitions||[]).includes(match.competition)?2:0)+(['IN_PLAY','PAUSED'].includes(match.status)?1:0);}
function renderMatches() {
  const selected = data.filter(match => league.value === 'ALL' || match.competition === league.value).sort((a,b)=>relevance(b)-relevance(a)||a.utcDate.localeCompare(b.utcDate)).slice(0, 8);
  matches.replaceChildren();
  if (!selected.length) { matches.append(emptyState('No upcoming fixtures', 'No fixtures are available for this competition in the next seven days.', 'ball')); return; }
  matches.append(...selected.map(matchCard));
}
async function loadMatches() {
  const request = ++version; skeletons(matches, 'person', 2);
  try {
    const result = await contentRequest('fixtures'); if (request !== version) return; data = result.matches;
    if (!result.configured) { feedError(matches, loadMatches, 'Match data is temporarily unavailable.'); return; }
    renderMatches(); document.getElementById('fixtures-updated').textContent = `Updated ${new Date(result.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · times shown locally · football-data.org`;
  } catch { if (request === version) feedError(matches, loadMatches, "We couldn't load the fixtures."); }
  finally { if (request === version) matches.setAttribute('aria-busy', 'false'); }
}
async function loadNews() {
  try { const result = await contentRequest('news', { kind: 'football' }); renderNews(headlines, result.items.slice(0, 2)); }
  catch { feedError(headlines, loadNews, "We couldn't load football stories."); }
}
async function loadEvents() {
  try {
    const { data, error } = await supabase.from('sports_events').select('event_key,title,body,url,starts_at').eq('kind', 'special').gte('starts_at', new Date().toISOString()).order('starts_at').limit(4);
    if (error) throw error; events.replaceChildren(); events.classList.toggle('hidden', !data.length);
    for (const event of data) { const card = element('article', 'news-card'); card.append(element('p', 'news-source', new Date(event.starts_at).toLocaleString()), externalLink(event.title, event.url, 'news-headline'), element('p', 'news-summary', event.body)); events.append(card); }
  } catch { events.classList.add('hidden'); }
}
async function showFootball() { enabled = true; panel.classList.remove('hidden'); if (ready) await Promise.all([loadMatches(), loadNews(), loadEvents()]); }
league.addEventListener('change', renderMatches);
document.getElementById('refresh-football-btn').addEventListener('click', () => Promise.all([loadMatches(), loadNews(), loadEvents()]));
document.addEventListener('kaidra:show-football', showFootball);
let timer;
function startTimer() { clearInterval(timer); timer = setInterval(() => { if (ready && enabled && !document.hidden && document.body.dataset.activeTab === 'home') loadMatches(); }, 60000); }
startTimer();
(async () => { const current = await account; if (!current) return; profile=current.profile;ready = true; if (preferencesFor(current.profile).football || enabled) showFootball(); })();
window.addEventListener('pagehide', () => clearInterval(timer));
window.addEventListener('pageshow', event => { if (event.persisted) { startTimer(); if (ready && enabled) loadMatches(); } });

document.getElementById('home-football-follow').addEventListener('click',()=>goRoute('discover/sports/clubs'));document.addEventListener('kaidra:football-preferences',()=>{if(ready)showFootball();});
