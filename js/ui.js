import { icon } from './icons.js';
export function element(tag, className = '', text = '') {
  const node = document.createElement(tag); node.className = className; node.textContent = text; return node;
}
export function safeUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try { const url = new URL(value, window.location.origin); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; }
  catch { return ''; }
}
export function avatarFallback(profile = {}) {
  const name = profile.display_name || profile.username || 'K';
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase().replace(/[<>&"']/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="32" fill="#282331"/><text x="48" y="52" text-anchor="middle" dominant-baseline="middle" fill="#dccaff" font-family="system-ui,sans-serif" font-size="32" font-weight="600">${initials}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
export function setAvatar(img, profile = {}) {
  img.onerror = () => { img.onerror = null; img.src = avatarFallback(profile); };
  img.src = safeUrl(profile.avatar_url) || avatarFallback(profile); img.alt = profile.display_name || profile.username || 'Profile photo';
}
export function avatar(profile = {}, className = 'avatar') { const img = element('img', className); img.loading = 'lazy'; setAvatar(img, profile); return img; }
export function artwork(url, title, className = '', eager = false) {
  const frame = element('span', `artwork ${className}`.trim()); frame.append(icon('film', 'artwork-placeholder'));
  const src = safeUrl(url); if (!src) { frame.classList.add('artwork-failed'); return frame; }
  const image = element('img'); image.alt = title || ''; image.loading = eager ? 'eager' : 'lazy'; image.decoding = 'async';
  image.addEventListener('load', () => frame.classList.add('artwork-loaded'), { once: true });
  image.addEventListener('error', () => { image.remove(); frame.classList.add('artwork-failed'); }, { once: true });
  image.src = src; frame.append(image); return frame;
}
export function iconButton(name, label, className = 'icon-button') {
  const button = element('button', className); button.type = 'button'; button.title = label; button.setAttribute('aria-label', label); button.append(icon(name)); return button;
}
export function actionButton(label, name, className = 'quiet-button') {
  const button = element('button', className); button.type = 'button'; if (name) button.append(icon(name)); button.append(element('span', '', label)); return button;
}
export function skeletons(target, kind = 'media', count = 6) {
  target.setAttribute('aria-busy', 'true');
  target.replaceChildren(...Array.from({ length: count }, () => {
    const node = element('div', `skeleton skeleton-${kind}`); node.setAttribute('aria-hidden', 'true');
    node.append(element('span', 'skeleton-image'), element('span', 'skeleton-line'), element('span', 'skeleton-line short')); return node;
  }));
}
export function emptyState(title, description, name = 'spark', action) {
  const box = element('div', 'empty-state'); box.append(icon(name, 'empty-state-icon'), element('h3', '', title), element('p', '', description));
  if (action) { const button = actionButton(action.label, 'arrow'); button.addEventListener('click', action.run); box.append(button); } return box;
}
export function navigate(tab) { document.dispatchEvent(new CustomEvent('kaidra:navigate', { detail: { tab } })); }
export function notify(message) {
  const status = document.getElementById('app-status'); if (!status) return;
  status.replaceChildren(icon('check'), element('span', '', message)); status.classList.remove('hidden');
  clearTimeout(notify.timer); notify.timer = setTimeout(() => status.classList.add('hidden'), 5000);
}
export function viewProfile(userId) { navigate(`user/${encodeURIComponent(userId)}`); }
const modalStack = [], modalFocus = new Map(), desktop = matchMedia('(min-width: 1100px)');
export function topModal() { return modalStack.at(-1); }
export function syncModalViewport() {
  const viewport = window.visualViewport;
  document.documentElement.style.setProperty('--modal-vh', `${viewport?.height || innerHeight}px`);
  document.documentElement.style.setProperty('--modal-top', `${viewport?.offsetTop || 0}px`);
}
syncModalViewport();
window.visualViewport?.addEventListener('resize', syncModalViewport);
window.visualViewport?.addEventListener('scroll', syncModalViewport);
window.addEventListener('resize', syncModalViewport);
export function openModal(id) {
  const modal = document.getElementById(id); if (!modal || modalStack.includes(id)) return;
  modalFocus.set(id, document.activeElement); modalStack.push(id); modal.classList.remove('hidden','reaction-closing'); syncOverlay();
  const focusTarget = modal.querySelector('[autofocus]') || modal.querySelector('input:not([type="file"]):not([type="checkbox"]), textarea') || modal.querySelector('button');
  focusTarget?.focus({ preventScroll: true });
  document.dispatchEvent(new CustomEvent('kaidra:modal-open', { detail: { id } }));
}
export function closeModal(id) {
  const modal = document.getElementById(id); if (!modal || !modalStack.includes(id)) return;
  modalStack.splice(modalStack.indexOf(id), 1); modal.querySelectorAll('iframe').forEach(frame => frame.remove()); if(modal.classList.contains('reaction-popover')&&!matchMedia('(prefers-reduced-motion: reduce)').matches){modal.classList.add('reaction-closing');modal.inert=true;setTimeout(()=>{if(!modalStack.includes(id)){modal.classList.add('hidden');modal.classList.remove('reaction-closing');}},100);}else modal.classList.add('hidden'); modal.inert = false; syncOverlay();
  const focus = modalFocus.get(id); modalFocus.delete(id); if (focus?.isConnected && !focus.closest('[inert]')) focus.focus({ preventScroll: true });
  document.dispatchEvent(new CustomEvent('kaidra:modal-close', { detail: { id } }));
}
export function syncOverlay() {
  const modal = topModal(), chatOpen = !!document.querySelector('.chat-overlay.is-active'), blocking = !!modal || (chatOpen && !desktop.matches);
  document.querySelectorAll('.app-header, .bottom-nav-container, .desktop-sidebar').forEach(node => { node.inert = blocking; });
  const main = document.querySelector('.main-content'); if (main) main.inert = !!modal;
  document.querySelectorAll('.tab-pane').forEach(node => { node.inert = chatOpen && !desktop.matches && node.id !== 'tab-inbox'; });
  document.querySelectorAll('#tab-inbox > .page-heading, .conversation-panel, .chat-placeholder').forEach(node => { node.inert = chatOpen && !desktop.matches; });
  const drawer = document.getElementById('chat-view-drawer'); if (drawer) drawer.inert = !!modal || !chatOpen;
  document.querySelectorAll('.social-modal').forEach(node => { node.inert = modalStack.includes(node.id) && node.id !== modal; });
  document.body.classList.toggle('overlay-open', blocking);
}
desktop.addEventListener('change', syncOverlay);
export function showError(id, message = '') { const node = document.getElementById(id); if (!node) return; node.textContent = message; node.classList.toggle('hidden', !message); }
