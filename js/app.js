import { confirmAction } from './context-menu.js';
import { supabase, getUserPreferences, updateUserPreferences } from './supabase-client.js';
import { account } from './session.js';
import { openModal, closeModal, topModal, syncOverlay, notify, showError, setAvatar } from './ui.js';
import { hydrateIcons } from './icons.js';
import { parseRoute, goRoute, isObjectRoute } from './router.js';

hydrateIcons();
document.addEventListener('kaidra:profile-updated', event => {
  for (const id of ['sidebar-avatar']) setAvatar(document.getElementById(id), event.detail);
  document.getElementById('sidebar-name').textContent = event.detail.display_name || event.detail.username;
});
document.documentElement.dataset.theme = 'dark';
let userId, currentTab = '', discardTarget;
const names = { home: 'For you', discover: 'Discover', friends: 'Friends', inbox: 'Inbox', profile: 'My profile' };
function applyRoute(route, restore = false) {
  if (route.view === 'user' && route.id === userId) { goRoute('profile', { replace: true }); return; }
  const object = isObjectRoute(route);
  const backdrop = parseRoute(history.state?.backdrop || 'discover');
  const tab = object ? backdrop.view : route.view;
  if (!object) closeModal('content-detail-modal');
  if (tab !== currentTab || (tab === 'inbox' && !route.id && !object)) document.dispatchEvent(new CustomEvent('kaidra:close-chat'));
  const changed = tab !== currentTab;
  currentTab = tab; document.body.dataset.activeTab = tab;
  document.querySelectorAll('[data-tab]').forEach(button => {
    const active = button.dataset.tab === tab;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.toggle('active', pane.id === `tab-${tab}`));
  document.getElementById('header-route').textContent = names[tab] || 'Profile';
  if (userId && names[tab]) localStorage.setItem(`kaidra:last-tab:${userId}`, tab);
  document.dispatchEvent(new CustomEvent('kaidra:tab-change', { detail: { tab } }));
  document.dispatchEvent(new CustomEvent('kaidra:route-change', { detail: route }));
  if (changed && !object) window.scrollTo({ top: restore ? history.state?.scrollY || 0 : 0, behavior: 'instant' });
}
document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => goRoute(button.dataset.tab)));
document.querySelectorAll('[data-navigate]').forEach(button => button.addEventListener('click', () => goRoute(button.dataset.navigate)));
document.addEventListener('kaidra:navigate', event => goRoute(event.detail.tab));
document.addEventListener('kaidra:route-intent', event => applyRoute(event.detail));
window.addEventListener('popstate', () => applyRoute(parseRoute(location.hash), true));
window.addEventListener('hashchange', () => { if (parseRoute(location.hash).path !== document.body.dataset.route) applyRoute(parseRoute(location.hash), true); });
document.addEventListener('kaidra:route-change', event => { document.body.dataset.route = event.detail.path; });
document.querySelectorAll('[data-action="find-people"]').forEach(button => button.addEventListener('click', () => openModal('find-friends-modal')));
document.querySelectorAll('[data-open-settings]').forEach(button => button.addEventListener('click', () => openModal('settings-overlay')));
document.getElementById('open-settings-btn').addEventListener('click', () => openModal('settings-overlay'));
document.getElementById('settings-edit-profile').addEventListener('click', () => {
  closeModal('settings-overlay'); goRoute('profile'); document.getElementById('edit-profile-btn').click();
});
document.getElementById('settings-sports').addEventListener('click', () => openModal('sports-settings-modal'));
document.getElementById('open-sports-settings').addEventListener('click', () => openModal('sports-settings-modal'));
document.getElementById('tune-recommendations').addEventListener('click', () => { location.href = '/onboarding.html?edit=1'; });

