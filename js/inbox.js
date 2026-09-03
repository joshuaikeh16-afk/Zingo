// Real Inbox logic: renders actual conversations, opens real threads,
// sends real messages, and subscribes to realtime updates. Layered on
// top of app.html's existing markup and app.js's UI-only interactivity
// (tab switching, modal toggles) -- this file owns all the Supabase
// data for the Inbox view specifically.

import {
  supabase,
  requireAuth,
  requireProfile,
  getConversationsWithDetails,
  getMessages,
  sendMessage,
  subscribeToMessages,
  markConversationRead,
  recordFriendInteraction,
  getActiveSotdDetails,
  markSotdViewed,
  searchUsers,
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

function buildConversationRow(convo) {
  const row = document.createElement('div');
  row.className = 'conversation-row chat-row';
  row.dataset.conversationId = convo.conversationId;
  row.dataset.otherUserId = convo.otherUserId;

  const name = convo.profile?.display_name || convo.profile?.username || 'Unknown';
  const avatarUrl = convo.profile?.avatar_url || 'https://placehold.co/120x120/1a1625/f2ede4?text=' + name[0];
  const preview = convo.lastMessage?.content || 'Say hi 👋';
  const time = formatRelativeTime(convo.lastMessage?.created_at);

  row.innerHTML = `
    <div class="conversation-avatar-wrap">
      <img src="${avatarUrl}" alt="${name}" class="avatar" />
      ${convo.hasActiveSotd ? '<span class="sotd-indicator">🎵</span>' : ''}
      ${convo.streak > 0 ? `<span class="streak-badge-mini">🔥 ${convo.streak}</span>` : ''}
    </div>
    <div class="chat-meta">
      <div class="chat-name">
        <span>${name}</span>
        <span class="chat-time">${time}</span>
      </div>
      <p class="chat-preview">${preview}</p>
    </div>
    ${convo.unreadCount > 0 ? `<span class="conversation-unread-badge">${convo.unreadCount}</span>` : ''}
  `;

  row.addEventListener('click', (e) => {
    // Tapping the SOTD indicator badge specifically opens the listen
    // modal with real track data, rather than opening the thread.
    if (e.target.closest('.sotd-indicator')) {
      e.stopPropagation();
      openSotdListenModal(convo.otherUserId, name);
      return;
    }
    openThread(convo.conversationId, convo.otherUserId, name, avatarUrl);
  });
  return row;
}

async function openSotdListenModal(senderId, senderName) {
  const modal = document.getElementById('sotd-listen-modal');
  if (!modal) return;

  const sotd = await getActiveSotdDetails(senderId, currentUserId);
  if (!sotd) return;

  const nameEl = modal.querySelector('#sotd-listen-track-name');
  const artistEl = modal.querySelector('#sotd-listen-artist-name');
  const artEl = modal.querySelector('#sotd-listen-album-art');
  const embedContainer = modal.querySelector('#sotd-listen-embed-container');
  const openBtn = modal.querySelector('#sotd-listen-open-spotify-btn');
  const sharedByEl = modal.querySelector('#sotd-listen-shared-by');

  if (nameEl) nameEl.textContent = sotd.track_name;
  if (artistEl) artistEl.textContent = sotd.artist_name;
  if (artEl && sotd.album_art_url) artEl.src = sotd.album_art_url;
  if (sharedByEl) sharedByEl.textContent = `Shared by ${senderName} • ${formatRelativeTime(sotd.created_at)}`;
  if (openBtn) openBtn.href = `https://open.spotify.com/track/${sotd.spotify_track_id}`;
  if (embedContainer) {
    embedContainer.innerHTML = `<iframe class="w-full h-[80px] rounded-xl" src="https://open.spotify.com/embed/track/${sotd.spotify_track_id}?utm_source=generator&theme=0" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>`;
  }

  modal.classList.remove('hidden');
  markSotdViewed(sotd.id, currentUserId);
}

async function renderConversationList() {
  if (!conversationList) return;
  const conversations = await getConversationsWithDetails(currentUserId);

  const heading = conversationList.querySelector('h2');
  const emptyState = document.getElementById('inbox-empty-state');
  conversationList.querySelectorAll('.conversation-row').forEach((el) => el.remove());

  if (conversations.length === 0) {
    emptyState?.classList.remove('hidden');
    emptyState?.classList.add('flex');
  } else {
    emptyState?.classList.add('hidden');
    emptyState?.classList.remove('flex');
    conversations.forEach((c) => conversationList.appendChild(buildConversationRow(c)));
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
  const conversations = await getConversationsWithDetails(currentUserId);

  const emptyState = document.getElementById('inbox-empty-state');
  conversationList?.querySelectorAll('.conversation-row').forEach((el) => el.remove());

  if (conversations.length === 0) {
    emptyState?.classList.remove('hidden');
    emptyState?.classList.add('flex');
  } else {
    emptyState?.classList.add('hidden');
    emptyState?.classList.remove('flex');
    conversations.forEach((c) => conversationList?.appendChild(buildConversationRow(c)));
  }

  // Note: does NOT auto-open the first conversation on load. The
  // thread view is a full-screen overlay here (not an inline split
  // view), so auto-opening would hijack the screen on every page load
  // regardless of which tab is active. Left closed until a row is tapped.
})();

document.addEventListener('kaidra:open-conversation', async (e) => {
  const { conversationId, otherUserId, otherUserName, otherUserAvatar } = e.detail;
  await openThread(conversationId, otherUserId, otherUserName, otherUserAvatar);
  await renderConversationList();
});

// ---------------------------------------------------------------------
// New Chat: search users, start (or resume) a conversation, open it.
// ---------------------------------------------------------------------

const newChatBtn = document.getElementById('new-chat-btn');
const newChatModal = document.getElementById('new-chat-modal');
const newChatInput = document.getElementById('new-chat-search-input');
const newChatResults = document.getElementById('new-chat-results');
const newChatCloseBtn = document.getElementById('new-chat-close-btn');

let newChatDebounceTimer = null;

newChatBtn?.addEventListener('click', () => {
  newChatModal?.classList.remove('hidden');
  newChatInput?.focus();
});

newChatCloseBtn?.addEventListener('click', () => {
  newChatModal?.classList.add('hidden');
  if (newChatInput) newChatInput.value = '';
  if (newChatResults) newChatResults.innerHTML = '';
});

newChatInput?.addEventListener('input', () => {
  clearTimeout(newChatDebounceTimer);
  const query = newChatInput.value;
  newChatDebounceTimer = setTimeout(() => runNewChatSearch(query), 350);
});

async function runNewChatSearch(query) {
  if (!newChatResults) return;
  if (!query || query.trim().length < 2) {
    newChatResults.innerHTML = '<p class="find-friends-hint">Type at least 2 characters to search.</p>';
    return;
  }

  const results = await searchUsers(query, currentUserId);
  newChatResults.innerHTML = '';

  if (results.length === 0) {
    newChatResults.innerHTML = '<p class="find-friends-hint">No users found.</p>';
    return;
  }

  results.forEach((user) => {
    const row = document.createElement('div');
    row.className = 'find-friend-result-row';
    const name = user.display_name || user.username;
    const avatarUrl = user.avatar_url || `https://placehold.co/80x80/1a1625/f2ede4?text=${name[0].toUpperCase()}`;

    row.innerHTML = `
      <img src="${avatarUrl}" alt="${name}" />
      <div class="find-friend-result-info">
        <p class="find-friend-result-name">${name}</p>
        <p class="find-friend-result-handle">@${user.username}</p>
      </div>
      <button type="button" class="friend-request-btn is-active-state">Chat</button>
    `;

    row.querySelector('button').addEventListener('click', async () => {
      const conversationId = await getOrCreateConversation(user.id);
      newChatModal?.classList.add('hidden');
      if (newChatInput) newChatInput.value = '';
      if (newChatResults) newChatResults.innerHTML = '';
      await openThread(conversationId, user.id, name, avatarUrl);
      await renderConversationList();
    });

    newChatResults.appendChild(row);
  });
}
