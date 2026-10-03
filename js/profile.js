import { libraryReady, libraryItems } from './library.js';
import { confirmAction } from './context-menu.js';
import { supabase, getFriendCount, getFriendshipStatus, sendFriendRequest, cancelFriendRequest, removeFriend, getIncomingRequests, respondToFriendRequest } from './supabase-client.js';
import { account } from './session.js';
import { setAvatar, element, openModal, closeModal, showError, notify, navigate, emptyState } from './ui.js';
import { mediaCard } from './media.js';
import { preferencesFor } from './preferences.js';
import { backRoute } from './router.js';
let userId, viewedId, viewedProfile;
const views = { own: { version: 0, profile: null }, other: { version: 0, profile: null } };
const button = document.getElementById('friend-action-btn');
const editButton = document.getElementById('edit-profile-btn');
const messageButton = document.getElementById('profile-message-btn');
const fields = ['display-name', 'status', 'bio', 'template'];
async function loadProfile(id) {
  if (!userId || !id) return;
  const own = id === userId, state = views[own ? 'own' : 'other'], version = ++state.version;
  const prefix = own ? '' : 'user-', node = suffix => document.getElementById(`${prefix}${suffix}`);
  if (!own) { viewedId = id; state.profile = null; button.disabled = true; button.textContent = 'Loading…'; messageButton.classList.add('hidden'); document.getElementById('decline-user-request')?.remove(); for (const suffix of ['profile-username', 'profile-status', 'profile-cover-taste', 'stat-friends', 'stat-favorites']) node(suffix).textContent = ''; node('profile-interest-chips').replaceChildren(); setAvatar(node('profile-avatar'), {}); }
  showError(`${prefix}profile-error`);
  node('profile-display-name').textContent = 'Loading…';
  node('profile-bio').textContent = ''; node('profile-favorites').replaceChildren();
  try {
    const [{ data: profile, error }, count, status] = await Promise.all([
      supabase.from('profiles').select('id,username,display_name,avatar_url,bio,status_text,interests,profile_template,recommendation_preferences').eq('id', id).maybeSingle(),
      getFriendCount(id), own ? Promise.resolve('self') : getFriendshipStatus(userId, id),
    ]);
    if (version !== state.version) return;
    if (error || !profile) throw error || new Error('Profile not found');
    state.profile = profile;
    if (own) viewedProfile = profile;
    setAvatar(node('profile-avatar'), profile);
    node('profile-display-name').textContent = profile.display_name || profile.username;
    node('profile-username').textContent = `@${profile.username}`;
    node('profile-status').textContent = profile.status_text || '';
    node('profile-bio').textContent = profile.bio || '';
    node('stat-friends').textContent = count;
    const tastes = preferencesFor(profile);
    node('stat-favorites').textContent = tastes.favorites.length;
    node('profile-cover-taste').textContent = [...tastes.genres.slice(0, 3), ...(tastes.football ? ['football'] : [])].join(' / ');
    node('profile-interest-chips').replaceChildren(...(profile.interests || []).slice(0, 12).map(value => element('span', '', String(value).replaceAll('_', ' '))));
    const hero = document.querySelector(`#tab-${own ? 'profile' : 'user'} .profile-hero-card`);
    hero.className = `profile-hero-card profile-template-${['midnight', 'ocean', 'sunset', 'monochrome', 'sakura'].includes(profile.profile_template) ? profile.profile_template : 'midnight'}`;
    node('profile-taste-summary').textContent = [tastes.content_types.map(type => ({ movie: 'Movies', tv: 'series', anime: 'anime' })[type] || type).join(', '), tastes.genres.join(', '), tastes.football ? 'football' : ''].filter(Boolean).join(' · ');
    if (own) await renderLibrary();
    else { const favorites = node('profile-favorites'); favorites.replaceChildren(...tastes.favorites.map(mediaCard)); if (!tastes.favorites.length) favorites.append(element('p', 'muted', 'No favorite titles shared yet.')); }
    if (!own) {
      button.classList.remove('hidden'); button.disabled = false;
      messageButton.classList.toggle('hidden', status !== 'friends');
      button.dataset.state = status;
      button.textContent = ({ none: 'Add friend', pending_sent: 'Cancel request', pending_received: 'Accept request', friends: 'Remove friend' })[status] || 'Add friend';
      document.getElementById('decline-user-request')?.remove();
      if (status === 'pending_received') {
        const decline = element('button', 'quiet-button', 'Decline'); decline.type = 'button'; decline.id = 'decline-user-request';
        decline.addEventListener('click', () => respondIncoming(false)); button.after(decline);
      }
    }
  } catch { if (version === state.version) { node('profile-display-name').textContent = 'Profile unavailable'; showError(`${prefix}profile-error`, 'Could not load this profile. Reopen it to try again.'); } }
}
async function respondIncoming(accept) {
  button.disabled = true;
  try { const requests = await getIncomingRequests(userId), request = requests.find(item => item.requester.id === viewedId); if (!request) throw new Error('Request expired'); await respondToFriendRequest(request.id, accept); document.dispatchEvent(new CustomEvent('kaidra:friends-changed')); }
  catch { showError('user-profile-error', 'Could not update this request. Try again.'); }
  finally { button.disabled = false; }
}
button.addEventListener('click', async () => {
  const state = button.dataset.state;
  if (state === 'pending_received') { await respondIncoming(true); return; }
  if (state === 'friends' && !await confirmAction('Remove friend?', 'You can send them another request later.', 'Remove friend')) return;
  button.disabled = true;
  try {
    if (state === 'friends') await removeFriend(userId, viewedId);
    else if (state === 'pending_sent') await cancelFriendRequest(userId, viewedId);
    else await sendFriendRequest(userId, viewedId);
    document.dispatchEvent(new CustomEvent('kaidra:friends-changed'));
    await loadProfile(viewedId);
  } catch { showError('user-profile-error', 'Could not update this friendship. Try again.'); }
  finally { button.disabled = false; }
});
messageButton.addEventListener('click', () => { if (views.other.profile) document.dispatchEvent(new CustomEvent('kaidra:message-user', { detail: { profile: views.other.profile } })); });
document.getElementById('user-back-btn').addEventListener('click', () => backRoute('friends'));
document.getElementById('edit-tastes-btn').addEventListener('click', () => { location.href = '/onboarding.html?edit=1'; });
editButton.addEventListener('click', async () => {
  if (!viewedProfile) await loadProfile(userId);
  if (!viewedProfile || viewedProfile.id !== userId) return;
  const values = [viewedProfile.display_name, viewedProfile.status_text, viewedProfile.bio, viewedProfile.profile_template || 'midnight'];
  fields.forEach((field, index) => { document.getElementById(`edit-profile-${field}`).value = values[index] || ''; });
  document.getElementById('edit-profile-avatar-input').value = '';
  showError('edit-profile-error'); openModal('edit-profile-modal');
});
document.getElementById('edit-profile-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const save = document.getElementById('edit-profile-save-btn'); save.disabled = true;
  showError('edit-profile-error');
  try {
    const file = document.getElementById('edit-profile-avatar-input').files[0];
    let avatarUrl;
    if (file) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('Choose a JPG, PNG, or WebP image under 5 MB.');
      const path = `${userId}/${crypto.randomUUID()}.${file.type.split('/')[1]}`;
      const upload = await supabase.storage.from('avatars').upload(path, file);
      if (upload.error) throw upload.error;
      avatarUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
    }
    const values = fields.map((field) => document.getElementById(`edit-profile-${field}`).value.trim());
    const { error } = await supabase.from('profiles').update({
      display_name: values[0] || null, status_text: values[1] || null, bio: values[2] || null,
      profile_template: values[3] || 'midnight', ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
    }).eq('id', userId);
    if (error) throw error;
    closeModal('edit-profile-modal'); await loadProfile(userId);
    const current = await account; Object.assign(current.profile, viewedProfile);
    document.dispatchEvent(new CustomEvent('kaidra:profile-updated', { detail: viewedProfile })); notify('Profile updated.');
  } catch (error) { showError('edit-profile-error', error.message?.startsWith('Choose a JPG') ? error.message : 'Could not save your profile. Please try again.'); }
  finally { save.disabled = false; }
});
document.addEventListener('kaidra:route-change', async event => {
  const current = await account; if (!current) return; userId = current.userId;
  if (event.detail.view === 'user') loadProfile(event.detail.id);
  if (event.detail.view === 'profile') loadProfile(userId);
});
// Legacy integrations now request a destination rather than changing My Profile.
document.addEventListener('kaidra:view-profile', async event => { const current = await account; if (current) navigate(event.detail.userId && event.detail.userId !== current.userId ? `user/${event.detail.userId}` : 'profile'); });
document.addEventListener('kaidra:friends-changed', () => { loadProfile(userId); if (viewedId) loadProfile(viewedId); });
(async () => { const current = await account; if (!current) return; userId = current.userId; await loadProfile(userId); })();

let libraryTab = 'favorites';
async function renderLibrary(force = false) {
  const target = document.getElementById('profile-favorites');
  try {
    await libraryReady({force: force === true}); const items = libraryItems(libraryTab);
    document.getElementById('stat-favorites').textContent = libraryItems('favorites').length;
    target.replaceChildren(...items.map(mediaCard));
    if (!items.length) target.append(emptyState(libraryTab === 'favorites' ? 'Your favorites belong here' : 'Your next watch starts here', 'Save a title from its three-dot menu.', 'bookmark', { label: 'Explore Discover', run: () => navigate('discover') }));
  } catch { target.replaceChildren(emptyState('Library unavailable', 'Your saved titles are safe. Try again.', 'bookmark', { label: 'Try again', run: () => renderLibrary(true) })); }
}
document.querySelectorAll('[data-library-tab]').forEach(button => button.addEventListener('click', () => { libraryTab = button.dataset.libraryTab; document.querySelectorAll('[data-library-tab]').forEach(tab => { tab.classList.toggle('active', tab === button); tab.setAttribute('aria-selected', String(tab === button)); }); renderLibrary(); }));
document.addEventListener('kaidra:library-change', renderLibrary);
