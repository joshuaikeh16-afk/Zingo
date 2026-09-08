// Real Profile logic. Defaults to the signed-in user's own profile;
// pass ?user=<uuid> in the URL to view someone else's (e.g. tapped from
// a conversation row or a friend's status -- not wired up elsewhere
// yet, but this page supports it already for when that's added).

import {
  supabase,
  requireAuth,
  requireProfile,
  getFollowCounts,
  getUserWatchlist,
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
const animeVibeEl = document.getElementById('profile-anime-vibe');
const interestChipsEl = document.getElementById('profile-interest-chips');
const streakBadgeEl = document.getElementById('streak-badge');
const currentlyWatchingEl = document.getElementById('currently-watching-badge');
const compatibilityEl = document.getElementById('compatibility-score');
const followersStatEl = document.getElementById('stat-followers');
const followingStatEl = document.getElementById('stat-following');
const likesStatEl = document.getElementById('stat-likes');
const profileSectionTitle = document.getElementById('profile-section-title');
const friendActionBtn = document.getElementById('friend-action-btn');
const postsGrid = document.getElementById('profile-posts-grid');
const postsEmptyState = document.getElementById('profile-posts-empty-state');

let activeProfileStatus = 'watching';

function formatCount(n) {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

function buildAnimeTile(entry) {
  const tile = document.createElement('div');
  tile.dataset.animeId = entry.animeId;
  const status = String(entry.status || 'plan_to_watch').replaceAll('_', ' ');
  const progress = entry.totalEpisodes ? `${entry.progress || 0}/${entry.totalEpisodes}` : status;
  tile.innerHTML = entry.coverUrl
    ? `<img src="${entry.coverUrl}" alt="${entry.title}" loading="lazy" /><div class="anime-tile-caption"><strong>${entry.title}</strong><span>${progress}</span></div>`
    : `<div class="anime-tile-placeholder"><strong>${entry.title}</strong><span>${progress}</span></div>`;
  return tile;
}

async function renderPosts() {
  if (!postsGrid) return;
  const entries = (await getUserWatchlist(profileUserId).catch(() => []))
    .filter((entry) => entry.status === activeProfileStatus);
  postsGrid.querySelectorAll('[data-anime-id]').forEach((el) => el.remove());

  if (entries.length === 0) {
    postsEmptyState?.classList.remove('hidden');
    postsEmptyState?.classList.add('flex');
    postsGrid.classList.add('hidden');
    if (postsEmptyState) postsEmptyState.querySelector('h4').textContent = 'No anime added yet';
    if (postsEmptyState) postsEmptyState.querySelector('p').textContent = 'Add anime or manga to your list and your activity will appear here.';
  } else {
    postsEmptyState?.classList.add('hidden');
    postsEmptyState?.classList.remove('flex');
    postsGrid.classList.remove('hidden');
    const tiles = entries.map(buildAnimeTile);
    tiles.forEach((tile) => postsGrid.appendChild(tile));
  }
}

document.querySelectorAll('[data-profile-status]').forEach((button) => button.addEventListener('click', async () => {
  activeProfileStatus = button.dataset.profileStatus;
  document.querySelectorAll('[data-profile-status]').forEach((item) => item.classList.toggle('active', item === button));
  await renderPosts();
}));
document.addEventListener('kaidra:watchlist-change', async (event) => {
  if (event.detail?.status) {
    activeProfileStatus = event.detail.status;
    document.querySelectorAll('[data-profile-status]').forEach((item) => item.classList.toggle('active', item.dataset.profileStatus === activeProfileStatus));
  }
  await renderPosts();
});

async function renderHeader() {
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', profileUserId).maybeSingle();
  if (!profile) return;

  if (avatarEl) avatarEl.src = profile.avatar_url || `https://placehold.co/200x200/1a1625/f2ede4?text=${(profile.username || '?')[0].toUpperCase()}`;
  if (displayNameEl) displayNameEl.textContent = profile.display_name || profile.username;
  if (usernameEl) usernameEl.textContent = '@' + (profile.username ?? 'unknown');
  if (statusEl) statusEl.textContent = profile.status_text || '';
  if (bioEl) bioEl.textContent = profile.bio || '';
  if (animeVibeEl) animeVibeEl.textContent = profile.status_text || 'Anime fan · building a list';
  if (interestChipsEl) {
    const interests = Array.isArray(profile.interests) ? profile.interests : [];
    interestChipsEl.innerHTML = interests.length
      ? interests.slice(0, 6).map((interest) => `<span>${String(interest).replaceAll('_', ' ')}</span>`).join('')
      : '<span>Anime</span><span>Manga</span><span>Community</span>';
  }
  const template = profile.profile_template || 'midnight';
  const profileContainer = document.querySelector('.profile-container');
  const heroCard = document.querySelector('.profile-hero-card');
  const templateClasses = ['midnight', 'sakura', 'ocean', 'sunset', 'monochrome', 'cyberpunk', 'forest', 'starlight'];
  profileContainer?.classList.remove(...templateClasses.map((name) => `profile-template-${name}`));
  heroCard?.classList.remove(...templateClasses.map((name) => `profile-template-${name}`));
  profileContainer?.classList.add(`profile-template-${template}`);
  heroCard?.classList.add(`profile-template-${template}`);

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
  const [watchlist, followCounts] = await Promise.all([
    getUserWatchlist(profileUserId).catch(() => []),
    getFollowCounts(profileUserId).catch(() => ({ followers: 0, following: 0 })),
  ]);
  if (followersStatEl) followersStatEl.textContent = formatCount(followCounts.followers);
  if (followingStatEl) followingStatEl.textContent = formatCount(followCounts.following);
  if (likesStatEl) likesStatEl.textContent = formatCount(watchlist.length);

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
const editInterestsInput = document.getElementById('edit-profile-interests');
const editTemplateInput = document.getElementById('edit-profile-template');
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
  if (editInterestsInput) editInterestsInput.value = Array.isArray(profile.interests) ? profile.interests.join(', ') : '';
  if (editTemplateInput) editTemplateInput.value = profile.profile_template || 'midnight';
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
      interests: (editInterestsInput?.value || '').split(',').map((item) => item.trim().toLowerCase().replace(/\s+/g, '_')).filter(Boolean).slice(0, 12),
      profile_template: editTemplateInput?.value || 'midnight',
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
