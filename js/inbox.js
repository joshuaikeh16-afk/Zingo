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

  row.addEventListener('click', () => openThread(convo.conversationId, convo.otherUserId, name));
  return row;
}

async function renderConversationList() {
  if (!conversationList) return;
  const conversations = await getConversationsWithDetails(currentUserId);

  // Clear everything except the heading
  const heading = conversationList.querySelector('h2');
  conversationList.innerHTML = '';
  if (heading) conversationList.appendChild(heading);

  if (conversations.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'text-sm text-slate-500 py-6 text-center';
    empty.textContent = 'No conversations yet.';
    conversationList.appendChild(empty);
    return;
  }

  conversations.forEach((c) => conversationList.appendChild(buildConversationRow(c)));
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

  // Render list (reuses the same fetch result rather than calling
  // getConversationsWithDetails twice)
  const heading = conversationList?.querySelector('h2');
  if (conversationList) {
    conversationList.innerHTML = '';
    if (heading) conversationList.appendChild(heading);
    if (conversations.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'text-sm text-slate-500 py-6 text-center';
      empty.textContent = 'No conversations yet.';
      conversationList.appendChild(empty);
    } else {
      conversations.forEach((c) => conversationList.appendChild(buildConversationRow(c)));
    }
  }

  if (conversations.length > 0) {
    const first = conversations[0];
    const name = first.profile?.display_name || first.profile?.username || 'Unknown';
    openThread(first.conversationId, first.otherUserId, name);
  } else if (threadContainer) {
    // No conversations at all -- clear the static demo messages rather
    // than leaving fake content visible with nothing real to show yet.
    threadContainer.innerHTML = '<p class="text-sm text-slate-500 text-center py-6">Follow a mutual friend to start chatting.</p>';
  }
})();
