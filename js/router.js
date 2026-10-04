// Hash destinations work on static hosting without server rewrite rules.
const primary = new Set(['home', 'discover', 'friends', 'inbox', 'profile']);
export function parseRoute(hash = '') {
  const discovery = hash.replace(/^#/, '').split('?');
  const segments = discovery[0].split('/');
  if(segments[0]==='discover'&&segments.length>=2&&segments.length<=3&&['movie','tv','anime','football'].includes(segments[1])){
    const section=segments[2]||'popular';
    if(!/^[a-z-]{1,24}$/.test(section))return {view:'discover',path:'discover'};
    const params=new URLSearchParams(discovery[1]||'');
    for(const key of [...params.keys()])if(!['genre','theme','year','season','cinema','format','decade','service','sort','query','competition','club'].includes(key)||params.get(key).length>100)params.delete(key);
    params.sort();return {view:'discover',category:segments[1],section,filters:Object.fromEntries(params),path:`discover/${segments[1]}/${section}${params.size?'?'+params.toString():''}`};
  }
  let parts;
  try { parts = hash.replace(/^#/, '').split('/').map(decodeURIComponent); } catch { return { view: 'home', path: 'home' }; }
  const [view, type, id] = parts;
  if(view==='battle'&&parts.length===2&&/^[0-9a-f-]{36}$/i.test(type))return {view,id:type,path:`battle/${type}`};
  if (primary.has(view) && parts.length === 1) return { view, path: view };
  if (view === 'inbox' && parts.length === 2 && /^[a-zA-Z0-9-]{1,80}$/.test(type)) return { view, id: type, path: `inbox/${encodeURIComponent(type)}` };
  if (view === 'user' && parts.length === 2 && /^[a-zA-Z0-9-]{1,80}$/.test(type)) return { view, id: type, path: `user/${encodeURIComponent(type)}` };
  if (view === 'title' && /^mal-(anime|manga|movie|tv)$/.test(type) && /^\d+$/.test(id) && parts.length === 3) return {view, type:type.slice(4), provider:'mal', id, path:`title/${type}/${id}`};
  if (view === 'title' && ['movie', 'tv'].includes(type) && /^\d+$/.test(id) && parts.length === 3) return { view, type, id, path: `title/${type}/${id}` };
  if (view === 'match' && /^\d+$/.test(type) && parts.length === 2) return { view, id: type, path: `match/${type}` };
  if (view === 'article' && parts.length === 2 && /^https:\/\//.test(type)) return { view, id: type, path: `article/${encodeURIComponent(type)}` };
  return { view: 'home', path: 'home' };
}
export const isObjectRoute = route => ['title', 'match', 'article','battle'].includes(route.view);
export function goRoute(path, { replace = false } = {}) {
  const route = parseRoute(path), previous = parseRoute(location.hash);
  const url = new URL(location.href); url.hash = route.path; url.searchParams.delete('user');
  if (route.path !== previous.path || !location.hash) {
    const state = { kaidra: true, returnTo: previous.path, scrollY: 0 };
    if (isObjectRoute(route)) state.backdrop = isObjectRoute(previous) ? history.state?.backdrop || 'discover' : previous.path;
    history.replaceState({ ...history.state, scrollY }, '', location.href);
    history[replace ? 'replaceState' : 'pushState'](state, '', url);
  }
  document.dispatchEvent(new CustomEvent('kaidra:route-intent', { detail: route }));
}
export function backRoute(fallback = 'home') { if (history.state?.kaidra && history.state.returnTo) history.back(); else goRoute(fallback, { replace: true }); }
