// Real Profile logic. Defaults to the signed-in user's own profile;
// pass ?user=<uuid> in the URL to view someone else's (e.g. tapped from
// a conversation row or a friend's status -- not wired up elsewhere
// yet, but this page supports it already for when that's added).

import {
  supabase,
  requireAuth,
  requireProfile,
  getFollowCounts,
  getTotalLikesForUser,
  getUserPosts,
  getCurrentlyWatching,
  getCompatibilityScore,
  getStreak,
  isMutualFriend,
  isFollowing,
  followUser,
  unfollowUser,
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
const followingStatEl = document.getElementById('stat-following');
const followersStatEl = document.getElementById('stat-followers');
const likesStatEl = document.getElementById('stat-likes');
const followBtn = document.getElementById('follow-btn');
const postsGrid = document.getElementById('profile-posts-grid');
const postsEmptyState = document.getElementById('profile-posts-empty-state');

function formatCount(n) {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

function buildPostTile(post) {
  const tile = document.createElement('div');
  tile.className = 'aspect-square bg-slate-900 rounded-xl overflow-hidden border border-slate-800 relative group cursor-pointer';
  tile.dataset.postId = post.id;

  const badge = post.post_type === 'sotd' ? '🎵 SOTD' : post.post_type === 'text_only' ? '📝' : '❤️';
  const mediaHtml = post.media_url
    ? `<img src="${post.media_url}" alt="Post" class="w-full h-full object-cover group-hover:scale-105 transition-transform" />`
    : `<div class="w-full h-full flex items-center justify-center p-3 text-center text-[11px] text-slate-300 bg-slate-800">${post.caption ?? ''}</div>`;

  tile.innerHTML = `${mediaHtml}<span class="absolute bottom-1 right-1 text-[9px] bg-black/60 px-1.5 py-0.5 rounded text-white">${badge}</span>`;
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
  const [{ following, followers }, likes] = await Promise.all([
    getFollowCounts(profileUserId),
    getTotalLikesForUser(profileUserId),
  ]);
  if (followingStatEl) followingStatEl.textContent = formatCount(following);
  if (followersStatEl) followersStatEl.textContent = formatCount(followers);
  if (likesStatEl) likesStatEl.textContent = formatCount(likes);

  if (isOwnProfile) {
    // Compatibility score and streak don't apply to your own profile;
    // follow button doesn't either.
    compatibilityEl?.classList.add('hidden');
    streakBadgeEl?.classList.add('hidden');
    followBtn?.classList.add('hidden');
  } else {
    followBtn?.classList.remove('hidden');
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

    const alreadyFollowing = await isFollowing(currentUserId, profileUserId);
    setFollowButtonState(alreadyFollowing);
  }
}

function setFollowButtonState(following) {
  if (!followBtn) return;
  followBtn.textContent = following ? 'Following' : 'Follow User';
  followBtn.classList.toggle('from-violet-600', !following);
  followBtn.classList.toggle('to-rose-500', !following);
  followBtn.classList.toggle('bg-slate-800', following);
  followBtn.classList.toggle('bg-gradient-to-r', !following);
}

followBtn?.addEventListener('click', async () => {
  const currentlyFollowing = followBtn.textContent.trim() === 'Following';
  followBtn.disabled = true;
  try {
    if (currentlyFollowing) {
      await unfollowUser(currentUserId, profileUserId);
      setFollowButtonState(false);
    } else {
      await followUser(currentUserId, profileUserId);
      setFollowButtonState(true);
    }
    const { following, followers } = await getFollowCounts(profileUserId);
    if (followingStatEl) followingStatEl.textContent = formatCount(following);
    if (followersStatEl) followersStatEl.textContent = formatCount(followers);
  } finally {
    followBtn.disabled = false;
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