function requestClose(id) {
  const modal = document.getElementById(id);
  if (modal?.hasAttribute('data-protect-form') && modal.dataset.dirty === 'true') {
    discardTarget = id; openModal('discard-modal'); return;
  }
  closeModal(id);
}
document.querySelectorAll('[data-protect-form]').forEach(modal => modal.addEventListener('input', () => { modal.dataset.dirty = 'true'; }));
document.addEventListener('kaidra:modal-close', event => { const modal = document.getElementById(event.detail.id); if (modal) delete modal.dataset.dirty; });
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => requestClose(button.dataset.close)));
document.querySelectorAll('.social-modal').forEach(modal => modal.addEventListener('click', event => { if (event.target === modal) requestClose(modal.id); }));
document.getElementById('keep-editing-btn').addEventListener('click', () => closeModal('discard-modal'));
document.getElementById('discard-changes-btn').addEventListener('click', () => { closeModal('discard-modal'); if (discardTarget) closeModal(discardTarget); discardTarget = null; });
document.addEventListener('keydown', event => {
  const modalId = topModal();
  const mobileChat = !matchMedia('(min-width: 1100px)').matches && document.querySelector('.chat-overlay.is-active');
  const overlay = modalId ? document.getElementById(modalId) : mobileChat;
  if (!overlay) return;
  if (event.key === 'Escape') { event.preventDefault(); if (modalId) requestClose(modalId); else goRoute('inbox'); }
  if (event.key === 'Tab') {
    const nodes = [...overlay.querySelectorAll('button:not(:disabled), input, textarea, select, a[href]')].filter(node => node.getClientRects().length && !node.closest('[inert]'));
    const first = nodes[0], last = nodes.at(-1);
    if (event.shiftKey && (document.activeElement === first || !overlay.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !overlay.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
  }
});
function onlineState() { document.getElementById('offline-banner').classList.toggle('hidden', navigator.onLine); }
onlineState(); window.addEventListener('online', onlineState); window.addEventListener('offline', onlineState);
function viewportChanged() {
  const viewport = window.visualViewport;
  const mobile = !matchMedia('(min-width: 1100px)').matches;
  const drawer = document.getElementById('chat-view-drawer');
  drawer.style.setProperty('--chat-height', `${viewport?.height || innerHeight}px`);
  drawer.style.setProperty('--chat-top', `${viewport?.offsetTop || 0}px`);
  if (mobile) { drawer.setAttribute('role', 'dialog'); drawer.setAttribute('aria-modal', 'true'); }
  else { drawer.removeAttribute('role'); drawer.removeAttribute('aria-modal'); }
  syncOverlay();
}
viewportChanged(); window.visualViewport?.addEventListener('resize', viewportChanged); window.visualViewport?.addEventListener('scroll', viewportChanged); window.addEventListener('resize', viewportChanged);

(async () => {
  const current = await account; if (!current) return;
  userId = current.userId;
  for (const id of ['sidebar-avatar']) setAvatar(document.getElementById(id), current.profile);
  document.getElementById('sidebar-name').textContent = current.profile.display_name || current.profile.username;
  document.getElementById('sidebar-handle').textContent = `@${current.profile.username}`;
  document.getElementById('home-greeting').textContent = `Hey, ${(current.profile.display_name || current.profile.username).split(' ')[0]}`;
  const legacyUser = new URLSearchParams(location.search).get('user');
  goRoute(legacyUser ? `user/${encodeURIComponent(legacyUser)}` : location.hash.slice(1) || localStorage.getItem(`kaidra:last-tab:${userId}`) || 'home', { replace: true });
  try {
    const preferences = await getUserPreferences(userId), toggle = document.getElementById('setting-allow-dms');
    toggle.checked = preferences.allow_dms;
    toggle.addEventListener('change', async () => {
      const value = toggle.checked; toggle.disabled = true; showError('settings-error');
      try { await updateUserPreferences(userId, { allow_dms: value }); notify('Messaging preference saved.'); }
      catch { toggle.checked = !value; showError('settings-error', 'Could not save that setting. Please try again.'); }
      finally { toggle.disabled = false; }
    });
  } catch { document.getElementById('setting-allow-dms').disabled = true; showError('settings-error', 'Could not load messaging preferences. Refresh Kaidra to try again.'); }
})();
document.getElementById('settings-logout-btn').addEventListener('click', async event => {
  const button = event.currentTarget;
  if (!await confirmAction('Log out of Kaidra?', 'Your conversations and library will be here when you return.', 'Log out')) return; button.disabled = true;
  const { error } = await supabase.auth.signOut();
  if (error) { button.disabled = false; notify('Could not log out. Please try again.'); return; }
  location.replace('/auth.html');
});
