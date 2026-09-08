// Real Friends tab logic: renders mutual friends' active 24hr statuses,
// opens the status viewer with real media, handles private replies
// (delivered to Inbox, never a public comment) and quick-reacts.

import {
  requireAuth,
  requireProfile,
  getFriendsActiveStatuses,
  sendStatusReply,
  addStatusQuickReact,
  searchUsers,
  getFriendshipStatus,
  sendFriendRequest,
  cancelFriendRequest,
  respondToFriendRequest,
  removeFriend,
  getIncomingRequests,
  shareAnimeOfTheDay,
} from './supabase-client.js';
import { searchMAL } from './mal-client.js';

let currentUserId = null;
let openStatus = null; // { friend, post } currently shown in the viewer

const statusContainer = document.getElementById('friends-status-container');
const emptyState = document.getElementById('friends-empty-state');
const activeCountBadge = document.getElementById('friends-active-count');

const statusModal = document.getElementById('status-viewer-modal');
const statusMediaEl = statusModal?.querySelector('.status-media');
const replyInput = document.getElementById('status-reply-input');
const replySubmitBtn = document.getElementById('status-reply-submit-btn');
const quickReactBtn = document.getElementById('status-quick-react-btn');
const statusCloseBtn = document.getElementById('status-close-btn');
const statusTopBarName = statusModal?.querySelector('.status-viewer-name');
const statusTopBarTime = statusModal?.querySelector('.status-viewer-time');
const statusTopBarAvatar = statusModal?.querySelector('.status-viewer-user img');

function formatRelativeTime(isoString) {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

function buildFriendAvatar({ friend, post, hasActiveAotd }) {
  const name = friend.display_name || friend.username || 'Friend';
  const avatarUrl = friend.avatar_url || `https://placehold.co/120x120/1a1625/f2ede4?text=${name[0].toUpperCase()}`;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'friend-status-avatar relative flex-shrink-0 text-center cursor-pointer group';
  btn.dataset.userId = friend.id;

  btn.innerHTML = `
    <div class="w-14 h-14 rounded-full p-0.5 bg-gradient-to-tr from-violet-500 via-rose-500 to-amber-400 shadow-md">
      <img src="${avatarUrl}" alt="${name}" class="w-full h-full rounded-full object-cover" />
    </div>
    ${hasActiveAotd ? '<span class="sotd-indicator">🎬</span>' : ''}
    <span class="block text-[11px] font-medium text-slate-300 mt-1 truncate max-w-[60px]">${name}</span>
  `;

  btn.addEventListener('click', () => openStatusViewer(friend, post));
  return btn;
}

async function renderFriendsStatuses() {
  if (!statusContainer) return;
  const statuses = await getFriendsActiveStatuses(currentUserId);

  statusContainer.querySelectorAll('.friend-status-avatar').forEach((el) => el.remove());

  if (activeCountBadge) activeCountBadge.textContent = `${statuses.length} Active`;

  if (statuses.length === 0) {
    emptyState?.classList.remove('hidden');
    emptyState?.classList.add('flex');
    statusContainer.classList.add('hidden');
  } else {
    emptyState?.classList.add('hidden');
    emptyState?.classList.remove('flex');
    statusContainer.classList.remove('hidden');
    statuses.forEach((s) => statusContainer.appendChild(buildFriendAvatar(s)));
  }
}

function openStatusViewer(friend, post) {
  openStatus = { friend, post };
  if (!statusModal) return;

  const name = friend.display_name || friend.username || 'Friend';
  const avatarUrl = friend.avatar_url || `https://placehold.co/80x80/1a1625/f2ede4?text=${name[0].toUpperCase()}`;

  if (statusTopBarName) statusTopBarName.textContent = name;
  if (statusTopBarTime) statusTopBarTime.textContent = `• ${formatRelativeTime(post.created_at)}`;
  if (statusTopBarAvatar) statusTopBarAvatar.src = avatarUrl;

  if (statusMediaEl) {
    if (post.post_type === 'text_only' || !post.media_url) {
      statusMediaEl.innerHTML = `<div class="status-text-post">${post.caption ?? ''}</div>`;
    } else {
      statusMediaEl.innerHTML = `
        <img src="${post.media_url}" alt="Status" class="status-media-img" />
        ${post.caption ? `<div class="status-caption-overlay"><span>${post.caption}</span></div>` : ''}
      `;
    }
  }

  if (replyInput) {
    replyInput.value = '';
    replyInput.placeholder = `Reply privately to ${name}...`;
  }

  statusModal.classList.remove('hidden');
}

function closeStatusViewer() {
  statusModal?.classList.add('hidden');
  openStatus = null;
}

statusCloseBtn?.addEventListener('click', closeStatusViewer);

replySubmitBtn?.addEventListener('click', async () => {
  const text = replyInput?.value.trim();
  if (!text || !openStatus) return;

  replyInput.value = '';
  replySubmitBtn.disabled = true;
  try {
    await sendStatusReply({
      postId: openStatus.post.id,
      authorId: openStatus.friend.id,
      replierId: currentUserId,
      content: text,
    });
    closeStatusViewer();
  } catch (err) {
    console.error('Failed to send status reply:', err);
    replyInput.value = text;
  } finally {
    replySubmitBtn.disabled = false;
  }
});

replyInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') replySubmitBtn?.click();
});

