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
const usernameEl = document.getElementById('profile-username');
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

  const badge = post.post_type === 'sotd' ? '🎵 SOTD' : post.post_type === 'text_only' ? '📝' : '❤️';
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
  if (usernameEl) usernameEl.textContent = '@' + (profile.username ?? 'unknown');
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
