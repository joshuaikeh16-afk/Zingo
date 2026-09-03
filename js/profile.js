// Real Profile logic. Defaults to the signed-in user's own profile;
// pass ?user=<uuid> in the URL to view someone else's (e.g. tapped from
// a conversation row or a friend's status -- not wired up elsewhere
// yet, but this page supports it already for when that's added).

import {
  supabase,
  requireAuth,
  requireProfile,
  getFriendCount,
  getTotalLikesForUser,
  getUserPosts,
  getCurrentlyWatching,
  getCompatibilityScore,
  getStreak,
  isMutualFriend,
  getFriendshipStatus,
  sendFriendRequest,
  cancelFriendRequest,
  removeFriend,
} from './supabase-client.js';

let currentUserId = null;
let profileUserId = null;
let isOwnProfile = true;

const avatarEl = document.getElementById('profile-avatar');
const displayNameEl = document.getElementById('profile-display-name');
const usernameEl = document.getElementById('profile-username');
const statusEl = document.getElementById('profile-status');
const bioEl = document.getElementById('profile-bio');
const streakBadgeEl = document.getElementById('streak-badge');
const currentlyWatchingEl = document.getElementById('currently-watching-badge');
const compatibilityEl = document.getElementById('compatibility-score');
const friendsStatEl = document.getElementById('stat-friends');
const likesStatEl = document.getElementById('stat-likes');
const friendActionBtn = document.getElementById('friend-action-btn');
const postsGrid = document.getElementById('profile-posts-grid');
const postsEmptyState = document.getElementById('profile-posts-empty-state');