quickReactBtn?.addEventListener('click', async () => {
  if (!openStatus) return;
  await addStatusQuickReact(openStatus.post.id, currentUserId, '🔥');
  quickReactBtn.classList.add('scale-125');
  setTimeout(() => quickReactBtn.classList.remove('scale-125'), 200);
});

(async () => {
  const session = await requireAuth();
  if (!session) return;
  const profile = await requireProfile(session);
  if (!profile) return;

  currentUserId = session.user.id;
  await renderFriendsStatuses();
  await renderIncomingRequests();
})();

// ---------------------------------------------------------------------
// Find Friends: search users by username, follow/unfollow inline.
// This is the actual discovery entry point -- without it, there was no
// way for two users to ever become mutual friends in the first place.
// ---------------------------------------------------------------------

const findFriendsBtn = document.getElementById('find-friends-btn');
const findFriendsModal = document.getElementById('find-friends-modal');
const findFriendsInput = document.getElementById('find-friends-input');
const findFriendsResults = document.getElementById('find-friends-results');
const findFriendsCloseBtn = document.getElementById('find-friends-close-btn');

let searchDebounceTimer = null;

findFriendsBtn?.addEventListener('click', () => {
  findFriendsModal?.classList.remove('hidden');
  findFriendsInput?.focus();
});

findFriendsCloseBtn?.addEventListener('click', () => {
  findFriendsModal?.classList.add('hidden');
  if (findFriendsInput) findFriendsInput.value = '';
  if (findFriendsResults) findFriendsResults.innerHTML = '';
});

findFriendsInput?.addEventListener('input', () => {
  clearTimeout(searchDebounceTimer);
  const query = findFriendsInput.value;
  searchDebounceTimer = setTimeout(() => runUserSearch(query), 350);
});

async function runUserSearch(query) {
  if (!findFriendsResults) return;
  if (!query || query.trim().length < 2) {
    findFriendsResults.innerHTML = '<p class="find-friends-hint">Type at least 2 characters to search.</p>';
    return;
  }

  const results = await searchUsers(query, currentUserId);
  findFriendsResults.innerHTML = '';

  if (results.length === 0) {
    findFriendsResults.innerHTML = '<p class="find-friends-hint">No users found.</p>';
    return;
  }

  results.forEach((user) => findFriendsResults.appendChild(buildUserSearchRow(user)));
}

