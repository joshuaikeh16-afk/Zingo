import { sportsPath } from './sports-client.js';
import { libraryReady, libraryItems } from './library.js';
import { attachContentActions, contentActions } from './content-actions.js';
import { openMenu } from './context-menu.js';
import { element, safeUrl, openModal, artwork, actionButton } from './ui.js';
import { contentRequest, platforms, highlights, externalLink, feedError } from './content-client.js';
import { parseRoute, goRoute, backRoute, isObjectRoute } from './router.js';
import {matchSocialPanel,titleSocialPanel,startChallenge} from './social.js';
let detailVersion = 0;
export function shareContent(item) { document.dispatchEvent(new CustomEvent('kaidra:share-content', { detail: { text: '', content: item } })); }
export function matchContent(match) {
  return { kind:'match', id:match.id, title:`${match.home} vs ${match.away}`, homeId:match.homeId,awayId:match.awayId,home:match.home, away:match.away, homeCrest:match.homeCrest, awayCrest:match.awayCrest, score:match.score, status:match.status, competition:match.competition, competitionName:match.competitionName, utcDate:match.utcDate, updatedAt:match.updatedAt };
}
export function matchVisual(match) {
  const wrap=element('div','match-visual');
  for(const [name,crest] of [[match.home,match.homeCrest],[match.away,match.awayCrest]]) {
    const team=element('div','match-team');
    if(crest){team.append(artwork(crest,'','team-crest'));}else team.append(element('span','team-placeholder',name?.slice(0,2).toUpperCase()||'?'));
    team.append(element('strong','',name||'TBC'));wrap.append(team);
    if(wrap.children.length===1)wrap.append(element('span','match-score',match.score?.home!=null&&match.score?.away!=null?`${match.score.home} – ${match.score.away}`:'vs'));
  }
  return wrap;
}
export function matchCard(match) {
  const live = ['IN_PLAY', 'PAUSED', 'EXTRA_TIME', 'PENALTY_SHOOTOUT'].includes(match.status);
  const card = element('article', `match-card${live ? ' is-live' : ''}`), open = element('button', 'match-open'); open.type = 'button';
  const status = ({ FINISHED: 'Full time', IN_PLAY: 'In play', PAUSED: 'Half time', SCHEDULED: 'Scheduled', TIMED: 'Scheduled', POSTPONED: 'Postponed', CANCELLED: 'Cancelled', SUSPENDED: 'Suspended', EXTRA_TIME: 'Extra time', PENALTY_SHOOTOUT: 'Penalties' })[match.status] || match.status;
  open.append(element('p', 'match-meta', `${match.competitionName || 'Football'} · ${status || 'Scheduled'}`), matchVisual(match));
  open.setAttribute('aria-label', `View ${match.home} versus ${match.away}`); open.addEventListener('click', () => openContent(matchContent(match)));
  card.append(open, element('time', '', match.utcDate ? new Date(match.utcDate).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')); return attachContentActions(card, matchContent(match));
}
export function richCard(item, compact=false) {
  const card=element('button',`rich-content-card${compact?' compact':''}`);card.type='button';
  if(item.kind==='sports'){card.append(artwork(item.image,'','sports-logo'),element('small','rich-card-label',`Football · ${item.entity_type==='event'?'Match':item.entity_type}`),element('strong','',item.title),element('span','muted','Open in Sports →'));}
  else if(item.kind==='match'){card.classList.add('match-share');card.append(element('small','rich-card-label',item.competitionName||'Shared match'),matchVisual(item),element('span','muted',`${(item.status||'scheduled').replaceAll('_',' ').toLowerCase()}${item.utcDate?' · '+new Date(item.utcDate).toLocaleString():''}`));if(item.senderSupport)card.append(element('small','support-snapshot',`Shared support: ${item.senderSupport==='neutral'?'Neutral':item.senderSupport==='home'?item.home:item.away}`));}
  else {
    card.append(artwork(item.image,'','rich-card-image'));
    const copy=element('span','rich-card-copy');copy.append(element('small','rich-card-label',item.kind==='article'?(item.source||'Shared story'):'Shared recommendation'),element('strong','',item.title||'Shared content'),element('span','',item.kind==='article'?'Read the story →':'Details & trailer →'));card.append(copy);
  }
  card.addEventListener('click',()=>openContent(item));return item.kind==='sports'?card:attachContentActions(card, item, false);
}
const snapshots = new Map();
const snapshotKeys = [];
let shownPath;
export function openContent(snapshot) {
  const kind = snapshot.kind || snapshot.type;
  if(kind==='sports'){goRoute(sportsPath(snapshot));return;}
  const path = snapshot.provider === 'mal' || ['anime','manga'].includes(kind) ? `title/mal-${kind}/${snapshot.id}` : kind === 'match' ? `match/${snapshot.id}` : kind === 'article' ? `article/${encodeURIComponent(snapshot.url)}` : `title/${kind}/${snapshot.id}`;
  const route = parseRoute(path); if (!isObjectRoute(route)) return;
  snapshots.set(route.path, snapshot);
  if (!snapshotKeys.includes(route.path)) snapshotKeys.push(route.path);
  if (snapshotKeys.length > 50) { const oldest = snapshotKeys.shift(); snapshots.delete(oldest); try { sessionStorage.removeItem(`kaidra:content:${oldest}`); } catch {} }
  // Only shared public content metadata; no user/session credentials.
  try { sessionStorage.setItem(`kaidra:content:${route.path}`, JSON.stringify(snapshot)); } catch {}
  goRoute(route.path);
}
async function renderContent(snapshot) {
  const version=++detailVersion;
  openModal('content-detail-modal');
  const title=document.getElementById('content-detail-title'),body=document.getElementById('content-detail-body');
  title.textContent=snapshot.title||'Details';
  const loading = element('div', 'skeleton skeleton-detail'); loading.setAttribute('aria-hidden', 'true'); loading.append(element('span', 'skeleton-image'), element('span', 'skeleton-line'), element('span', 'skeleton-line short')); body.replaceChildren(loading);
  const kind = snapshot.kind || snapshot.type;
  document.getElementById('content-detail-modal').dataset.kind = kind;
  document.getElementById('content-detail-kind').textContent = ({ movie: 'Movie', tv: 'Series', match: 'Match', article: 'News story' })[kind] || 'Details';
  if (snapshot.provider === 'mal' || ['anime','manga'].includes(kind)) {
    let item = snapshot,detailsLoaded=false;
    if(kind!=='manga'){try{const details=await contentRequest('anime-detail',{id:snapshot.id});if(details.configured){item={...snapshot,...details,kind:kind||details.kind,type:snapshot.type||kind||details.type};detailsLoaded=true;}}catch{}}
    if (!item.title) { try { await libraryReady(); item = [...libraryItems('favorites'), ...libraryItems('watchlist')].find(saved => saved.provider === 'mal' && String(saved.id) === String(snapshot.id) && saved.kind === kind) || snapshot; } catch {} }
    if (version !== detailVersion) return;
    if(!item.title){feedError(body,()=>renderContent(snapshot),'Title details are unavailable right now.');body.append(externalLink('View on MyAnimeList ↗',`https://myanimelist.net/${kind==='manga'?'manga':'anime'}/${encodeURIComponent(item.id)}`));return;}
    const name = item.title; title.textContent = name;
    body.replaceChildren(artwork(item.image, name, 'detail-poster'), element('h2', '', name), element('p','muted',detailsLoaded?'Metadata from MyAnimeList via Jikan.':'Saved or shared MyAnimeList listing. Open the original for current details.'));
    body.append(externalLink('View on MyAnimeList ↗', `https://myanimelist.net/${kind === 'manga' ? 'manga' : 'anime'}/${encodeURIComponent(item.id)}`));
    if(item.subtitle)body.append(element('p','detail-description',item.subtitle));
    if(item.genres?.length)body.append(element('p','detail-meta',item.genres.join(' · ')));
    if(item.themes?.length)body.append(element('p','muted',`Themes: ${item.themes.join(' · ')}`));
    if(item.streaming?.length){const providers=element('section','streaming-options');providers.append(element('h3','', 'Streaming links from MyAnimeList'));for(const provider of item.streaming)providers.append(externalLink(provider.name,provider.url));providers.append(element('p','muted','These are provider listing links; regional availability is not verified by Jikan.'));body.append(providers);}
    if(item.trailerKey){const trailer=actionButton('Watch trailer','play');trailer.addEventListener('click',()=>{const iframe=element('iframe','trailer-player');iframe.src=`https://www.youtube-nocookie.com/embed/${item.trailerKey}`;iframe.title=`${name} trailer`;iframe.allowFullscreen=true;body.prepend(iframe);});body.append(trailer);}
    const share=actionButton('Send to…','share');share.addEventListener('click',()=>shareContent(item));body.append(share);
    const social=await titleSocialPanel(item);if(version!==detailVersion)return;body.append(social);
    const challenge=actionButton('Discuss a friendly comparison','spark');challenge.addEventListener('click',()=>startChallenge({topic:name,context:{item}}));body.append(challenge);
    const save = actionButton('Saved options', 'bookmark'); save.addEventListener('click', () => openMenu(save, contentActions({...item,title:name}).slice(0,2), 'Saved title')); body.append(save); return;
  }
  if(snapshot.kind==='match'){
    let item=snapshot;
    try{const data=await contentRequest('match',{id:snapshot.id});if(version!==detailVersion)return;if(data.match)item=matchContent(data.match);}catch{}
    if(version!==detailVersion)return;
    if (!item.home || !item.away) { feedError(body, () => renderContent(snapshot), 'Could not load this match.'); return; }
    title.textContent = item.title;
    body.replaceChildren(matchVisual(item),element('p','detail-meta',`${item.competitionName||'Football'} · ${(item.status||'scheduled').replaceAll('_',' ').toLowerCase()}`),element('p','muted',item.utcDate?new Date(item.utcDate).toLocaleString():''));
    body.append(element('p','muted',item.updatedAt?`Score last updated ${new Date(item.updatedAt).toLocaleString()}`:'Shared match snapshot. Live score data may be unavailable for this match.'));
    const social=await matchSocialPanel(item);if(version!==detailVersion)return;body.append(social);return;
  }
  if(snapshot.kind==='article'){
    body.replaceChildren();if(snapshot.image)body.append(artwork(snapshot.image,'','detail-backdrop',true));
    body.append(element('p','news-source',snapshot.source||'News'),element('p','detail-description',snapshot.summary||'Open the source for the full story.'),externalLink('Read full story at source ↗',snapshot.url));
    const send=element('button','primary-button','Send to…');send.type='button';send.addEventListener('click',()=>shareContent(snapshot));body.append(send);return;
  }
  const type=snapshot.kind||snapshot.type;
  if(!['movie','tv'].includes(type)){body.replaceChildren(element('p','muted','Details are unavailable for this content type.'));return;}
  const region=document.getElementById('content-region').value;
  const [detail,providers]=await Promise.allSettled([contentRequest('detail',{type,id:snapshot.id}),contentRequest('providers',{type,id:snapshot.id,region})]);
  if(version!==detailVersion)return;
  const item=detail.status==='fulfilled'&&detail.value.configured?detail.value:snapshot;
  if (!item.title) { feedError(body, () => renderContent(snapshot), 'Could not load this title.'); return; }
  title.textContent=item.title;body.replaceChildren();
  if(item.backdrop||item.image)body.append(artwork(item.backdrop||item.image,'','detail-backdrop',true));
  const identity = element('div', 'detail-identity'), copy = element('div', 'detail-identity-copy');
  identity.append(artwork(item.image || snapshot.image, item.title, 'detail-poster', true)); copy.append(element('h2', '', item.title)); identity.append(copy); body.append(identity);
  copy.append(element('p','detail-meta',[item.date?.slice(0,4),item.rating?`★ ${Number(item.rating).toFixed(1)}`:'',...(item.genres||[])].filter(Boolean).join(' · '))); body.append(element('p','detail-description',item.subtitle||''));
  if(item.cast?.length)body.append(element('p','muted',`Starring ${item.cast.join(', ')}`));
  if(detail.status==='rejected')body.append(element('p','muted','Showing the shared preview. More details are temporarily unavailable.'));
  const actions=element('div','detail-actions');
  if(detail.status==='fulfilled'&&item.trailerKey&&/^[a-zA-Z0-9_-]{11}$/.test(item.trailerKey)){
    const play=actionButton('Watch trailer','play','primary-button');
    play.addEventListener('click',()=>{
      const frame=element('iframe','trailer-player');frame.src=`https://www.youtube-nocookie.com/embed/${item.trailerKey}?autoplay=1`;frame.title=`${item.title} — official trailer`;frame.allow='accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture';frame.allowFullscreen=true;frame.referrerPolicy='strict-origin-when-cross-origin';body.querySelector('.trailer-player')?.remove();body.prepend(frame);frame.scrollIntoView({block:'nearest'});
    });actions.append(play);
  }
  const send=actionButton('Send to…','share');send.addEventListener('click',()=>shareContent({...item,kind:type}));actions.append(send); const save = actionButton('Save', 'bookmark'); save.addEventListener('click', () => openMenu(save, contentActions({...item,kind:type}).slice(0,2), 'Save title')); actions.append(save);body.append(actions);
  if(!item.trailerKey)body.append(element('p','muted','No official trailer is available for this title.'));
  const panel=element('details','streaming-options');panel.open = true;panel.append(element('summary','',`Where to stream · ${region}`));
  if(providers.status==='fulfilled'&&providers.value.providers?.length){
    for(const provider of providers.value.providers){const row=element('div','provider-row');row.append(element('span','',`${provider.name} · ${({flatrate:'subscription',free:'free',ads:'with ads',rent:'rent',buy:'buy'})[provider.kind]||provider.kind}`));
      const names={'Amazon Prime Video':'Prime Video','Disney Plus':'Disney+','Apple TV Plus':'Apple TV','Apple TV+':'Apple TV'};
      const official=platforms.find(platform=>platform.name===(names[provider.name]||provider.name));if(official)row.append(externalLink('Open service ↗',official.url));panel.append(row);
    }
    if(providers.value.link)panel.append(externalLink('Title-specific streaming links ↗',providers.value.link));
    panel.append(element('p','muted','Availability by JustWatch. Service buttons open official platforms; title links are provided through TMDB.'));
  }else panel.append(element('p','muted','Regional streaming availability is not available for this title right now.'));
  body.append(panel);
  const social=await titleSocialPanel({...item,kind:type});if(version!==detailVersion)return;body.append(social);
  const challenge=actionButton('Discuss a friendly comparison','spark');challenge.addEventListener('click',()=>startChallenge({topic:item.title,context:{item:{...item,kind:type}}}));body.append(challenge);
}
document.addEventListener('kaidra:open-content',event=>openContent(event.detail));
document.addEventListener('kaidra:route-change', event => {
  const route = event.detail;
  if (!isObjectRoute(route)||['battle','sports'].includes(route.view)) { shownPath = null; return; }
  if (shownPath === route.path && !document.getElementById('content-detail-modal').classList.contains('hidden')) return;
  shownPath = route.path;
  let snapshot = snapshots.get(route.path);
  if (!snapshot) { try { snapshot = JSON.parse(sessionStorage.getItem(`kaidra:content:${route.path}`)); } catch {} }
  snapshot ||= route.view === 'article' ? { kind: 'article', url: route.id, title: 'News story' } : { kind: route.view === 'match' ? 'match' : route.type, id: route.id, ...(route.provider ? {provider:route.provider} : {}) };
  renderContent(snapshot).catch(() => { if (parseRoute(location.hash).path === route.path) feedError(document.getElementById('content-detail-body'), () => renderContent(snapshot), 'Could not load these details.'); });
});
document.addEventListener('kaidra:modal-close', event => {
  if (event.detail.id !== 'content-detail-modal') return;
  ++detailVersion; shownPath = null;
  const route=parseRoute(location.hash);if (isObjectRoute(route)&&route.view!=='battle') backRoute('discover');
});
