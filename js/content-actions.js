import { bindContext } from './context-menu.js';
import { libraryStateByKey, libraryState, toggleLibrary, libraryKey } from './library.js';
export function contentActions(item) {
  const state = libraryState(item), kind = item.kind || item.type;
  return [
    { label: state.is_favorite ? 'Remove from Favorites' : 'Add to Favorites', icon: 'heart', run: () => toggleLibrary(item, 'favorites') },
    ['movie', 'tv', 'anime', 'manga'].includes(kind) && { label: state.is_watchlisted ? 'Remove from Watchlist' : 'Add to Watchlist', icon: 'bookmark', run: () => toggleLibrary(item, 'watchlist') },
    { label: 'Send to…', icon: 'send', run: () => document.dispatchEvent(new CustomEvent('kaidra:share-content', { detail: { content: item, text: '' } })) },
    { label: 'More info', icon: 'info', run: () => document.dispatchEvent(new CustomEvent('kaidra:open-content', { detail: item })) },
  ];
}
export function attachContentActions(node, item, more = true) {
  node.dataset.libraryKey = libraryKey(item); update(node, libraryState(item));
  bindContext(node, () => contentActions(item), { title: `Actions for ${item.title}`, more }); return node;
}
function update(node, state) { node.classList.toggle('is-favorite', !!state.is_favorite); node.classList.toggle('is-watchlisted', !!state.is_watchlisted); }
document.addEventListener('kaidra:library-change', () => document.querySelectorAll('[data-library-key]').forEach(node => {
  update(node, libraryStateByKey(node.dataset.libraryKey));
}));