function formatCount(n) {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

function buildPostTile(post) {
  const tile = document.createElement('div');
  tile.dataset.postId = post.id;

  const badge = post.post_type === 'aotd' ? '🎬 AOTD' : post.post_type === 'text_only' ? '📝' : '❤️';
  const mediaHtml = post.media_url
    ? `<img src="${post.media_url}" alt="Post" />`
    : `<div class="post-tile-text">${post.caption ?? ''}</div>`;

  tile.innerHTML = `${mediaHtml}<span>${badge}</span>`;
  return tile;
}

async function renderPosts() {
  if (!postsGrid) return;
  const posts = await getUserPosts(profileUserId);
  postsGrid.querySelectorAll('[data-post-id]').forEach((el) => el.remove());

  if (posts.length === 0) {
    postsEmptyState?.classList.remove('hidden');
    postsEmptyState?.classList.add('flex');
    postsGrid.classList.add('hidden');
  } else {
    postsEmptyState?.classList.add('hidden');
    postsEmptyState?.classList.remove('flex');
    postsGrid.classList.remove('hidden');
    posts.forEach((p) => postsGrid.appendChild(buildPostTile(p)));
  }
}

async function renderHeader() {
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', profileUserId).maybeSingle();
  if (!profile) return;

  if (avatarEl) avatarEl.src = profile.avatar_url || `https://placehold.co/200x200/1a1625/f2ede4?text=${(profile.username || '?')[0].toUpperCase()}`;
  if (displayNameEl) displayNameEl.textContent = profile.display_name || profile.username;
  if (usernameEl) usernameEl.textContent = '@' + (profile.username ?? 'unknown');
  if (statusEl) statusEl.textContent = profile.status_text || '';
  if (bioEl) bioEl.textContent = profile.bio || '';

  // Currently watching -- shown on any profile (own or other), since
  // it's just "what they're watching right now," not friend-gated
  const watching = await getCurrentlyWatching(profileUserId);
  if (currentlyWatchingEl) {
    if (watching) {
      currentlyWatchingEl.querySelector('span:last-child').textContent = `Watching: ${watching.title}`;
      currentlyWatchingEl.classList.remove('hidden');
    } else {
      currentlyWatchingEl.classList.add('hidden');
    }
  }

  // Stats
  const [friendCount, likes] = await Promise.all([
    getFriendCount(profileUserId),
    getTotalLikesForUser(profileUserId),
  ]);
  if (friendsStatEl) friendsStatEl.textContent = formatCount(friendCount);
  if (likesStatEl) likesStatEl.textContent = formatCount(likes);

  if (isOwnProfile) {
    // Compatibility score and streak don't apply to your own profile;
    // the friend-action button doesn't either.
    compatibilityEl?.classList.add('hidden');
    streakBadgeEl?.classList.add('hidden');
    friendActionBtn?.classList.add('hidden');
  } else {
    friendActionBtn?.classList.remove('hidden');
    const mutual = await isMutualFriend(currentUserId, profileUserId);

    if (mutual) {
      const [score, streak] = await Promise.all([
        getCompatibilityScore(currentUserId, profileUserId),
        getStreak(currentUserId, profileUserId),
      ]);
      if (compatibilityEl) {
        if (score !== null) {
          compatibilityEl.querySelector('span').textContent = `✨ ${score}% Taste Match`;
          compatibilityEl.classList.remove('hidden');
        } else {
          compatibilityEl.classList.add('hidden');
        }
      }
      if (streakBadgeEl) {
        if (streak > 0) {
          streakBadgeEl.textContent = `🔥 ${streak}`;
          streakBadgeEl.classList.remove('hidden');
        } else {
          streakBadgeEl.classList.add('hidden');
        }
      }
    } else {
      compatibilityEl?.classList.add('hidden');
      streakBadgeEl?.classList.add('hidden');
    }

    const status = await getFriendshipStatus(currentUserId, profileUserId);
    setFriendActionState(status);
  }
}

function setFriendActionState(status) {
  if (!friendActionBtn) return;
  friendActionBtn.dataset.state = status;
  const labels = { none: 'Add Friend', pending_sent: 'Requested', pending_received: 'Respond in Friends tab', friends: 'Friends' };
  friendActionBtn.textContent = labels[status] || 'Add Friend';
  friendActionBtn.disabled = status === 'pending_received';
  friendActionBtn.classList.toggle('is-active-state', status === 'none');
}

friendActionBtn?.addEventListener('click', async () => {
  const state = friendActionBtn.dataset.state;
  friendActionBtn.disabled = true;
  try {
    if (state === 'none') {
      await sendFriendRequest(currentUserId, profileUserId);
      setFriendActionState(await getFriendshipStatus(currentUserId, profileUserId));
    } else if (state === 'pending_sent') {
      await cancelFriendRequest(currentUserId, profileUserId);
      setFriendActionState('none');
    } else if (state === 'friends') {
      await removeFriend(currentUserId, profileUserId);
      setFriendActionState('none');
    }
    const friendCount = await getFriendCount(profileUserId);
    if (friendsStatEl) friendsStatEl.textContent = formatCount(friendCount);
  } finally {
    friendActionBtn.disabled = false;
  }
});

(async () => {
  const session = await requireAuth();
  if (!session) return;
  const profile = await requireProfile(session);
  if (!profile) return;

  currentUserId = session.user.id;
  const params = new URLSearchParams(window.location.search);
  profileUserId = params.get('user') || currentUserId;
  isOwnProfile = profileUserId === currentUserId;

  await renderHeader();
  await renderPosts();
})();

// ---------------------------------------------------------------------
// Edit Profile: avatar, display name, status, bio.
// ---------------------------------------------------------------------

const editProfileTrigger = document.querySelector('[data-action="edit-profile"]');
const editProfileModal = document.getElementById('edit-profile-modal');
const editProfileClose = document.getElementById('edit-profile-close-btn');
const editAvatarPreview = document.getElementById('edit-profile-avatar-preview');
const editAvatarInput = document.getElementById('edit-profile-avatar-input');
const editDisplayNameInput = document.getElementById('edit-profile-display-name');
const editStatusInput = document.getElementById('edit-profile-status');
const editBioInput = document.getElementById('edit-profile-bio');
const editSaveBtn = document.getElementById('edit-profile-save-btn');
const editErrorEl = document.getElementById('edit-profile-error');

let pendingAvatarFile = null;

function setEditError(message) {
  if (!editErrorEl) return;
  editErrorEl.textContent = message || '';
  editErrorEl.classList.toggle('hidden', !message);
}

editProfileTrigger?.addEventListener('click', async () => {
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', currentUserId).maybeSingle();
  if (!profile) return;

  pendingAvatarFile = null;
  if (editAvatarPreview) editAvatarPreview.src = profile.avatar_url || `https://placehold.co/200x200/1a1625/f2ede4?text=${(profile.username || '?')[0].toUpperCase()}`;
  if (editDisplayNameInput) editDisplayNameInput.value = profile.display_name || '';
  if (editStatusInput) editStatusInput.value = profile.status_text || '';
  if (editBioInput) editBioInput.value = profile.bio || '';
  setEditError(null);

  editProfileModal?.classList.remove('hidden');
});

editProfileClose?.addEventListener('click', () => {
  editProfileModal?.classList.add('hidden');
});

editAvatarInput?.addEventListener('change', () => {
  const file = editAvatarInput.files?.[0];
  if (!file) return;
  pendingAvatarFile = file;
  if (editAvatarPreview) editAvatarPreview.src = URL.createObjectURL(file);
});

editSaveBtn?.addEventListener('click', async () => {
  setEditError(null);
  editSaveBtn.disabled = true;

  try {
    let avatarUrl = null;
    if (pendingAvatarFile) {
      const path = `${currentUserId}/avatar.${pendingAvatarFile.name.split('.').pop()}`;
      const { error: uploadError } = await supabase.storage.from('avatars').upload(path, pendingAvatarFile, { upsert: true });
      if (uploadError) {
        setEditError('Avatar upload failed: ' + uploadError.message);
        editSaveBtn.disabled = false;
        return;
      }
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
      // Cache-bust: the path is deterministic (same user, same extension
      // reuploads to the same URL), so without this the browser/CDN just
      // keeps serving the old cached image even though the file changed.
      avatarUrl = urlData.publicUrl + '?v=' + Date.now();
    }

    const { error: updateError } = await supabase.from('profiles').update({
      display_name: editDisplayNameInput?.value.trim() || null,
      status_text: editStatusInput?.value.trim() || null,
      bio: editBioInput?.value.trim() || null,
      ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
    }).eq('id', currentUserId);

    if (updateError) {
      setEditError(updateError.message);
      editSaveBtn.disabled = false;
      return;
    }

    editProfileModal?.classList.add('hidden');
    await renderHeader();
  } catch (err) {
    setEditError('Something went wrong. Try again.');
    console.error(err);
  } finally {
    editSaveBtn.disabled = false;
  }
});
