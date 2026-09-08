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

      const [{ data: profile }, { data: lastMessage }, { count: unreadCount }, streak, activeAotd] =
        await Promise.all([
          supabase.from('profiles').select('id, username, display_name, avatar_url').eq('id', otherUserId).maybeSingle(),
          supabase.from('messages').select('content, message_type, created_at').eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
          supabase.from('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', conversationId).neq('sender_id', userId).is('read_at', null),
          getStreak(userId, otherUserId),
          hasActiveAotdFrom(otherUserId, userId),
        ]);

      return {
        conversationId,
        otherUserId,
        profile,
        lastMessage,
        unreadCount: unreadCount ?? 0,
        streak,
        hasActiveAotd: activeAotd,
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

/**
 * Inbox listing for a friends-only chat model: every friend appears,
 * whether or not a conversation has actually started yet. Friends with
 * an existing conversation are sorted by most recent message first;
 * friends with no conversation yet (conversationId: null) come after.
 */
export async function getFriendsInbox(userId) {
  const friends = await getMutualFriends(userId);
  if (friends.length === 0) return [];

  const rows = await Promise.all(
    friends.map(async (friend) => {
      const { data: myConvos } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', userId);
      const myConvoIds = (myConvos ?? []).map((r) => r.conversation_id);

      let conversationId = null;
      if (myConvoIds.length > 0) {
        const { data: shared } = await supabase
          .from('conversation_participants')
          .select('conversation_id')
          .eq('user_id', friend.id)
          .in('conversation_id', myConvoIds)
          .maybeSingle();
        conversationId = shared?.conversation_id ?? null;
      }

      let lastMessage = null;
      let unreadCount = 0;
      if (conversationId) {
        const [{ data: lm }, { count }] = await Promise.all([
          supabase.from('messages').select('content, message_type, created_at').eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
          supabase.from('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', conversationId).neq('sender_id', userId).is('read_at', null),
        ]);
        lastMessage = lm;
        unreadCount = count ?? 0;
      }

      const [streak, activeAotd] = await Promise.all([
        getStreak(userId, friend.id),
        hasActiveAotdFrom(friend.id, userId),
      ]);

      return { conversationId, otherUserId: friend.id, profile: friend, lastMessage, unreadCount, streak, hasActiveAotd: activeAotd };
    })
  );

  return rows.sort((a, b) => {
    if (!a.lastMessage && !b.lastMessage) return 0;
    if (!a.lastMessage) return 1;
    if (!b.lastMessage) return -1;
    return new Date(b.lastMessage.created_at) - new Date(a.lastMessage.created_at);
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

async function hasActiveAotdFrom(senderId, recipientId) {
  const { data } = await supabase
    .from('aotd_recipients')
    .select('aotd_id, aotd_posts!inner(sender_id, expires_at)')
    .eq('recipient_id', recipientId)
    .eq('aotd_posts.sender_id', senderId)
    .gt('aotd_posts.expires_at', new Date().toISOString())
    .limit(1);
  return (data?.length ?? 0) > 0;
}

export { hasActiveAotdFrom };

/** All users who are accepted friends with `userId`. */
export async function getMutualFriends(userId) {
  const { data: rows } = await supabase
    .from('friend_requests')
    .select('requester_id, target_id')
    .eq('status', 'accepted')
    .or(`requester_id.eq.${userId},target_id.eq.${userId}`);

  const friendIds = (rows ?? []).map((r) => (r.requester_id === userId ? r.target_id : r.requester_id));
  if (friendIds.length === 0) return [];

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url')
    .in('id', friendIds);

  return profiles ?? [];
}

/** Each mutual friend's most recent unexpired post, plus their Anime-of-the-Day indicator state. Skips friends with no active post. */
export async function getFriendsActiveStatuses(userId) {
  const friends = await getMutualFriends(userId);
  if (friends.length === 0) return [];

  const results = await Promise.all(
    friends.map(async (friend) => {
      const { data: latestPost } = await supabase
        .from('posts')
        .select('*')
        .eq('user_id', friend.id)
        .neq('post_type', 'video')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!latestPost) return null;

      const hasAotd = await hasActiveAotdFrom(friend.id, userId);
      return { friend, post: latestPost, hasActiveAotd: hasAotd };
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

/** Full details for the active Anime of the Day from `senderId` to `recipientId`, for populating the viewer modal. Null if none active. */
export async function getActiveAotdDetails(senderId, recipientId) {
  const { data } = await supabase
    .from('aotd_recipients')
    .select('aotd_id, viewed_at, aotd_posts!inner(id, sender_id, anime_id, anime_title, cover_image_url, note, created_at, expires_at)')
    .eq('recipient_id', recipientId)
    .eq('aotd_posts.sender_id', senderId)
    .gt('aotd_posts.expires_at', new Date().toISOString())
    .order('aotd_posts(created_at)', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.aotd_posts ?? null;
}

export async function markAotdViewed(aotdId, recipientId) {
  await supabase
    .from('aotd_recipients')
    .update({ viewed_at: new Date().toISOString() })
    .eq('aotd_id', aotdId)
    .eq('recipient_id', recipientId);
}

/** Shares an Anime of the Day with every mutual friend. Expires in 24h, same as a status post. */
export async function shareAnimeOfTheDay(senderId, { animeId, animeTitle, coverImageUrl, note }) {
  const friends = await getMutualFriends(senderId);
  if (friends.length === 0) throw new Error('No friends to share with yet.');

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { data: post, error } = await supabase
    .from('aotd_posts')
    .insert({ sender_id: senderId, anime_id: animeId, anime_title: animeTitle, cover_image_url: coverImageUrl, note: note || null, expires_at: expiresAt })
    .select('id')
    .single();
  if (error) throw error;

  const recipientRows = friends.map((f) => ({ aotd_id: post.id, recipient_id: f.id }));
  const { error: recipErr } = await supabase.from('aotd_recipients').insert(recipientRows);
  if (recipErr) throw recipErr;

  return post.id;
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

/**
 * Inbox-wide realtime subscription (not scoped to one open thread).
 * Unfiltered on purpose -- RLS on messages ("Participants can view
 * messages") means Realtime only ever delivers rows for conversations
 * this user is actually in, so this is safe. Used to keep the
 * conversation list itself (previews, unread badges, ordering) live
 * without requiring a manual refresh, even for conversations that
 * aren't currently open.
 */
export function subscribeToInboxUpdates(userId, onNewMessage) {
  const channel = supabase
    .channel(`inbox:${userId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      (payload) => onNewMessage(payload.new)
    )
    .subscribe();
  return channel;
}

export async function getCreatorNotifications(userId) {
  const { data, error } = await supabase
    .from('creator_notifications')
    .select('*')
    .eq('recipient_id', userId)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error?.code === 'PGRST205') return null;
  if (error) throw error;
  return data ?? [];
}

export function subscribeToCreatorNotifications(userId, onNotification) {
  return supabase
    .channel(`creator-notifications:${userId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'creator_notifications', filter: `recipient_id=eq.${userId}` }, (payload) => onNotification(payload.new))
    .subscribe();
}

export async function sendMessage({ conversationId, senderId, content, messageType = 'text', externalRefId = null, mediaUrl = null, mediaDurationSeconds = null }) {
  const { data, error } = await supabase.from('messages').insert({
    conversation_id: conversationId,
    sender_id: senderId,
    content,
    message_type: messageType,
    ...(externalRefId ? { external_ref_id: externalRefId } : {}),
    ...(mediaUrl ? { media_url: mediaUrl } : {}),
    ...(mediaDurationSeconds != null ? { media_duration_seconds: mediaDurationSeconds } : {}),
  }).select().single();
  if (error) throw error;
  return data;
}

/**
 * Uploads a chat image to the (private) chat-images bucket, path
 * {conversationId}/{timestamp}.{ext} to match the storage RLS policy,
 * which grants access based on conversation_participants. Returns the
 * storage PATH, not a URL -- buckets are private, so display-time code
 * must call getSignedMediaUrl() to get a real, time-limited URL rather
 * than storing a permanent public one.
 */
export async function uploadChatImage(conversationId, file) {
  const ext = file.name.split('.').pop() || 'jpg';
  const path = `${conversationId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('chat-images').upload(path, file);
  if (error) throw error;
  return path;
}

export async function uploadVoiceNote(conversationId, blob) {
  const path = `${conversationId}/${Date.now()}.webm`;
  const { error } = await supabase.storage.from('voice-notes').upload(path, blob, {
    contentType: 'audio/webm',
  });
  if (error) throw error;
  return path;
}

/** Generates a short-lived signed URL for a private chat-images/voice-notes object. Call at render time, never store the result permanently. */
export async function getSignedMediaUrl(bucket, path, expiresInSeconds = 3600) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
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

// Audio search is proxied through Supabase so a Freesound/API token never
// ships to the browser. The local fallback keeps the picker usable while the
// optional `audio-search` Edge Function is being deployed.
const KAIDRA_AUDIO_FALLBACK = [
  { id: 'original', title: 'Original sound', artist: 'Your video', source: 'original', previewUrl: null },
  { id: 'kaidra-pulse', title: 'Kaidra Pulse', artist: 'Kaidra Sounds', source: 'Kaidra library', previewUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' },
  { id: 'kaidra-dream', title: 'Midnight Dream', artist: 'Kaidra Sounds', source: 'Kaidra library', previewUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3' },
];

export async function searchAudioTracks(query = '') {
  const term = query.trim().toLowerCase();
  try {
    const { data, error } = await supabase.functions.invoke('audio-search', { body: { query: term, limit: 12 } });
    if (!error && Array.isArray(data?.tracks)) return data.tracks;
  } catch (error) {
    console.warn('Audio search function unavailable; using local catalog.', error);
  }
  if (!term) return KAIDRA_AUDIO_FALLBACK;
  return KAIDRA_AUDIO_FALLBACK.filter((track) => `${track.title} ${track.artist}`.toLowerCase().includes(term));
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

/**
 * Friendship state between two users, from currentUserId's perspective:
 * 'none' | 'pending_sent' | 'pending_received' | 'friends'
 */
export async function getFriendshipStatus(currentUserId, otherUserId) {
  const { data } = await supabase
    .from('friend_requests')
    .select('requester_id, target_id, status')
    .or(`and(requester_id.eq.${currentUserId},target_id.eq.${otherUserId}),and(requester_id.eq.${otherUserId},target_id.eq.${currentUserId})`)
    .maybeSingle();

  if (!data) return 'none';
  if (data.status === 'accepted') return 'friends';
  if (data.status === 'declined') return 'none';
  // pending
  return data.requester_id === currentUserId ? 'pending_sent' : 'pending_received';
}

/**
 * Sends a friend request. If the other person already sent one to you
 * (a pending row the other direction), this accepts it instead of
 * creating a duplicate -- mirrors how most apps handle a mutual add.
 */
export async function sendFriendRequest(requesterId, targetId) {
  const { data: reverseRequest } = await supabase
    .from('friend_requests')
    .select('id, status')
    .eq('requester_id', targetId)
    .eq('target_id', requesterId)
    .maybeSingle();

  if (reverseRequest && reverseRequest.status === 'pending') {
    return respondToFriendRequest(reverseRequest.id, true);
  }

  await supabase.from('friend_requests').insert({ requester_id: requesterId, target_id: targetId });
}

/** Cancels a request you sent that's still pending. */
export async function cancelFriendRequest(requesterId, targetId) {
  await supabase
    .from('friend_requests')
    .delete()
    .eq('requester_id', requesterId)
    .eq('target_id', targetId)
    .eq('status', 'pending');
}

/** Accepts or declines a request sent to you. */
export async function respondToFriendRequest(requestId, accept) {
  await supabase
    .from('friend_requests')
    .update({ status: accept ? 'accepted' : 'declined', responded_at: new Date().toISOString() })
    .eq('id', requestId);
}

/** Removes an existing friendship (either party can do this). */
export async function removeFriend(userId, otherId) {
  await supabase
    .from('friend_requests')
    .delete()
    .eq('status', 'accepted')
    .or(`and(requester_id.eq.${userId},target_id.eq.${otherId}),and(requester_id.eq.${otherId},target_id.eq.${userId})`);
}

/** Pending requests sent TO userId, with the requester's profile attached. */
export async function getIncomingRequests(userId) {
  const { data: rows } = await supabase
    .from('friend_requests')
    .select('id, created_at, requester_id')
    .eq('target_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (!rows || rows.length === 0) return [];

  const requesterIds = rows.map((r) => r.requester_id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url')
    .in('id', requesterIds);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  return rows
    .map((r) => ({ id: r.id, created_at: r.created_at, requester: profileById.get(r.requester_id) }))
    .filter((r) => r.requester);
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

export async function getFollowCounts(userId) {
  const results = await Promise.all([
    supabase.from('profile_follows').select('follower_id', { count: 'exact', head: true }).eq('following_id', userId),
    supabase.from('profile_follows').select('following_id', { count: 'exact', head: true }).eq('follower_id', userId),
  ]);
  if (results.some((result) => result.error?.code === 'PGRST205')) return { followers: 0, following: 0 };
  return { followers: results[0].count ?? 0, following: results[1].count ?? 0 };
}

export async function getFollowState(followerId, followingId) {
  if (!followerId || !followingId || followerId === followingId) return false;
  const { data, error } = await supabase
    .from('profile_follows')
    .select('following_id')
    .eq('follower_id', followerId)
    .eq('following_id', followingId)
    .maybeSingle();
  if (error?.code === 'PGRST205') return false;
  if (error) throw error;
  return !!data;
}

export async function toggleFollow(followerId, followingId) {
  const following = await getFollowState(followerId, followingId);
  if (following) {
    const { error } = await supabase.from('profile_follows').delete().eq('follower_id', followerId).eq('following_id', followingId);
    if (error) throw error;
    return false;
  }
  const { error } = await supabase.from('profile_follows').insert({ follower_id: followerId, following_id: followingId });
  if (error) throw error;
  return true;
}

export async function getCreatorProfilePosts(userId, section = 'posted', savedSection = 'videos') {
  if (section === 'reposted') {
    const { data, error } = await supabase.from('video_reposts').select('posts(*)').eq('user_id', userId).order('created_at', { ascending: false });
    if (error?.code === 'PGRST205') return [];
    return (data ?? []).map((row) => row.posts).filter(Boolean);
  }
  if (section === 'saved' && savedSection === 'videos') {
    const { data } = await supabase.from('video_saves').select('posts(*)').eq('user_id', userId).order('created_at', { ascending: false });
    return (data ?? []).map((row) => row.posts).filter(Boolean);
  }
  if (section === 'locked') return [];
  return getUserPosts(userId);
}

export async function getPinnedVideoIds(userId) {
  const { data, error } = await supabase.from('video_pins').select('post_id, pin_order').eq('user_id', userId).order('pin_order');
  if (error?.code === 'PGRST205') return [];
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
  // Include the current user's own video posts and followed creators so
  // repost visibility can distinguish Friends from Followers.
  const { data: followingRows } = await supabase.from('profile_follows').select('following_id').eq('follower_id', userId);
  const followingIds = (followingRows ?? []).map((row) => row.following_id);
  const authorIds = [...new Set([...friendIds, ...followingIds, userId])];
  if (authorIds.length === 0) return [];

  const { data } = await supabase
    .from('posts')
    .select('*, profiles!posts_user_id_fkey(id, username, display_name, avatar_url)')
    .eq('post_type', 'video')
    .in('user_id', authorIds)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });

  const basePosts = data ?? [];
  const { data: repostRows, error: repostError } = await supabase
    .from('video_reposts')
    .select('user_id, visibility, posts(*)')
    .in('user_id', authorIds);
  if (repostError?.code === 'PGRST205') return basePosts;
  if (repostError) return basePosts;
  const friendSet = new Set(friendIds);
  const followingSet = new Set(followingIds);
  const visibleReposts = (repostRows ?? [])
    .filter((row) => row.posts && ((friendSet.has(row.user_id) && ['friends', 'both'].includes(row.visibility)) || (followingSet.has(row.user_id) && ['followers', 'both'].includes(row.visibility)) || row.user_id === userId))
    .map((row) => ({ ...row.posts, reposted_by: row.user_id }));
  return [...new Map([...basePosts, ...visibleReposts].map((post) => [post.id, post])).values()]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

/**
 * Uploads one user's short-form video. The object is private; callers store
 * the returned path on posts.media_url and resolve it to a signed URL only
 * when rendering a feed.
 */
export async function uploadVideoPost(userId, file) {
  const extension = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${userId}/${crypto.randomUUID()}.${extension || 'mp4'}`;
  const { error } = await supabase.storage.from('post-videos').upload(path, file, {
    contentType: file.type || 'video/mp4',
    upsert: false,
  });
  if (error) throw error;
  return path;
}

export async function deleteVideoPostUpload(path) {
  if (!path) return;
  await supabase.storage.from('post-videos').remove([path]);
}

/** Deletes an author's video post and its private object. */
export async function deleteVideoPost(userId, postId, mediaPath) {
  const { error } = await supabase
    .from('posts')
    .delete()
    .eq('id', postId)
    .eq('user_id', userId)
    .eq('post_type', 'video');
  if (error) throw error;
  // A failed cleanup leaves only an inaccessible orphan, never a visible post.
  await deleteVideoPostUpload(mediaPath).catch((cleanupError) => console.warn('Video file cleanup failed:', cleanupError));
}

/** Creates a 24-hour user video post after its media has uploaded. */
export async function createVideoPost(userId, { mediaPath, mediaType = 'video', caption = '', overlayText = '', overlayLayers = [], allowDownload = true, musicTitle = '', musicArtist = '', musicUrl = '', tags = [], sticker = '', filterName = 'none', trimStartSeconds = null, trimEndSeconds = null, durationSeconds = null }) {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const payload = {
      user_id: userId,
      post_type: 'video',
      media_type: mediaType,
      media_url: mediaPath,
      caption: caption || null,
      overlay_text: overlayText || null,
      overlay_layers: Array.isArray(overlayLayers) ? overlayLayers : [],
      allow_download: allowDownload !== false,
      music_title: musicTitle || null,
      music_artist: musicArtist || null,
      music_url: musicUrl || null,
      tags: Array.isArray(tags) ? tags : [],
      sticker: sticker || null,
      filter_name: filterName || 'none',
      trim_start_seconds: trimStartSeconds,
      trim_end_seconds: trimEndSeconds,
      expires_at: expiresAt,
      ...(durationSeconds != null ? { media_duration_seconds: durationSeconds } : {}),
  };
  let { data, error } = await supabase.from('posts').insert(payload).select('*').single();
  if (error?.code === 'PGRST204' && /allow_download|overlay_layers/.test(error.message || '')) {
    const legacyPayload = { ...payload };
    delete legacyPayload.allow_download;
    delete legacyPayload.overlay_layers;
    ({ data, error } = await supabase.from('posts').insert(legacyPayload).select('*').single());
  }
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------
// Comments -- only relevant now that Videos means real user-posted
// content with an actual author, not YouTube-sourced videos.
// ---------------------------------------------------------------------

export async function getComments(postId) {
  // Do not depend on a generated relationship name here. Existing projects
  // can have a different FK constraint name, which makes the nested select
  // fail with a 400 even though post_comments itself is healthy.
  const { data: comments, error } = await supabase
    .from('post_comments')
    .select('*')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });
  if (error) throw error;

  const userIds = [...new Set((comments ?? []).map((comment) => comment.user_id).filter(Boolean))];
  if (!userIds.length) return comments ?? [];
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url')
    .in('id', userIds);
  if (profilesError) throw profilesError;
  const byId = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  return (comments ?? []).map((comment) => ({ ...comment, profiles: byId.get(comment.user_id) ?? null }));
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
// Video engagement — likes, private saves, comments, and share events.
// ---------------------------------------------------------------------

export async function getVideoEngagement(postId, userId) {
  const results = await Promise.all([
    supabase.from('post_likes').select('post_id', { count: 'exact', head: true }).eq('post_id', postId),
    supabase.from('post_comments').select('post_id', { count: 'exact', head: true }).eq('post_id', postId),
    supabase.from('post_likes').select('post_id').eq('post_id', postId).eq('user_id', userId).maybeSingle(),
    supabase.from('video_saves').select('post_id').eq('post_id', postId).eq('user_id', userId).maybeSingle(),
  ]);
  const [likes, comments, liked, saved] = results;
  const requiredError = [likes, comments, liked].find((result) => result.error)?.error;
  if (requiredError) throw requiredError;
  // Keep the feed usable while an older deployment is missing the optional
  // video_saves migration. The save action itself still surfaces the error.
  return {
    likeCount: likes.count ?? 0,
    commentCount: comments.count ?? 0,
    liked: !!liked.data,
    saved: !saved.error && !!saved.data,
  };
}

export async function togglePostLike(postId, userId) {
  const { data: existing } = await supabase.from('post_likes').select('post_id').eq('post_id', postId).eq('user_id', userId).maybeSingle();
  if (existing) {
    const { error } = await supabase.from('post_likes').delete().eq('post_id', postId).eq('user_id', userId);
    if (error) throw error;
    return false;
  }
  const { error } = await supabase.from('post_likes').insert({ post_id: postId, user_id: userId });
  if (error) throw error;
  return true;
}

export async function toggleVideoSave(postId, userId) {
  const { data: existing } = await supabase.from('video_saves').select('post_id').eq('post_id', postId).eq('user_id', userId).maybeSingle();
  if (existing) {
    const { error } = await supabase.from('video_saves').delete().eq('post_id', postId).eq('user_id', userId);
    if (error) throw error;
    return false;
  }
  const { error } = await supabase.from('video_saves').insert({ post_id: postId, user_id: userId });
  if (error) throw error;
  return true;
}

export async function recordVideoShare(postId, userId, destination = 'native') {
  const { error } = await supabase.from('video_shares').insert({ post_id: postId, user_id: userId, destination });
  if (error) throw error;
}

export async function getUserVideoActivity(userId) {
  const [likes, saves, comments, shares] = await Promise.all([
    supabase.from('post_likes').select('created_at, posts!inner(id, caption)').eq('user_id', userId).order('created_at', { ascending: false }).limit(30),
    supabase.from('video_saves').select('created_at, posts!inner(id, caption)').eq('user_id', userId).order('created_at', { ascending: false }).limit(30),
    supabase.from('post_comments').select('created_at, content, posts!inner(id, caption)').eq('user_id', userId).order('created_at', { ascending: false }).limit(30),
    supabase.from('video_shares').select('created_at, destination, posts!inner(id, caption)').eq('user_id', userId).order('created_at', { ascending: false }).limit(30),
  ]);
  return { likes: likes.data ?? [], saves: saves.data ?? [], comments: comments.data ?? [], shares: shares.data ?? [] };
}

// ---------------------------------------------------------------------
// Watchlist -- currently-watching badge + compatibility score
// ---------------------------------------------------------------------

const ANILIST_ENDPOINT = 'https://graphql.anilist.co';

/** Most recently added 'watching' entry, with the locally cached MAL title. */
export async function getCurrentlyWatching(userId) {
  const { data } = await supabase
    .from('user_watchlist')
    .select('anime_id, mal_id, title, updated_at')
    .eq('user_id', userId)
    .eq('status', 'watching')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return data.title ? { animeId: data.mal_id ?? data.anime_id, title: data.title } : null;
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

// ---------------------------------------------------------------------
// Watchlist — real add/update/remove/list, backed by user_watchlist.
// (fetchAnimeTitle above only fetches a title; these fetch full detail.)
// ---------------------------------------------------------------------

async function fetchAnimeDetails(anilistId) {
  try {
    const res = await fetch(ANILIST_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query ($id: Int) { Media(id: $id) { isAdult title { userPreferred } coverImage { large } episodes } }`,
        variables: { id: anilistId },
      }),
    });
    const json = await res.json();
    const m = json?.data?.Media;
    if (!m || m.isAdult === true) return null;
    return { title: m.title?.userPreferred ?? 'Unknown', coverUrl: m.coverImage?.large ?? null, totalEpisodes: m.episodes ?? null };
  } catch {
    return null;
  }
}

/** Batch-fetch title/cover/episodes for many AniList ids in one request. */
async function fetchAnimeDetailsBatch(ids, includeAdult = false) {
  if (!ids || ids.length === 0) return new Map();
  try {
    const res = await fetch(ANILIST_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids, type: ANIME) { id isAdult title { userPreferred } coverImage { large } episodes } } }`,
        variables: { ids },
      }),
    });
    const json = await res.json();
    const list = json?.data?.Page?.media ?? [];
    return new Map(list.filter((m) => includeAdult || m.isAdult !== true).map((m) => [m.id, { title: m.title?.userPreferred ?? 'Unknown', coverUrl: m.coverImage?.large ?? null, totalEpisodes: m.episodes ?? null }]));
  } catch {
    return new Map();
  }
}

/** Adds a MAL anime/manga entry to the local watchlist. */
export async function addToWatchlist(userId, animeId, status, totalEpisodes, metadata = {}) {
  const { error } = await supabase.from('user_watchlist').upsert(
    {
      user_id: userId,
      anime_id: animeId,
      mal_id: animeId,
      media_type: metadata.mediaType || 'anime',
      title: metadata.title || null,
      cover_url: metadata.coverUrl || null,
      score: metadata.score ?? null,
      total_episodes: totalEpisodes,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,anime_id' }
  );
  if (error) throw error;
}

export async function updateWatchlistProgress(userId, animeId, progress) {
  const { error } = await supabase
    .from('user_watchlist')
    .update({ progress, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('anime_id', animeId);
  if (error) throw error;
}

export async function updateWatchlistStatus(userId, animeId, status) {
  const { error } = await supabase
    .from('user_watchlist')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('anime_id', animeId);
  if (error) throw error;
}

export async function removeFromWatchlist(userId, animeId) {
  await supabase.from('user_watchlist').delete().eq('user_id', userId).eq('anime_id', animeId);
}

/** Full watchlist for a user, using locally cached MAL metadata. */
export async function getUserWatchlist(userId, includeAdult = false) {
  const { data: rows } = await supabase
    .from('user_watchlist')
    .select('anime_id, mal_id, media_type, status, progress, total_episodes, title, cover_url, score, tags, notes, times_rewatched, is_rewatching')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (!rows || rows.length === 0) return [];
  return rows.map((r) => ({
    animeId: r.mal_id ?? r.anime_id,
    mediaType: r.media_type || 'anime',
    status: r.status === 'planned' ? 'plan_to_watch' : r.status === 'favourite' ? 'completed' : r.status,
    progress: r.progress,
    totalEpisodes: r.total_episodes ?? null,
    title: r.title ?? `MAL #${r.mal_id ?? r.anime_id}`,
    coverUrl: r.cover_url ?? null,
    score: r.score,
    tags: r.tags || [],
    notes: r.notes || '',
    timesRewatched: r.times_rewatched || 0,
    isRewatching: !!r.is_rewatching,
  }));
}

/** Bulk-imports a public AniList username's list into the user's own watchlist. */
export async function importAniListByUsername(userId, aniListUsername, includeAdult = false) {
  const res = await fetch(ANILIST_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `query ($name: String) {
        MediaListCollection(userName: $name, type: ANIME) {
          lists { entries { status progress media { id isAdult episodes } } }
        }
      }`,
      variables: { name: aniListUsername },
    }),
  });
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message || 'AniList import failed.');
  const lists = json?.data?.MediaListCollection?.lists ?? [];
  if (lists.length === 0) return { imported: 0 };

  const statusMap = { CURRENT: 'watching', PLANNING: 'planned', COMPLETED: 'completed', DROPPED: 'dropped', PAUSED: 'watching', REPEATING: 'watching' };

  const rows = lists.flatMap((list) => list.entries).filter((entry) => includeAdult || entry.media?.isAdult !== true).map((entry) => ({
    user_id: userId,
    anime_id: entry.media.id,
    status: statusMap[entry.status] || 'planned',
    progress: entry.progress ?? 0,
    total_episodes: entry.media.episodes ?? null,
    updated_at: new Date().toISOString(),
  }));

  if (rows.length === 0) return { imported: 0 };

  const { error } = await supabase.from('user_watchlist').upsert(rows, { onConflict: 'user_id,anime_id' });
  if (error) throw error;
  return { imported: rows.length };
}

/** Trending anime from AniList, for the Watchlist tab's recommendations rail. */
export async function getTrendingAnime(limit = 12) {
  try {
    const res = await fetch(ANILIST_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query ($perPage: Int) { Page(perPage: $perPage) { media(sort: TRENDING_DESC, type: ANIME) { id isAdult title { userPreferred } coverImage { large } episodes } } }`,
        variables: { perPage: limit },
      }),
    });
    const json = await res.json();
    const list = json?.data?.Page?.media ?? [];
    return list.filter((m) => m.isAdult !== true).map((m) => ({ animeId: m.id, title: m.title?.userPreferred ?? 'Unknown', coverUrl: m.coverImage?.large ?? null, totalEpisodes: m.episodes ?? null }));
  } catch {
    return [];
  }
}

/** Trending anime within one genre -- powers the Watchlist tab's per-genre sliding rows. */
export async function getTrendingAnimeByGenre(genre, limit = 12, includeAdult = false) {
  try {
    const res = await fetch(ANILIST_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query ($perPage: Int, $genre: String) { Page(perPage: $perPage) { media(sort: TRENDING_DESC, type: ANIME, genre: $genre) { id isAdult title { userPreferred } coverImage { large } episodes } } }`,
        variables: { perPage: limit, genre },
      }),
    });
    const json = await res.json();
    const list = json?.data?.Page?.media ?? [];
    return list.filter((m) => includeAdult || m.isAdult !== true).map((m) => ({ animeId: m.id, title: m.title?.userPreferred ?? 'Unknown', coverUrl: m.coverImage?.large ?? null, totalEpisodes: m.episodes ?? null }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------
// User Preferences (Settings toggles)
// ---------------------------------------------------------------------

export async function getUserPreferences(userId) {
  const { data } = await supabase
    .from('user_preferences')
    .select('allow_dms, allow_nonfriend_dms, allow_follower_dms, public_watchlist, nsfw_filter, notify_dm, notify_likes, notify_comments')
    .eq('user_id', userId)
    .maybeSingle();

  // Row may not exist yet for a user. Mature content stays off by default.
  return data ?? { allow_dms: true, allow_nonfriend_dms: false, allow_follower_dms: false, public_watchlist: true, nsfw_filter: false, notify_dm: true, notify_likes: true, notify_comments: true };
}

export async function updateUserPreferences(userId, patch) {
  const { error } = await supabase
    .from('user_preferences')
    .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' });
  if (error) throw error;
}

// ---------------------------------------------------------------------
// Friend count (replaces getFollowCounts' following/followers pair --
// there's no asymmetric follow anymore, just one mutual Friends count)
// ---------------------------------------------------------------------

export async function getFriendCount(userId) {
  const { count } = await supabase
    .from('friend_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'accepted')
    .or(`requester_id.eq.${userId},target_id.eq.${userId}`);
  return count ?? 0;
}
