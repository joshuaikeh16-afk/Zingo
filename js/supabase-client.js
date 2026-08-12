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

export async function sendMessage({ conversationId, senderId, content, messageType = 'text' }) {
  const { error } = await supabase.from('messages').insert({
    conversation_id: conversationId,
    sender_id: senderId,
    content,
    message_type: messageType,
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