function buildUserSearchRow(user) {
  const row = document.createElement('div');
  row.className = 'find-friend-result-row';
  const name = user.display_name || user.username;
  const avatarUrl = user.avatar_url || `https://placehold.co/80x80/1a1625/f2ede4?text=${name[0].toUpperCase()}`;

  row.innerHTML = `
    <img src="${avatarUrl}" alt="${name}" />
    <div class="find-friend-result-info">
      <p class="find-friend-result-name">${name}</p>
      <p class="find-friend-result-handle">@${user.username}</p>
    </div>
    <button type="button" class="friend-request-btn">Add Friend</button>
  `;

  const btn = row.querySelector('.friend-request-btn');

  getFriendshipStatus(currentUserId, user.id).then((status) => {
    setFriendBtnState(btn, status);
  });

  btn?.addEventListener('click', async () => {
    const state = btn.dataset.state;
    btn.disabled = true;
    try {
      if (state === 'none') {
        await sendFriendRequest(currentUserId, user.id);
        setFriendBtnState(btn, await getFriendshipStatus(currentUserId, user.id));
      } else if (state === 'pending_sent') {
        await cancelFriendRequest(currentUserId, user.id);
        setFriendBtnState(btn, 'none');
      } else if (state === 'friends') {
        await removeFriend(currentUserId, user.id);
        setFriendBtnState(btn, 'none');
      }
      // pending_received is handled from the incoming-requests bar, not here.
    } finally {
      btn.disabled = false;
    }
  });

  return row;
}

function setFriendBtnState(btn, status) {
  if (!btn) return;
  btn.dataset.state = status;

  const labels = {
    none: 'Add Friend',
    pending_sent: 'Requested',
    pending_received: 'Respond Below',
    friends: 'Friends',
  };
  btn.textContent = labels[status] || 'Add Friend';
  btn.disabled = status === 'pending_received';
  btn.classList.toggle('is-active-state', status === 'none');
}

// ---------------------------------------------------------------------
// Incoming Friend Requests — shown as a small bar above the statuses.
// ---------------------------------------------------------------------

const requestsBar = document.getElementById('friend-requests-bar');
const requestsList = document.getElementById('friend-requests-list');
const requestsCount = document.getElementById('friend-requests-count');

async function renderIncomingRequests() {
  if (!requestsBar || !requestsList) return;
  const requests = await getIncomingRequests(currentUserId);

  if (requests.length === 0) {
    requestsBar.classList.add('hidden');
    return;
  }

  requestsBar.classList.remove('hidden');
  if (requestsCount) requestsCount.textContent = String(requests.length);

  requestsList.innerHTML = '';
  requests.forEach((req) => {
    const person = req.requester;
    const name = person.display_name || person.username;
    const avatarUrl = person.avatar_url || `https://placehold.co/80x80/1a1625/f2ede4?text=${name[0].toUpperCase()}`;

    const row = document.createElement('div');
    row.className = 'friend-request-row';
    row.innerHTML = `
      <img src="${avatarUrl}" alt="${name}" />
      <div class="friend-request-info">
        <p class="friend-request-name">${name}</p>
        <p class="friend-request-handle">@${person.username}</p>
      </div>
      <button type="button" class="request-accept-btn" data-request-id="${req.id}">Accept</button>
      <button type="button" class="request-decline-btn" data-request-id="${req.id}">Decline</button>
    `;

    row.querySelector('.request-accept-btn').addEventListener('click', async () => {
      await respondToFriendRequest(req.id, true);
      await renderIncomingRequests();
    });
    row.querySelector('.request-decline-btn').addEventListener('click', async () => {
      await respondToFriendRequest(req.id, false);
      await renderIncomingRequests();
    });

    requestsList.appendChild(row);
  });
}

// ---------------------------------------------------------------------
// Share Anime of the Day: search MyAnimeList, pick one, optional note,
// share with every mutual friend at once.
// ---------------------------------------------------------------------

const shareAotdBtn = document.getElementById('share-aotd-btn');
const aotdShareModal = document.getElementById('aotd-share-modal');
const aotdShareInput = document.getElementById('aotd-share-search-input');
const aotdShareResults = document.getElementById('aotd-share-results');
const aotdShareCloseBtn = document.getElementById('aotd-share-close-btn');

let aotdShareDebounce = null;

shareAotdBtn?.addEventListener('click', () => {
  aotdShareModal?.classList.remove('hidden');
  aotdShareInput?.focus();
});

aotdShareCloseBtn?.addEventListener('click', () => {
  aotdShareModal?.classList.add('hidden');
  resetAotdShareModal();
});

