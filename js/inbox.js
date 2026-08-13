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
  row.className =
    'conversation-row glass-panel p-3.5 rounded-2xl border border-slate-800 hover:border-violet-500/40 transition-all cursor-pointer flex items-center gap-3.5';
  row.dataset.conversationId = convo.conversationId;
  row.dataset.otherUserId = convo.otherUserId;

  const name = convo.profile?.display_name || convo.profile?.username || 'Unknown';
  const avatarUrl = convo.profile?.avatar_url || 'https://placehold.co/120x120/1a1625/f2ede4?text=' + name[0];
  const preview = convo.lastMessage?.content || 'Say hi 👋';
  const time = formatRelativeTime(convo.lastMessage?.created_at);

  row.innerHTML = `
    <div class="relative">
      <img src="${avatarUrl}" alt="${name}" class="conversation-avatar w-12 h-12 rounded-full object-cover border border-slate-700" />
      ${convo.hasActiveSotd ? '<span class="sotd-indicator absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-violet-600 text-[9px] text-white flex items-center justify-center border border-slate-900">🎵</span>' : ''}
      ${convo.streak > 0 ? `<span class="streak-badge absolute -top-1 -left-1 px-1 py-0.2 bg-amber-500 text-[9px] font-bold text-slate-950 rounded-full flex items-center gap-0.5 shadow-sm">🔥 ${convo.streak}</span>` : ''}
    </div>
    <div class="flex-1 min-w-0">
      <div class="flex items-center justify-between">
        <h4 class="conversation-username text-sm font-semibold text-white truncate">${name}</h4>
        <span class="text-[10px] text-slate-500">${time}</span>
      </div>
      <p class="conversation-preview text-xs text-slate-400 truncate mt-0.5">${preview}</p>
    </div>
    ${convo.unreadCount > 0 ? `<span class="conversation-unread-badge bg-violet-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">${convo.unreadCount}</span>` : ''}
  `;

  row.addEventListener('click', (e) => {
    // Tapping the SOTD indicator badge specifically opens the listen
    // modal with real track data, rather than opening the thread.
    if (e.target.closest('.sotd-indicator')) {
      e.stopPropagation();
      openSotdListenModal(convo.otherUserId, name);
      return;
    }
    openThread(convo.conversationId, convo.otherUserId, name);
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
  const sharedByEl = modal.querySelector('p.text-xs.text-slate-400');

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
    bubble.className = `message-bubble ${isMine ? 'self-end' : 'self-start'} text-3xl p-1`;
    bubble.textContent = message.content;
    return bubble;
  }

  if (message.message_type === 'image') {
    bubble.className = isMine
      ? 'message-bubble self-end bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-2xl rounded-tr-xs p-1.5 max-w-[80%] space-y-1 relative cursor-pointer'
      : 'message-bubble self-start bg-slate-800/90 text-slate-200 rounded-2xl rounded-tl-xs p-1.5 max-w-[80%] space-y-1 relative cursor-pointer';
    const time = new Date(message.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    bubble.innerHTML = `
      <img src="${message.media_url}" alt="Shared image" class="w-full h-36 object-cover rounded-xl" />
      <span class="text-[9px] ${isMine ? 'text-violet-200' : 'text-slate-400'} px-1 py-0.5 block text-right">${time}</span>
    `;
    return bubble;
  }

  if (message.message_type === 'voice_note') {
    bubble.className = isMine
      ? 'message-bubble self-end bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-2xl rounded-tr-xs p-2.5 max-w-[80%] space-y-1'
      : 'message-bubble self-start bg-slate-800/90 text-slate-200 rounded-2xl rounded-tl-xs p-2.5 max-w-[80%] space-y-1';
    const duration = message.media_duration_seconds ?? 0;
    const durationLabel = `0:${String(duration).padStart(2, '0')}`;
    const btnClasses = isMine ? 'bg-white/20 hover:bg-white/30' : 'bg-violet-600 hover:bg-violet-500';
    const barBg = isMine ? 'bg-white/30' : 'bg-slate-700';
    const barFill = isMine ? 'bg-white' : 'bg-violet-400';
    const timeColor = isMine ? 'text-violet-200' : 'text-slate-400';
    bubble.innerHTML = `
      <div class="flex items-center gap-2.5">
        <button type="button" class="voice-play-btn w-8 h-8 rounded-full ${btnClasses} text-white flex items-center justify-center shadow-md cursor-pointer flex-shrink-0">
          <svg class="w-3.5 h-3.5 fill-current ml-0.5" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <div class="flex-1 space-y-1">
          <div class="h-1.5 ${barBg} rounded-full overflow-hidden w-28"><div class="h-full ${barFill} w-0 rounded-full"></div></div>
          <div class="flex items-center justify-between text-[9px] ${timeColor}"><span>0:00</span><span>${durationLabel}</span></div>
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

  bubble.className = isMine
    ? 'message-bubble self-end bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-2xl rounded-tr-xs p-3 text-xs max-w-[85%] space-y-2'
    : 'message-bubble self-start bg-slate-800/90 text-slate-200 rounded-2xl rounded-tl-xs p-3 text-xs max-w-[80%] space-y-1 relative';

  const p = document.createElement('p');
  p.textContent = message.content || '';
  bubble.appendChild(p);
  return bubble;
}

async function openThread(conversationId, otherUserId, otherUserName) {
  if (activeChannel) {
    supabase.removeChannel(activeChannel);
    activeChannel = null;
  }

  openConversationId = conversationId;
  openOtherUserId = otherUserId;

  const headerName = document.querySelector('#view-inbox h4.text-xs.font-semibold.text-white');
  if (headerName) headerName.textContent = otherUserName;

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

  if (conversations.length > 0) {
    const first = conversations[0];
    const name = first.profile?.display_name || first.profile?.username || 'Unknown';
    openThread(first.conversationId, first.otherUserId, name);
  } else if (threadContainer) {
    threadContainer.innerHTML = '<p class="text-sm text-slate-500 text-center py-6">Follow a mutual friend to start chatting.</p>';
  }
})();
