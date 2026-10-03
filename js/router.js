// Hash destinations work on static hosting without server rewrite rules.
const primary = new Set(['home', 'discover', 'friends', 'inbox', 'profile']);
export function parseRoute(hash = '') {
  let parts;
  try { parts = hash.replace(/^#/, '').split('/').map(decodeURIComponent); } catch { return { view: 'home', path: 'home' }; }
  const [view, type, id] = parts;
  if (primary.has(view) && parts.length === 1) return { view, path: view };
  if (view === 'inbox' && parts.length === 2 && /^[a-zA-Z0-9-]{1,80}$/.test(type)) return { view, id: type, path: `inbox/${encodeURIComponent(type)}` };
  if (view === 'user' && parts.length === 2 && /^[a-zA-Z0-9-]{1,80}$/.test(type)) return { view, id: type, path: `user/${encodeURIComponent(type)}` };
  if (view === 'title' && /^mal-(anime|manga|movie|tv)$/.test(type) && /^\d+$/.test(id) && parts.length === 3) return {view, type:type.slice(4), provider:'mal', id, path:`title/${type}/${id}`};
  if (view === 'title' && ['movie', 'tv'].includes(type) && /^\d+$/.test(id) && parts.length === 3) return { view, type, id, path: `title/${type}/${id}` };
  if (view === 'match' && /^\d+$/.test(type) && parts.length === 2) return { view, id: type, path: `match/${type}` };
  if (view === 'article' && parts.length === 2 && /^https:\/\//.test(type)) return { view, id: type, path: `article/${encodeURIComponent(type)}` };
  return { view: 'home', path: 'home' };
}
export const isObjectRoute = route => ['title', 'match', 'article'].includes(route.view);
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
