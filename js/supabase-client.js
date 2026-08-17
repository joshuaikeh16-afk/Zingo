// Single Supabase client instance, shared across every page.
// Every other JS file should import `supabase` from here — never
// initialize a second client elsewhere.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://skmlktywdmsbjyybtmhm.supabase.co';
// Publishable/anon key — safe to ship client-side. RLS gates everything
// this key can touch. Never put the service_role key here or anywhere
// in this repo.
const SUPABASE_ANON_KEY = 'sb_publishable_IuCAP_wwm-rCBjCiunZUNQ_kOqmBeKC';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Redirects to the sign-in page if there's no active session.
 * Call this at the top of any page that requires auth (everything
 * except index.html / auth.html).
 */
export async function requireAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = '/auth.html';
    return null;
  }
  return session;
}

/**
 * Redirects to onboarding if the signed-in user has no profile row yet.
 * Call this after requireAuth() on any page inside the main app shell.
 */
export async function requireProfile(session) {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .maybeSingle();

  if (error) {
    console.error('Failed to load profile:', error);
    return null;
  }
  if (!profile) {
    window.location.href = '/onboarding.html';
    return null;
  }
  return profile;
}

// ---------------------------------------------------------------------
// Conversations & messages (Inbox)
// ---------------------------------------------------------------------

/**
 * Returns the current user's conversations enriched with the other
 * participant's profile, last message preview, unread count, streak,
 * and active-SOTD indicator -- everything the conversation-row markup
 * in app.html needs. Sorted most-recent-first.
 */
export async function getConversationsWithDetails(userId) {
  const { data: participantRows, error: pErr } = await supabase
    .from('conversation_participants')
    .select('conversation_id')
    .eq('user_id', userId);

  if (pErr || !participantRows?.length) return [];

  const conversationIds = participantRows.map((r) => r.conversation_id);

  const results = await Promise.all(
    conversationIds.map(async (conversationId) => {
      const { data: otherParticipant } = await supabase
        .from('conversation_participants')
        .select('user_id')
        .eq('conversation_id', conversationId)
        .neq('user_id', userId)
        .maybeSingle();

      if (!otherParticipant) return null;
      const otherUserId = otherParticipant.user_id;

      const [{ data: profile }, { data: lastMessage }, { count: unreadCount }, streak, activeSotd] =
        await Promise.all([
          supabase.from('profiles').select('id, username, display_name, avatar_url').eq('id', otherUserId).maybeSingle(),
          supabase.from('messages').select('content, message_type, created_at').eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
          supabase.from('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', conversationId).neq('sender_id', userId).is('read_at', null),
          getStreak(userId, otherUserId),
          hasActiveSotdFrom(otherUserId, userId),
        ]);

      return {
        conversationId,
        otherUserId,
        profile,
        lastMessage,
        unreadCount: unreadCount ?? 0,
        streak,
        hasActiveSotd: activeSotd,
      };
    })
  );

  return results
    .filter(Boolean)
    .sort((a, b) => {
      const aTime = a.lastMessage?.created_at ?? 0;
      const bTime = b.lastMessage?.created_at ?? 0;
      return new Date(bTime) - new Date(aTime);
    });
}

export async function getStreak(userA, userB) {
  const [a, b] = userA < userB ? [userA, userB] : [userB, userA];
  const { data } = await supabase
    .from('friend_streaks')
    .select('current_streak')
    .eq('user_a_id', a)
    .eq('user_b_id', b)
    .maybeSingle();
  return data?.current_streak ?? 0;
}

async function hasActiveSotdFrom(senderId, recipientId) {
  const { data } = await supabase
    .from('sotd_recipients')
    .select('sotd_id, sotd_posts!inner(sender_id, expires_at)')
    .eq('recipient_id', recipientId)
    .eq('sotd_posts.sender_id', senderId)
    .gt('sotd_posts.expires_at', new Date().toISOString())
    .limit(1);
  return (data?.length ?? 0) > 0;
}

export { hasActiveSotdFrom };

