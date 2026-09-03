// Real Inbox logic: friends-only chat model. Every mutual friend shows
// up here whether or not a conversation has started yet -- there's no
// "New Chat / search anyone" flow, because you can only message
// friends. Tapping a friend with no conversation yet creates one on
// the spot.

import {
  supabase,
  requireAuth,
  requireProfile,
  getFriendsInbox,
  getMessages,
  sendMessage,
  subscribeToMessages,
  markConversationRead,
  recordFriendInteraction,
  getActiveAotdDetails,
  markAotdViewed,
  getOrCreateConversation,
} from './supabase-client.js';

let currentUserId = null;
let openConversationId = null;
let openOtherUserId = null;
let activeChannel = null;

const conversationList = document.getElementById('conversation-list');
const threadContainer = document.getElementById('message-thread-container');
const messageInput = document.getElementById('message-text-input');
const sendBtn = document.getElementById('message-send-btn');

function formatRelativeTime(isoString) {
  if (!isoString) return '';
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function buildConversationRow(friendRow) {
  const row = document.createElement('div');
  row.className = 'conversation-row chat-row';
  row.dataset.conversationId = friendRow.conversationId || '';
  row.dataset.otherUserId = friendRow.otherUserId;

  const name = friendRow.profile?.display_name || friendRow.profile?.username || 'Unknown';
  const avatarUrl = friendRow.profile?.avatar_url || 'https://placehold.co/120x120/1a1625/f2ede4?text=' + name[0];
  const preview = friendRow.lastMessage?.content || 'Say hi 👋';
  const time = formatRelativeTime(friendRow.lastMessage?.created_at);

  row.innerHTML = `
    <div class="conversation-avatar-wrap">
      <img src="${avatarUrl}" alt="${name}" class="avatar" />
      ${friendRow.hasActiveAotd ? '<span class="sotd-indicator">🎬</span>' : ''}
      ${friendRow.streak > 0 ? `<span class="streak-badge-mini">🔥 ${friendRow.streak}</span>` : ''}
    </div>
    <div class="chat-meta">
      <div class="chat-name">
        <span>${name}</span>
        <span class="chat-time">${time}</span>
      </div>
      <p class="chat-preview">${preview}</p>
    </div>
    ${friendRow.unreadCount > 0 ? `<span class="conversation-unread-badge">${friendRow.unreadCount}</span>` : ''}
  `;

  row.addEventListener('click', async (e) => {
    // Tapping the Anime-of-the-Day badge specifically opens the viewer,
    // rather than opening the thread.
    if (e.target.closest('.sotd-indicator')) {
      e.stopPropagation();
      openAotdViewer(friendRow.otherUserId, name);
      return;
    }

    let conversationId = friendRow.conversationId;
    if (!conversationId) {
      // First message to this friend -- create the conversation now.
      conversationId = await getOrCreateConversation(friendRow.otherUserId);
      friendRow.conversationId = conversationId;
      row.dataset.conversationId = conversationId;
    }

    openThread(conversationId, friendRow.otherUserId, name, avatarUrl);
  });

  return row;
}

async function openAotdViewer(senderId, senderName) {
  const modal = document.getElementById('aotd-viewer-modal');
  if (!modal) return;

  const aotd = await getActiveAotdDetails(senderId, currentUserId);
  if (!aotd) return;

  const titleEl = document.getElementById('aotd-viewer-title');
  const noteEl = document.getElementById('aotd-viewer-note');
  const coverEl = document.getElementById('aotd-viewer-cover');
  const linkEl = document.getElementById('aotd-viewer-anilist-link');
  const sharedByEl = document.getElementById('aotd-viewer-shared-by');

  if (titleEl) titleEl.textContent = aotd.anime_title;
  if (noteEl) noteEl.textContent = aotd.note || '';
  if (coverEl && aotd.cover_image_url) coverEl.src = aotd.cover_image_url;
  if (sharedByEl) sharedByEl.textContent = `Shared by ${senderName} • ${formatRelativeTime(aotd.created_at)}`;
  if (linkEl) linkEl.href = `https://anilist.co/anime/${aotd.anime_id}`;

  modal.classList.remove('hidden');
  markAotdViewed(aotd.id, currentUserId);
}

document.getElementById('aotd-viewer-close-btn')?.addEventListener('click', () => {
  document.getElementById('aotd-viewer-modal')?.classList.add('hidden');
});

async function renderConversationList() {
  if (!conversationList) return;
  const friends = await getFriendsInbox(currentUserId);

  const emptyState = document.getElementById('inbox-empty-state');
  conversationList.querySelectorAll('.conversation-row').forEach((el) => el.remove());

  if (friends.length === 0) {
    emptyState?.classList.remove('hidden');
  } else {
    emptyState?.classList.add('hidden');
    friends.forEach((f) => conversationList.appendChild(buildConversationRow(f)));
  }
}

function buildMessageBubble(message) {
  const isMine = message.sender_id === currentUserId;
  const bubble = document.createElement('div');
  bubble.dataset.messageId = message.id;
  bubble.dataset.messageType = message.message_type;

  if (message.message_type === 'sticker') {
    bubble.className = `message-row ${isMine ? 'outgoing' : 'incoming'} sticker-bubble`;
    bubble.textContent = message.content;
    return bubble;
  }

  if (message.message_type === 'image') {
    bubble.className = `message-row ${isMine ? 'outgoing' : 'incoming'}`;
    const time = new Date(message.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    bubble.innerHTML = `
      <div class="message-bubble message-bubble-image">
        <img src="${message.media_url}" alt="Shared image" />
      </div>
      <span class="message-time">${time}</span>
    `;
    return bubble;
  }

  if (message.message_type === 'voice_note') {
    bubble.className = `message-row ${isMine ? 'outgoing' : 'incoming'}`;
    const duration = message.media_duration_seconds ?? 0;
    const durationLabel = `0:${String(duration).padStart(2, '0')}`;
    bubble.innerHTML = `
      <div class="message-bubble voice-note-bubble">
        <button type="button" class="voice-play-btn">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <div class="voice-note-track">
          <div class="voice-note-bar"><div class="voice-note-fill"></div></div>
          <div class="voice-note-times"><span>0:00</span><span>${durationLabel}</span></div>
        </div>
      </div>
    `;
    const playBtn = bubble.querySelector('.voice-play-btn');
    const audio = new Audio(message.media_url);
    playBtn?.addEventListener('click', () => {
      audio.paused ? audio.play() : audio.pause();
    });
    return bubble;
  }

  bubble.className = `message-row ${isMine ? 'outgoing' : 'incoming'}`;
  const wrapper = document.createElement('div');
  wrapper.className = 'message-bubble';
  wrapper.textContent = message.content || '';
  bubble.appendChild(wrapper);
  return bubble;
}

async function openThread(conversationId, otherUserId, otherUserName, otherUserAvatar) {
  if (activeChannel) {
    supabase.removeChannel(activeChannel);
    activeChannel = null;
  }

  openConversationId = conversationId;
  openOtherUserId = otherUserId;

  const headerName = document.getElementById('dm-active-name');
  if (headerName) headerName.textContent = otherUserName;

  const headerAvatar = document.getElementById('dm-active-avatar');
  if (headerAvatar) headerAvatar.src = otherUserAvatar || `https://placehold.co/80x80/1a1625/f2ede4?text=${otherUserName[0].toUpperCase()}`;

  document.getElementById('chat-view-drawer')?.classList.add('is-active');

  if (!threadContainer) return;
  threadContainer.innerHTML = '';

  const messages = await getMessages(conversationId);
  messages.forEach((m) => threadContainer.appendChild(buildMessageBubble(m)));
  threadContainer.scrollTop = threadContainer.scrollHeight;

  await markConversationRead(conversationId, currentUserId);

  activeChannel = subscribeToMessages(conversationId, (newMessage) => {
    threadContainer.appendChild(buildMessageBubble(newMessage));
    threadContainer.scrollTop = threadContainer.scrollHeight;
    if (newMessage.sender_id !== currentUserId) {
      markConversationRead(conversationId, currentUserId);
    }
  });
}

async function handleSend() {
  const text = messageInput?.value.trim();
  if (!text || !openConversationId) return;

  messageInput.value = '';
  try {
    await sendMessage({
      conversationId: openConversationId,
      senderId: currentUserId,
      content: text,
    });
    await recordFriendInteraction(openOtherUserId);
    // No manual DOM append here -- the realtime subscription above
    // handles rendering the sent message when it echoes back.
  } catch (err) {
    console.error('Send failed:', err);
    messageInput.value = text; // restore on failure
  }
}

sendBtn?.addEventListener('click', handleSend);
messageInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleSend();
});

(async () => {
  const session = await requireAuth();
  if (!session) return;
  const profile = await requireProfile(session);
  if (!profile) return;

  currentUserId = session.user.id;
  await renderConversationList();

  // Note: does NOT auto-open a thread on load. The thread view is a
  // full-screen overlay here (not an inline split view), so
  // auto-opening would hijack the screen on every page load regardless
  // of which tab is active. Left closed until a row is tapped.
})();

document.addEventListener('kaidra:open-conversation', async (e) => {
  const { conversationId, otherUserId, otherUserName, otherUserAvatar } = e.detail;
  await openThread(conversationId, otherUserId, otherUserName, otherUserAvatar);
  await renderConversationList();
});
