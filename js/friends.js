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
  isFollowing,
  followUser,
  unfollowUser,
} from './supabase-client.js';

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
const statusTopBarName = statusModal?.querySelector('span.text-xs.font-bold.text-white');
const statusTopBarTime = statusModal?.querySelector('span.text-\\[10px\\].text-slate-400');
const statusTopBarAvatar = statusModal?.querySelector('img');

function formatRelativeTime(isoString) {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

function buildFriendAvatar({ friend, post, hasActiveSotd }) {
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
    ${hasActiveSotd ? '<span class="sotd-indicator absolute bottom-4 right-0 w-5 h-5 rounded-full bg-violet-600 border border-slate-900 text-[10px] text-white flex items-center justify-center shadow-md">🎵</span>' : ''}
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
      statusMediaEl.innerHTML = `<div class="w-full h-full flex items-center justify-center p-8 text-center text-lg font-semibold text-white bg-gradient-to-br from-violet-900 to-slate-900">${post.caption ?? ''}</div>`;
    } else {
      statusMediaEl.innerHTML = `
        <img src="${post.media_url}" alt="Status" class="w-full h-full object-cover" />
        ${post.caption ? `<div class="absolute bottom-4 left-4 right-4 p-3 bg-black/60 backdrop-blur-md rounded-2xl border border-white/10 text-xs text-white"><span>${post.caption}</span></div>` : ''}
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
    findFriendsResults.innerHTML = '<p class="text-xs text-slate-500 text-center py-6">Type at least 2 characters to search.</p>';
    return;
  }

  const results = await searchUsers(query, currentUserId);
  findFriendsResults.innerHTML = '';

  if (results.length === 0) {
    findFriendsResults.innerHTML = '<p class="text-xs text-slate-500 text-center py-6">No users found.</p>';
    return;
  }

  results.forEach((user) => findFriendsResults.appendChild(buildUserSearchRow(user)));
}

function buildUserSearchRow(user) {
  const row = document.createElement('div');
  row.className = 'flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/5';
  const name = user.display_name || user.username;
  const avatarUrl = user.avatar_url || `https://placehold.co/80x80/1a1625/f2ede4?text=${name[0].toUpperCase()}`;

  row.innerHTML = `
    <img src="${avatarUrl}" alt="${name}" class="w-11 h-11 rounded-full object-cover" />
    <div class="flex-1 min-w-0">
      <p class="text-sm font-semibold text-white truncate">${name}</p>
      <p class="text-xs text-slate-500 truncate">@${user.username}</p>
    </div>
    <button type="button" class="follow-toggle-btn text-xs font-semibold px-4 py-1.5 rounded-full bg-violet-600 text-white">Follow</button>
  `;

  const btn = row.querySelector('.follow-toggle-btn');

  isFollowing(currentUserId, user.id).then((already) => {
    setFollowBtnState(btn, already);
  });

  btn?.addEventListener('click', async () => {
    const currentlyFollowing = btn.textContent.trim() === 'Following';
    btn.disabled = true;
    try {
      if (currentlyFollowing) {
        await unfollowUser(currentUserId, user.id);
        setFollowBtnState(btn, false);
      } else {
        await followUser(currentUserId, user.id);
        setFollowBtnState(btn, true);
      }
    } finally {
      btn.disabled = false;
    }
  });

  return row;
}

function setFollowBtnState(btn, following) {
  if (!btn) return;
  btn.textContent = following ? 'Following' : 'Follow';
  btn.classList.toggle('bg-violet-600', !following);
  btn.classList.toggle('bg-slate-800', following);
  btn.classList.toggle('text-white', !following);
  btn.classList.toggle('text-slate-300', following);
}