/** All users who are mutual friends (both follow each other) with `userId`. */
export async function getMutualFriends(userId) {
  const { data: followingRows } = await supabase
    .from('follows')
    .select('followed_id')
    .eq('follower_id', userId);

  const followingIds = (followingRows ?? []).map((r) => r.followed_id);
  if (followingIds.length === 0) return [];

  const { data: followBackRows } = await supabase
    .from('follows')
    .select('follower_id')
    .eq('followed_id', userId)
    .in('follower_id', followingIds);

  const mutualIds = (followBackRows ?? []).map((r) => r.follower_id);
  if (mutualIds.length === 0) return [];

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url')
    .in('id', mutualIds);

  return profiles ?? [];
}

/** Each mutual friend's most recent unexpired post, plus their SOTD-indicator state. Skips friends with no active post. */
export async function getFriendsActiveStatuses(userId) {
  const friends = await getMutualFriends(userId);
  if (friends.length === 0) return [];

  const results = await Promise.all(
    friends.map(async (friend) => {
      const { data: latestPost } = await supabase
        .from('posts')
        .select('*')
        .eq('user_id', friend.id)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!latestPost) return null;

      const hasSotd = await hasActiveSotdFrom(friend.id, userId);
      return { friend, post: latestPost, hasActiveSotd: hasSotd };
    })
  );

  return results.filter(Boolean);
}

/** Sends a private reply to a status -- delivered as a message in that friend's Inbox, not a public comment. */
export async function sendStatusReply({ postId, authorId, replierId, content }) {
  const conversationId = await getOrCreateConversation(authorId);
  await sendMessage({
    conversationId,
    senderId: replierId,
    content,
    messageType: 'status_reply',
  });
  await recordFriendInteraction(authorId);
  return conversationId;
}

export async function addStatusQuickReact(postId, userId, emoji = '🔥') {
  await supabase
    .from('status_reactions')
    .upsert({ post_id: postId, user_id: userId, emoji }, { onConflict: 'post_id,user_id' });
}

