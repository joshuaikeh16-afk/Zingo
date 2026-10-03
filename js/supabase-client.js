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
    throw error;
  }
  if (!profile) {
    window.location.href = '/onboarding.html';
    return null;
  }
  return profile;
}

/** All users who are accepted friends with `userId`. */
export async function getMutualFriends(userId) {
  const { data: rows, error } = await supabase
    .from('friend_requests')
    .select('requester_id, target_id')
    .eq('status', 'accepted')
    .or(`requester_id.eq.${userId},target_id.eq.${userId}`);

  if (error) throw error;
  const friendIds = (rows ?? []).map((r) => (r.requester_id === userId ? r.target_id : r.requester_id));
  if (friendIds.length === 0) return [];

  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, interests')
    .in('id', friendIds);

  if (profileError) throw profileError;
  return profiles ?? [];
}

/** Uses the existing get_or_create_conversation RPC -- don't reimplement find-or-create client-side. */
export async function getOrCreateConversation(otherUserId) {
  const { data, error } = await supabase.rpc('get_or_create_conversation', {
    other_user_id: otherUserId,
  });
  if (error) throw error;
  return data;
}

export async function getMessages(conversationId, before = null) {
  let query = supabase.from('messages').select('*').eq('conversation_id', conversationId)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100);
  if (before) query = query.or(`created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id})`);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).reverse();
}

function watchMessages(name, filter, onMessage, onStatus = () => {}) {
  const channel = supabase.channel(name);
  for (const event of ['INSERT', 'UPDATE']) {
    channel.on('postgres_changes', { event, schema: 'public', table: 'messages', ...filter },
      (payload) => onMessage(payload.new, event));
  }
  channel.on('system', '*', (payload) => {
    if (payload.extension === 'postgres_changes') onStatus(payload.status === 'ok' ? 'LIVE' : 'CHANNEL_ERROR');
  });
  return channel.subscribe(onStatus);
}

export function subscribeToMessages(conversationId, onMessage, onStatus) {
  return watchMessages(`messages:${conversationId}:${crypto.randomUUID()}`, { filter: `conversation_id=eq.${conversationId}` }, onMessage, onStatus);
}

// RLS must restrict message SELECT to conversation participants.
export function subscribeToInboxUpdates(userId, onMessage, onStatus) {
  const channel = supabase.channel(`inbox:${userId}`);
  for (const event of ['INSERT', 'UPDATE']) channel.on('postgres_changes', { event, schema: 'public', table: 'messages' }, onMessage);
  channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reads', filter: `user_id=eq.${userId}` }, onMessage);
  channel.on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_participants', filter: `user_id=eq.${userId}` }, onMessage);
  channel.on('postgres_changes', { event: '*', schema: 'public', table: 'chat_signals', filter: `user_id=eq.${userId}` }, onMessage);
  return channel.subscribe(onStatus);
}

export async function sendMessage({ id, conversationId, senderId, content, messageType = 'text', sharedContent = null, replyTo = null, mediaUrl = null, duration = null, mentionIds = [] }) {
  const { data, error } = await supabase.from('messages').insert({
    ...(id ? { id } : {}), conversation_id: conversationId, sender_id: senderId,
    content, message_type: messageType, mention_ids: mentionIds, ...(sharedContent ? { shared_content: sharedContent } : {}), ...(replyTo ? { external_ref_id: replyTo } : {}),
    ...(mediaUrl ? { media_url: mediaUrl, media_duration_seconds: duration } : {}),
  }).select().single();
  if (error?.code === '23505' && id) {
    // A retry after a lost acknowledgement uses the same ID, never a second message.
    const existing = await supabase.from('messages').select('*').eq('id', id)
      .eq('conversation_id', conversationId).eq('sender_id', senderId).single();
    if (existing.error) throw existing.error;
    return existing.data;
  }
  if (error) throw error;
  return data;
}