aotdShareInput?.addEventListener('input', () => {
  clearTimeout(aotdShareDebounce);
  const term = aotdShareInput.value.trim();
  aotdShareDebounce = setTimeout(() => runAotdSearch(term), 350);
});

const aotdShareConfirmStep = document.getElementById('aotd-share-confirm-step');
const aotdShareConfirmCover = document.getElementById('aotd-share-confirm-cover');
const aotdShareConfirmTitle = document.getElementById('aotd-share-confirm-title');
const aotdShareNoteInput = document.getElementById('aotd-share-note-input');
const aotdShareBackBtn = document.getElementById('aotd-share-back-btn');
const aotdShareConfirmBtn = document.getElementById('aotd-share-confirm-btn');

let pendingAotdAnime = null;

async function runAotdSearch(term) {
  if (!aotdShareResults) return;
  if (term.length < 2) {
    aotdShareResults.innerHTML = '<p class="find-friends-hint">Type at least 2 characters to search.</p>';
    return;
  }

  try {
    const payload = await searchMAL(term, 'anime', 8);
    const media = (payload?.data ?? []).map((entry) => entry.node || entry);
    aotdShareResults.innerHTML = '';

    if (media.length === 0) {
      aotdShareResults.innerHTML = '<p class="find-friends-hint">No matches found.</p>';
      return;
    }

    media.forEach((anime) => {
      const title = anime.title || 'Unknown title';
      const row = document.createElement('div');
      row.className = 'find-friend-result-row';
      row.innerHTML = `
        <img src="${anime.main_picture?.medium || anime.main_picture?.large || ''}" alt="${title}" />
        <div class="find-friend-result-info">
          <p class="find-friend-result-name">${title}</p>
        </div>
        <button type="button" class="friend-request-btn is-active-state">Share</button>
      `;
      row.querySelector('button').addEventListener('click', () => showAotdConfirmStep(anime, title));
      aotdShareResults.appendChild(row);
    });
  } catch (err) {
    console.error('MyAnimeList search failed:', err);
    aotdShareResults.innerHTML = '<p class="find-friends-hint">Search failed — try again.</p>';
  }
}

function showAotdConfirmStep(anime, title) {
  pendingAotdAnime = { anime, title };
  if (aotdShareConfirmCover) aotdShareConfirmCover.src = anime.main_picture?.medium || anime.main_picture?.large || '';
  if (aotdShareConfirmTitle) aotdShareConfirmTitle.textContent = title;
  if (aotdShareNoteInput) aotdShareNoteInput.value = '';

  aotdShareResults?.classList.add('hidden');
  if (aotdShareInput) aotdShareInput.parentElement.classList.add('hidden');
  aotdShareConfirmStep?.classList.remove('hidden');
}

function resetAotdShareModal() {
  pendingAotdAnime = null;
  if (aotdShareInput) { aotdShareInput.value = ''; aotdShareInput.parentElement.classList.remove('hidden'); }
  if (aotdShareResults) { aotdShareResults.innerHTML = ''; aotdShareResults.classList.remove('hidden'); }
  aotdShareConfirmStep?.classList.add('hidden');
}

aotdShareBackBtn?.addEventListener('click', resetAotdShareModal);

aotdShareConfirmBtn?.addEventListener('click', async () => {
  if (!pendingAotdAnime) return;
  const { anime, title } = pendingAotdAnime;
  const note = aotdShareNoteInput?.value.trim() || '';

  aotdShareConfirmBtn.disabled = true;
  try {
    await shareAnimeOfTheDay(currentUserId, {
      animeId: anime.id,
      animeTitle: title,
      coverImageUrl: anime.main_picture?.medium || anime.main_picture?.large || '',
      note,
    });
    aotdShareModal?.classList.add('hidden');
    resetAotdShareModal();
    await renderFriendsStatuses();
  } catch (err) {
    console.error('Failed to share Anime of the Day:', err);
    if (aotdShareConfirmTitle) aotdShareConfirmTitle.textContent = (err.message || 'Failed to share.') + ' — try again';
  } finally {
    aotdShareConfirmBtn.disabled = false;
  }
});