/** Full track details for the active SOTD from `senderId` to `recipientId`, for populating the listen modal. Null if none active. */
export async function getActiveSotdDetails(senderId, recipientId) {
  const { data } = await supabase
    .from('sotd_recipients')
    .select('sotd_id, viewed_at, sotd_posts!inner(id, sender_id, spotify_track_id, track_name, artist_name, album_art_url, created_at, expires_at)')
    .eq('recipient_id', recipientId)
    .eq('sotd_posts.sender_id', senderId)
    .gt('sotd_posts.expires_at', new Date().toISOString())
    .order('sotd_posts(created_at)', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.sotd_posts ?? null;
}

export async function markSotdViewed(sotdId, recipientId) {
  await supabase
    .from('sotd_recipients')
    .update({ viewed_at: new Date().toISOString() })
    .eq('sotd_id', sotdId)
    .eq('recipient_id', recipientId);
}

/** Uses the existing get_or_create_conversation RPC -- don't reimplement find-or-create client-side. */
export async function getOrCreateConversation(otherUserId) {
  const { data, error } = await supabase.rpc('get_or_create_conversation', {
    other_user_id: otherUserId,
  });
  if (error) throw error;
  return data;
}

export async function getMessages(conversationId) {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

/**
 * Subscribes to realtime inserts on a conversation's messages.
 * Returns the channel so the caller can unsubscribe when the thread closes.
 */
export function subscribeToMessages(conversationId, onNewMessage) {
  const channel = supabase
    .channel(`messages:${conversationId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
      (payload) => onNewMessage(payload.new)
    )
    .subscribe();
  return channel;
}

export async function sendMessage({ conversationId, senderId, content, messageType = 'text', externalRefId = null }) {
  const { error } = await supabase.from('messages').insert({
    conversation_id: conversationId,
    sender_id: senderId,
    content,
    message_type: messageType,
    ...(externalRefId ? { external_ref_id: externalRefId } : {}),
  });
  if (error) throw error;
}

export async function markConversationRead(conversationId, userId) {
  await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .neq('sender_id', userId)
    .is('read_at', null);
}

/** Call after a successful text/voice/image send -- not stickers/reactions. */
export async function recordFriendInteraction(otherUserId) {
  await supabase.rpc('record_friend_interaction', { other_user_id: otherUserId });
}

// ---------------------------------------------------------------------
// YouTube (Home feed) -- via the youtube-feed Edge Function, so the
// API key never ships in this app.
// ---------------------------------------------------------------------

export async function searchYoutubeVideos({ query = 'anime amv', maxResults = 10, pageToken } = {}) {
  const { data, error } = await supabase.functions.invoke('youtube-feed', {
    body: { query, maxResults, ...(pageToken ? { pageToken } : {}) },
  });
  if (error) throw error;
  return data; // { videos: [...], nextPageToken }
}

export async function fetchNewsFeed() {
  const { data, error } = await supabase.functions.invoke('news-feed', { body: {} });
  if (error) throw error;
  return data.articles ?? [];
}

export async function toggleVideoLike(userId, videoId) {
  const { data: existing } = await supabase
    .from('video_likes')
    .select('id')
    .eq('user_id', userId)
    .eq('video_id', videoId)
    .maybeSingle();

  if (existing) {
    await supabase.from('video_likes').delete().eq('id', existing.id);
    return false; // now unliked
  }
  await supabase.from('video_likes').insert({ user_id: userId, video_id: videoId });
  return true; // now liked
}

export async function isVideoLiked(userId, videoId) {
  const { data } = await supabase
    .from('video_likes')
    .select('id')
    .eq('user_id', userId)
    .eq('video_id', videoId)
    .maybeSingle();
  return !!data;
}

export async function toggleVideoBookmark(userId, videoId) {
  const { data: existing } = await supabase
    .from('user_bookmarks')
    .select('id')
    .eq('user_id', userId)
    .eq('article_id', videoId)
    .maybeSingle();

  if (existing) {
    await supabase.from('user_bookmarks').delete().eq('id', existing.id);
    return false;
  }
  await supabase.from('user_bookmarks').insert({ user_id: userId, article_id: videoId });
  return true;
}

export async function isVideoBookmarked(userId, videoId) {
  const { data } = await supabase
    .from('user_bookmarks')
    .select('id')
    .eq('user_id', userId)
    .eq('article_id', videoId)
    .maybeSingle();
  return !!data;
}

export async function getVideoLikeCount(videoId) {
  const { count } = await supabase
    .from('video_likes')
    .select('id', { count: 'exact', head: true })
    .eq('video_id', videoId);
  return count ?? 0;
}

// ---------------------------------------------------------------------
// Follows & profile stats
// ---------------------------------------------------------------------

export async function isMutualFriend(userA, userB) {
  const { data, error } = await supabase.rpc('is_mutual_friend', { user_a: userA, user_b: userB });
  if (error) return false;
  return !!data;
}

/** Searches profiles by username (case-insensitive partial match), excluding the current user. */
export async function searchUsers(query, currentUserId) {
  if (!query || query.trim().length < 2) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url')
    .ilike('username', `%${query.trim()}%`)
    .neq('id', currentUserId)
    .limit(20);
  if (error) return [];
  return data ?? [];
}

export async function isFollowing(followerId, followedId) {
  const { data } = await supabase
    .from('follows')
    .select('follower_id')
    .eq('follower_id', followerId)
    .eq('followed_id', followedId)
    .maybeSingle();
  return !!data;
}

export async function followUser(followerId, followedId) {
  await supabase.from('follows').insert({ follower_id: followerId, followed_id: followedId });
}

export async function unfollowUser(followerId, followedId) {
  await supabase.from('follows').delete().eq('follower_id', followerId).eq('followed_id', followedId);
}

export async function getFollowCounts(userId) {
  const [{ count: following }, { count: followers }] = await Promise.all([
    supabase.from('follows').select('follower_id', { count: 'exact', head: true }).eq('follower_id', userId),
    supabase.from('follows').select('followed_id', { count: 'exact', head: true }).eq('followed_id', userId),
  ]);
  return { following: following ?? 0, followers: followers ?? 0 };
}

export async function getTotalLikesForUser(userId) {
  const { data: posts } = await supabase.from('posts').select('id').eq('user_id', userId);
  const postIds = (posts ?? []).map((p) => p.id);
  if (postIds.length === 0) return 0;
  const { count } = await supabase
    .from('post_likes')
    .select('post_id', { count: 'exact', head: true })
    .in('post_id', postIds);
  return count ?? 0;
}

export async function getUserPosts(userId) {
  const { data } = await supabase
    .from('posts')
    .select('*')
    .eq('user_id', userId)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  return data ?? [];
}

/**
 * Real user-posted videos from mutual friends (Videos sub-tab is no
 * longer YouTube-sourced -- this replaces that entirely). Same
 * visibility rule as everything else in `posts`: mutual friends only,
 * unexpired (24h). Includes the author's profile so cards can show a
 * real avatar/username instead of a generic channel name.
 */
export async function getFriendsVideoPosts(userId) {
  const friends = await getMutualFriends(userId);
  const friendIds = friends.map((f) => f.id);
  // Include the current user's own video posts too, not just friends'.
  const authorIds = [...friendIds, userId];
  if (authorIds.length === 0) return [];

  const { data } = await supabase
    .from('posts')
    .select('*, profiles!posts_user_id_fkey(id, username, display_name, avatar_url)')
    .eq('post_type', 'video')
    .in('user_id', authorIds)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });

  return data ?? [];
}

// ---------------------------------------------------------------------
// Comments -- only relevant now that Videos means real user-posted
// content with an actual author, not YouTube-sourced videos.
// ---------------------------------------------------------------------

export async function getComments(postId) {
  const { data } = await supabase
    .from('post_comments')
    .select('*, profiles!post_comments_user_id_fkey(username, display_name, avatar_url)')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });
  return data ?? [];
}

export async function addComment(postId, userId, content) {
  const { error } = await supabase.from('post_comments').insert({
    post_id: postId,
    user_id: userId,
    content,
  });
  if (error) throw error;
}

export async function getCommentCount(postId) {
  const { count } = await supabase
    .from('post_comments')
    .select('id', { count: 'exact', head: true })
    .eq('post_id', postId);
  return count ?? 0;
}

// ---------------------------------------------------------------------
// Watchlist -- currently-watching badge + compatibility score
// ---------------------------------------------------------------------

const ANILIST_ENDPOINT = 'https://graphql.anilist.co';

async function fetchAnimeTitle(anilistId) {
  try {
    const res = await fetch(ANILIST_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query ($id: Int) { Media(id: $id) { title { userPreferred } } }`,
        variables: { id: anilistId },
      }),
    });
    const json = await res.json();
    return json?.data?.Media?.title?.userPreferred ?? null;
  } catch {
    return null;
  }
}