// A missing optional RPC is tried once per page, rather than every polling cycle.
const unavailableRpcs = new Set();
async function optionalRpc(name, args) {
  if (unavailableRpcs.has(name)) return { data: null, error: { code: 'PGRST202' } };
  const result = await supabase.rpc(name, args);
  if (missingFunction(result.error)) unavailableRpcs.add(name);
  return result;
}
export async function getInbox(userId) {
  const inbox = await optionalRpc('kaidra_inbox');
  if (!inbox.error && Array.isArray(inbox.data)) return inbox.data.filter(row => row.profile && row.conversationId).map(row => ({ ...row, unreadCount: Math.max(0, Number(row.unreadCount) || 0) }));
  if (inbox.error && !missingFunction(inbox.error)) throw inbox.error;
  const { data: mine, error } = await supabase.from('conversation_participants')
    .select('conversation_id').eq('user_id', userId);
  if (error) throw error;
  const ids = (mine || []).map((row) => row.conversation_id);
  if (!ids.length) return [];
  const peers = await supabase.from('conversation_participants').select('conversation_id, user_id')
    .in('conversation_id', ids).neq('user_id', userId);
  if (peers.error) throw peers.error;
  if (!peers.data?.length) return [];
  const profiles = await supabase.from('profiles').select('id, username, display_name, avatar_url')
    .in('id', [...new Set(peers.data.map((row) => row.user_id))]);
  if (profiles.error) throw profiles.error;
  const byId = new Map((profiles.data || []).map((profile) => [profile.id, profile]));
  const conversations = [...new Set(peers.data.map(peer => peer.conversation_id))];
  const rows = await Promise.all(conversations.map(async (conversationId) => {
    const participants = peers.data.filter(peer => peer.conversation_id === conversationId);
    const peer = participants[0];
    const [last, unread] = await Promise.all([
      supabase.from('messages').select('*').eq('conversation_id', peer.conversation_id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', peer.conversation_id).neq('sender_id', userId).is('read_at', null),
    ]);
    if (last.error || unread.error) throw last.error || unread.error;
    const isGroup = participants.length > 1;
    const profile = isGroup ? { id: conversationId, display_name: 'Group conversation', username: 'group' } : byId.get(peer.user_id);
    return { conversationId, isGroup, profile, lastMessage: last.data, unreadCount: unread.count || 0 };
  }));
  return rows.filter((row) => row.profile).sort((a, b) => new Date(b.lastMessage?.created_at || 0) - new Date(a.lastMessage?.created_at || 0));
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

export async function uploadVoiceNote(conversationId, blob, id = crypto.randomUUID()) {
  const mime = blob.type.split(';')[0] || 'audio/webm';
  const extension = ({ 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/wav': 'wav' })[mime];
  if (!extension || !blob.size || blob.size > 10 * 1024 * 1024) throw new Error('Unsupported or oversized voice recording');
  const path = `${conversationId}/${id}.${extension}`;
  const { error } = await supabase.storage.from('voice-notes').upload(path, blob, {
    contentType: mime,
  });
  // Retrying a lost upload acknowledgement keeps the same private object path.
  if (error && !['409', 'Duplicate'].includes(String(error.statusCode || error.error))) throw error;
  return path;
}

/** Generates a short-lived signed URL for a private chat-images/voice-notes object. Call at render time, never store the result permanently. */
export async function getSignedMediaUrl(bucket, path, expiresInSeconds = 3600) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}

export async function markConversationRead(conversationId, userId, through = null, { isGroup = false } = {}) {
  const receipt = await optionalRpc('kaidra_mark_read', { target_conversation: conversationId,
    ...(through ? { through_created_at: through.created_at, through_message: through.id } : {}) });
  if (!receipt.error) return;
  if (!missingFunction(receipt.error)) throw receipt.error;
  if (isGroup) throw new Error('Group read receipts are unavailable');
  let query = supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .neq('sender_id', userId)
    .is('read_at', null);
  if (through) query = query.or(`created_at.lt.${through.created_at},and(created_at.eq.${through.created_at},id.lte.${through.id})`);
  const { error } = await query;
  if (error) throw error;
  let remaining = supabase.from('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', conversationId).neq('sender_id', userId).is('read_at', null);
  if (through) remaining = remaining.or(`created_at.lt.${through.created_at},and(created_at.eq.${through.created_at},id.lte.${through.id})`);
  const check = await remaining;
  if (check.error || check.count) throw check.error || new Error('Read updates were not saved');
}

export function missingFunction(error) { return ['PGRST202', '42883'].includes(error?.code); }
export async function chatAction(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}
export async function getChatState(conversationId, messageIds = []) {
  const result = await optionalRpc('kaidra_chat_state', { target_conversation: conversationId,
    ...(messageIds.length ? { message_ids: messageIds.slice(-1000) } : {}) });
  if (!result.error && result.data?.conversation) return { ...result.data, extended: true };
  if (result.error && !missingFunction(result.error)) throw result.error;
  const members = await supabase.from('conversation_participants').select('user_id').eq('conversation_id', conversationId);
  if (members.error) throw members.error;
  const profiles = await supabase.from('profiles').select('id,username,display_name,avatar_url').in('id', (members.data || []).map(member => member.user_id));
  if (profiles.error) throw profiles.error;
  return { conversation: { id: conversationId, is_group: (profiles.data || []).length > 2 }, members: profiles.data || [], reactions: [], reads: [], extended: false };
}
export function subscribeToChatInteractions(conversationId, onChange) {
  return supabase.channel(`chat-interactions:${conversationId}:${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions', filter: `conversation_id=eq.${conversationId}` }, onChange)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reads', filter: `conversation_id=eq.${conversationId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_participants', filter: `conversation_id=eq.${conversationId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_polls', filter: `conversation_id=eq.${conversationId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'poll_votes', filter: `conversation_id=eq.${conversationId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'message_pins', filter: `conversation_id=eq.${conversationId}` }, onChange)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations', filter: `id=eq.${conversationId}` }, onChange)
    .subscribe(status => { if (status === 'SUBSCRIBED') onChange(); });
}

/** Call after a successful text/voice/image send -- not stickers/reactions. */
export async function recordFriendInteraction(otherUserId) {
  await supabase.rpc('record_friend_interaction', { other_user_id: otherUserId });
}

export async function isMutualFriend(userA, userB) {
  const { data, error } = await supabase.rpc('is_mutual_friend', { user_a: userA, user_b: userB });
  if (error) return false;
  return !!data;
}

/** Searches profiles by username (case-insensitive partial match), excluding the current user. */
export async function searchUsers(query, currentUserId) {
  if (!query || query.trim().length < 2) return [];
  const term = query.trim().replace(/[(),.%"\\]/g, ' ').replaceAll('_', '\\_').slice(0, 100).trim();
  if (!term) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url')
    .or(`username.ilike.%${term}%,display_name.ilike.%${term}%`)
    .neq('id', currentUserId)
    .limit(20);
  if (error) throw error;
  return data ?? [];
}

/**
 * Friendship state between two users, from currentUserId's perspective:
 * 'none' | 'pending_sent' | 'pending_received' | 'friends'
 */
export async function getFriendshipStatus(currentUserId, otherUserId) {
  const { data, error } = await supabase.from('friend_requests').select('requester_id,target_id,status')
    .or(`and(requester_id.eq.${currentUserId},target_id.eq.${otherUserId}),and(requester_id.eq.${otherUserId},target_id.eq.${currentUserId})`);
  if (error) throw error;
  if ((data || []).some((row) => row.status === 'accepted')) return 'friends';
  const pending = (data || []).find((row) => row.status === 'pending');
  return pending ? pending.requester_id === currentUserId ? 'pending_sent' : 'pending_received' : 'none';
}

/**
 * Sends a friend request. If the other person already sent one to you
 * (a pending row the other direction), this accepts it instead of
 * creating a duplicate -- mirrors how most apps handle a mutual add.
 */
export async function sendFriendRequest(requesterId, targetId) {
  const { data: reverseRequest, error: reverseError } = await supabase
    .from('friend_requests')
    .select('id, status')
    .eq('requester_id', targetId)
    .eq('target_id', requesterId)
    .maybeSingle();

  if (reverseError) throw reverseError;
  if (reverseRequest && reverseRequest.status === 'pending') {
    return respondToFriendRequest(reverseRequest.id, true);
  }

  const { error } = await supabase.from('friend_requests').upsert({ requester_id: requesterId, target_id: targetId, status: 'pending', responded_at: null }, { onConflict: 'requester_id,target_id' });
  if (error) throw error;
}

/** Cancels a request you sent that's still pending. */
export async function cancelFriendRequest(requesterId, targetId) {
  const { error } = await supabase
    .from('friend_requests')
    .delete()
    .eq('requester_id', requesterId)
    .eq('target_id', targetId)
    .eq('status', 'pending');
  if (error) throw error;
}

/** Accepts or declines a request sent to you. */
export async function respondToFriendRequest(requestId, accept) {
  const { error } = await supabase
    .from('friend_requests')
    .update({ status: accept ? 'accepted' : 'declined', responded_at: new Date().toISOString() })
    .eq('id', requestId);
  if (error) throw error;
}

/** Removes an existing friendship (either party can do this). */
export async function removeFriend(userId, otherId) {
  const { error } = await supabase
    .from('friend_requests')
    .delete()
    .eq('status', 'accepted')
    .or(`and(requester_id.eq.${userId},target_id.eq.${otherId}),and(requester_id.eq.${otherId},target_id.eq.${userId})`);
  if (error) throw error;
}

/** Pending requests sent TO userId, with the requester's profile attached. */
export async function getIncomingRequests(userId) {
  const { data: rows, error } = await supabase
    .from('friend_requests')
    .select('id, created_at, requester_id')
    .eq('target_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) throw error;
  if (!rows || rows.length === 0) return [];

  const requesterIds = rows.map((r) => r.requester_id);
  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url')
    .in('id', requesterIds);

  if (profileError) throw profileError;
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  return rows
    .map((r) => ({ id: r.id, created_at: r.created_at, requester: profileById.get(r.requester_id) }))
    .filter((r) => r.requester);
}

export async function getUserPreferences(userId) {
  const defaults = { allow_dms: true };
  const { data, error } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return { ...defaults, ...(data || {}) };
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
  const { count, error } = await supabase
    .from('friend_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'accepted')
    .or(`requester_id.eq.${userId},target_id.eq.${userId}`);
  if (error) throw error;
  return count ?? 0;
}
