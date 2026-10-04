import { attachContentActions } from './content-actions.js';
import { element, artwork, actionButton, iconButton } from './ui.js';
import { icon } from './icons.js';
import { openContent, shareContent } from './content-view.js';

// Providers can add categories here without changing Kaidra's visual identity.
export const categories = [
  { id: 'for-you', label: 'For you', icon: 'spark', enabled: true },
  { id: 'movie', label: 'Movies', icon: 'film', enabled: true },
  { id: 'tv', label: 'Series', icon: 'tv', enabled: true },
  { id: 'anime', label: 'Anime', icon: 'spark', enabled: true },
  { id: 'sports', label: 'Sports', icon: 'ball', enabled: true },
  { id: 'games', label: 'Games', icon: 'game', enabled: false },
  { id: 'comics', label: 'Comics', icon: 'book', enabled: false },
  { id: 'wrestling', label: 'Wrestling', icon: 'people', enabled: false },
];
export function contentKind(item) { return item.kind || item.type || 'movie'; }
export function kindLabel(item) { return ({ movie: 'Movie', tv: 'Series', anime: 'Anime', match: 'Match', article: 'Story' })[contentKind(item)] || 'Entertainment'; }
export function metadata(item) {
  return [item.date?.slice(0, 4), item.runtime ? `${item.runtime} min` : '', item.episodes ? `${item.episodes} episodes` : '', item.platforms?.join(' · '), item.rating ? `★ ${Number(item.rating).toFixed(1)}` : ''].filter(Boolean).join(' · ');
}
export function mediaCard(raw) {
  const item = { ...raw, kind: contentKind(raw) };
  const card = element('article', 'content-card'); card.dataset.contentId = `${item.kind}:${item.id}`;
  const open = element('button', 'content-open'); open.type = 'button'; open.setAttribute('aria-label', `Explore ${item.title}`);
  open.append(artwork(item.image, item.title, 'content-cover'), element('strong', '', item.title), element('small', '', metadata(item)));
  open.addEventListener('click', () => openContent(item));
  const badge = element('span', 'content-type', kindLabel(item));
  card.append(open, badge); return attachContentActions(card, item);
}

export function heroCarousel(target, items) {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let index = 0, paused = motion.matches, hovering = false;
  const picks = items.slice(0, 5);
  target.classList.remove('hero-empty'); target.setAttribute('aria-busy', 'false');
  function render() {
    const item = { ...picks[index], kind: contentKind(picks[index]) };
    const copy = element('div', 'featured-copy');
    const tag = element('span', 'featured-tag'); tag.append(icon('spark'), document.createTextNode(kindLabel(item)));
    copy.append(tag, element('h2', '', item.title), element('p', 'featured-meta', metadata(item)), element('p', 'featured-reason', item.reason || 'Picked from your interests'), element('p', 'featured-overview', item.subtitle || ''));
    const actions = element('div', 'detail-actions'), explore = actionButton('View details', 'play', 'primary-button'), share = actionButton('Share', 'share');
    explore.addEventListener('click', () => openContent(item)); share.addEventListener('click', () => shareContent(item)); actions.append(explore, share); copy.append(actions);
    const controls = element('div', 'hero-controls');
    picks.forEach((pick, at) => {
      const dot = element('button', `hero-dot${at === index ? ' active' : ''}`); dot.type = 'button'; dot.setAttribute('aria-label', `Show ${pick.title}`); dot.setAttribute('aria-pressed', String(at === index));
      dot.addEventListener('click', () => { index = at; render(); target.querySelectorAll('.hero-dot')[at]?.focus({ preventScroll: true }); }); controls.append(dot);
    });
    if (picks.length > 1) {
      const pause = iconButton(paused ? 'play' : 'pause', paused ? 'Resume featured rotation' : 'Pause featured rotation', 'icon-button hero-pause');
      pause.setAttribute('aria-pressed', String(paused)); pause.addEventListener('click', () => { paused = !paused; render(); target.querySelector('.hero-pause')?.focus({ preventScroll: true }); }); controls.append(pause);
    }
    target.replaceChildren(artwork(item.backdrop || item.image, '', 'featured-backdrop', true), copy, artwork(item.image, '', 'hero-poster', true), controls);
  }
  render();
  const timer = setInterval(() => {
    if (!paused && !hovering && !document.hidden && document.body.dataset.activeTab === 'home' && !target.contains(document.activeElement) && picks.length > 1) { index = (index + 1) % picks.length; render(); }
  }, 8000);
  const enter = () => { hovering = true; }, leave = () => { hovering = false; };
  const motionChanged = event => { if (event.matches) { paused = true; render(); } }; motion.addEventListener('change', motionChanged);
  target.addEventListener('pointerenter', enter); target.addEventListener('pointerleave', leave);
  return () => { clearInterval(timer); motion.removeEventListener('change', motionChanged); target.removeEventListener('pointerenter', enter); target.removeEventListener('pointerleave', leave); };
}
export function heroEmpty(target, onExplore) {
  target.classList.add('hero-empty'); target.setAttribute('aria-busy', 'false');
  const copy = element('div', 'featured-copy');
  copy.append(element('h2', '', 'Recommendations unavailable'), element('p', 'featured-overview', 'Explore another category or retry your picks below.'));
  const explore = actionButton('Open Discover', 'compass', 'quiet-button'); explore.addEventListener('click', onExplore); copy.append(explore); target.replaceChildren(copy);
}
