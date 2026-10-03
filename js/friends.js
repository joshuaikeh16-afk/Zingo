import { supabase, getMutualFriends, getIncomingRequests, searchUsers, getFriendshipStatus, sendFriendRequest, cancelFriendRequest, respondToFriendRequest } from './supabase-client.js';
import { account } from './session.js';
import { element, avatar, viewProfile, openModal, closeModal, showError, notify, actionButton, skeletons } from './ui.js';

let userId, refreshVersion = 0, searchVersion = 0, searchTimer;
let allFriends = [], friendFilter = 'all', requestCount = 0;
const list = document.getElementById('friends-list');
const results = document.getElementById('find-friends-results');
export function personRow(profile) {
  const row = element('div', 'person-row');
  const identity = element('button', 'person-identity');
  identity.type = 'button';
  const copy = element('span', 'person-copy');
  copy.append(element('strong', '', profile.display_name || profile.username), element('small', '', `@${profile.username}`));
  identity.append(avatar(profile), copy);
  identity.addEventListener('click', () => { closeModal('find-friends-modal'); viewProfile(profile.id); });
  row.append(identity);
  return row;
}
function renderFriends() {
  const query = document.getElementById('friends-search').value.toLowerCase().trim();
  const shown = allFriends.filter(profile => `${profile.display_name} ${profile.username}`.toLowerCase().includes(query));
  list.replaceChildren(...shown.map(profile => {
    const card = personRow(profile); card.className = 'friend-card';
    const chips = element('div', 'friend-interest-chips');
    for (const interest of (profile.interests || []).slice(0, 4)) chips.append(element('span', '', interest.replaceAll('_', ' ')));
    if (chips.childElementCount) card.append(chips);
    const actions = element('div', 'friend-card-actions'), message = actionButton('Message', 'chat'), view = actionButton('View profile', 'arrow', 'text-button');
    message.addEventListener('click', () => document.dispatchEvent(new CustomEvent('kaidra:message-user', { detail: { profile } })));
    view.addEventListener('click', () => viewProfile(profile.id)); actions.append(message, view); card.append(actions); return card;
  }));
  document.getElementById('friends-empty-state').classList.toggle('hidden', allFriends.length > 0);
  if (!shown.length && allFriends.length) list.append(element('p', 'feed-notice', 'No friends matched. Try another name.'));
  list.setAttribute('aria-busy', 'false'); applyFilter();
}
document.getElementById('friends-search').addEventListener('input', renderFriends);
async function refresh() {
  if (!userId) return;
  const version = ++refreshVersion;
  try {
    const [friends, requests] = await Promise.all([getMutualFriends(userId), getIncomingRequests(userId)]);
    if (version !== refreshVersion) return;
    showError('friends-error');
    allFriends = friends; renderFriends();
    document.getElementById('friends-total').textContent = friends.length;
    for (const id of ['sidebar-requests-count', 'nav-requests-count']) { const badge = document.getElementById(id); if (badge) { badge.textContent = requests.length; badge.classList.toggle('hidden', !requests.length); } }
    document.dispatchEvent(new CustomEvent('kaidra:friends-data', { detail: { friends, requests } }));
    requestCount = requests.length;
    document.getElementById('requests-filter-count').textContent = requests.length;
    applyFilter();
    document.getElementById('friend-requests-count').textContent = requests.length;
    const requestList = document.getElementById('friend-requests-list');
    requestList.replaceChildren();
    for (const request of requests) {
      const row = personRow(request.requester);
      for (const [label, accept] of [['Accept', true], ['Decline', false]]) {
        const button = element('button', accept ? 'primary-button' : 'quiet-button', label);
        button.type = 'button';
        button.addEventListener('click', async () => {
          row.querySelectorAll('button').forEach((node) => { node.disabled = true; });
          try {
            await respondToFriendRequest(request.id, accept);
            document.dispatchEvent(new CustomEvent('kaidra:friends-changed'));
          } catch { notify('Could not update this request. Try again.'); }
          finally { row.querySelectorAll('button').forEach((node) => { node.disabled = false; }); }
        });
        row.append(button);
      }
      requestList.append(row);
    }
    applyFilter();
  } catch { list.setAttribute('aria-busy', 'false'); showError('friends-error', 'Could not load your friends. Reopen this tab to try again.'); }
}
const input = document.getElementById('find-friends-input');
document.getElementById('find-friends-btn').addEventListener('click', () => openModal('find-friends-modal'));
document.getElementById('find-friends-close-btn').addEventListener('click', () => closeModal('find-friends-modal'));
input.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const version = ++searchVersion, query = input.value.trim();
  results.replaceChildren(element('p', 'muted', query.length < 2 ? 'Type at least 2 characters.' : 'Searching…'));
  if (query.length < 2 || !userId) return;
  searchTimer = setTimeout(async () => {
    try {
      const people = await searchUsers(query, userId);
      const states = await Promise.all(people.map((person) => getFriendshipStatus(userId, person.id)));
      if (version !== searchVersion) return;
      results.replaceChildren();
      if (!people.length) results.append(element('p', 'muted', 'No people found. Try another username.'));
      people.forEach((person, index) => {
        const row = personRow(person), button = element('button', 'quiet-button');
        button.type = 'button';
        let state = states[index];
        const update = () => { button.textContent = ({ none: 'Add friend', pending_sent: 'Cancel request', pending_received: 'Accept request', friends: 'Friends' })[state]; button.disabled = state === 'friends'; };
        update();
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            if (state === 'pending_sent') await cancelFriendRequest(userId, person.id);
            else await sendFriendRequest(userId, person.id);
            state = await getFriendshipStatus(userId, person.id);
            if (state !== 'pending_received') row.querySelector('.request-decline')?.remove();
            document.dispatchEvent(new CustomEvent('kaidra:friends-changed'));
          } catch { notify('Could not update this request. Try again.'); }
          finally { update(); }
        });
        row.append(button);
        if (state === 'pending_received') {
          const decline = element('button', 'quiet-button request-decline', 'Decline'); decline.type = 'button';
          decline.addEventListener('click', async () => { decline.disabled = true; try { const incoming = await getIncomingRequests(userId), request = incoming.find(item => item.requester.id === person.id); if (!request) throw new Error('Request expired'); await respondToFriendRequest(request.id, false); state = 'none'; decline.remove(); update(); document.dispatchEvent(new CustomEvent('kaidra:friends-changed')); } catch { notify('Could not decline this request. Try again.'); decline.disabled = false; } }); row.append(decline);
        }
        results.append(row);
      });
    } catch { if (version === searchVersion) results.replaceChildren(element('p', 'form-error', 'Search is unavailable. Try again.')); }
  }, 300);
});
document.addEventListener('kaidra:friends-changed', refresh);
document.addEventListener('kaidra:tab-change', (event) => { if (event.detail.tab === 'friends') refresh(); });
let channel;
(async () => {
  const current = await account;
  if (!current) return;
  userId = current.userId;
  skeletons(list, 'person', 3);
  await refresh();
  channel = supabase.channel(`friends:${userId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'friend_requests' }, refresh).subscribe();
})();
window.addEventListener('pagehide', () => { if (channel) supabase.removeChannel(channel); channel = null; });
window.addEventListener('pageshow', event => { if (event.persisted && userId) { refresh(); channel = supabase.channel(`friends:${userId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'friend_requests' }, refresh).subscribe(); } });

function applyFilter() {
  const requestsOnly = friendFilter === 'requests';
  document.getElementById('friend-requests-bar').classList.toggle('hidden', !requestsOnly);
  document.getElementById('friends-list-toolbar').classList.toggle('hidden', requestsOnly);
  list.classList.toggle('hidden', requestsOnly);
  document.getElementById('friends-empty-state').classList.toggle('hidden', requestsOnly || !!allFriends.length);
  document.getElementById('requests-empty-state')?.remove();
  if (requestsOnly && !requestCount) { const empty = element('p', 'rail-empty', 'No pending requests'); empty.id = 'requests-empty-state'; document.getElementById('friend-requests-list').append(empty); }
}
document.querySelectorAll('[data-friends-filter]').forEach(button => button.addEventListener('click', () => { friendFilter = button.dataset.friendsFilter; document.querySelectorAll('[data-friends-filter]').forEach(node => { node.classList.toggle('active', node === button); node.setAttribute('aria-pressed', String(node === button)); }); applyFilter(); }));