/** Most recently added 'watching' entry, with a real title from AniList. Null if none. */
export async function getCurrentlyWatching(userId) {
  const { data } = await supabase
    .from('user_watchlist')
    .select('anime_id, updated_at')
    .eq('user_id', userId)
    .eq('status', 'watching')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  const title = await fetchAnimeTitle(data.anime_id);
  return title ? { animeId: data.anime_id, title } : null;
}

/**
 * Jaccard similarity between two users' watching+completed anime lists.
 * Returns an integer percentage, or null if either list is empty.
 */
export async function getCompatibilityScore(userA, userB) {
  const [{ data: listA }, { data: listB }] = await Promise.all([
    supabase.from('user_watchlist').select('anime_id').eq('user_id', userA).in('status', ['watching', 'completed']),
    supabase.from('user_watchlist').select('anime_id').eq('user_id', userB).in('status', ['watching', 'completed']),
  ]);

  const setA = new Set((listA ?? []).map((r) => r.anime_id));
  const setB = new Set((listB ?? []).map((r) => r.anime_id));
  if (setA.size === 0 || setB.size === 0) return null;

  const shared = [...setA].filter((id) => setB.has(id)).length;
  const union = new Set([...setA, ...setB]).size;
  return Math.round((shared / union) * 100);
}
