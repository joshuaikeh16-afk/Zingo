import { appendBattleConflict, challengeError } from './battle-challenge.js';
import { installMediaRenderers, uploadMedia, mediaPicker, stickerPicker, mediaBucket } from './chat-media.js';
import { forfeitInConversation } from './combat-commands.js';
import { challengeTarget } from './challenge-target.js';
import { awakenBattleIdentity } from './awakening.js';
import { discussionCard, swipeToReply, typingPresence, receipt } from './chat-interactions.js';
import { bindContext, openMenu, openReactions, dialog, confirmAction } from './context-menu.js';
import { contentActions } from './content-actions.js';
import { createPoll, pollCard } from './chat-polls.js';
import { supabase, getInbox, getMessages, getOrCreateConversation, getMutualFriends, sendMessage, uploadVoiceNote, uploadChatImage, subscribeToMessages, subscribeToInboxUpdates, getChatState, subscribeToChatInteractions, chatAction, getSignedMediaUrl, recordFriendInteraction } from './supabase-client.js';
import { account } from './session.js';
import { element, avatar, setAvatar, actionButton, iconButton, skeletons, emptyState, showError, notify, navigate, viewProfile, openModal, closeModal, syncOverlay, topModal } from './ui.js';
import { mergeMessage, sortedMessages, messagePreview } from './message-state.js';
import { richCard } from './content-view.js';
import { installGroups, groupAllowed } from './chat-groups.js';
import { unreadTotal } from './unread-state.js';
import { installVoiceNotes } from './voice-notes.js';
import { parseRoute } from './router.js';
import { registerMessageContent, renderMessageContent } from './message-content.js';
import {battleCard,relationshipCard,startChallenge,reportMessage} from './social.js';

const list = document.getElementById('conversation-list'), thread = document.getElementById('message-thread-container'), input = document.getElementById('message-text-input'), drawer = document.getElementById('chat-view-drawer');
let userId, active, rows = [], filter = 'all', listVersion = 0, pickerVersion = 0, inboxChannel, poll, sharedDraft = null, replyDraft = null;
let voiceBusy = false, discussionMode = false;
const time = value => value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
function syncComposer() {
  const blocked=!active || active.isGroup&&!groupAllowed(active,userId,'send_messages'),hasText=!!(input.value.trim()||sharedDraft),send=document.getElementById('message-send-btn'),mic=document.getElementById('voice-record-btn');
  send.disabled=voiceBusy||blocked||!hasText;send.classList.toggle('hidden',!hasText);mic.classList.toggle('hidden',hasText);mic.disabled=voiceBusy||blocked||mic.dataset.unsupported==='true';
  input.disabled=voiceBusy||blocked;input.placeholder=blocked?'Only admins can send messages':discussionMode?'Make a statement people can agree or disagree with...':'Message';
  for(const id of ['composer-plus','composer-attachment','composer-camera','composer-stickers'])document.getElementById(id).disabled=voiceBusy||blocked;
}
function status(id, value) { const node = document.getElementById(id); node.textContent = value; node.classList.toggle('is-live', value === 'Connected'); }
function renderList() {
  const visibleRows = rows;
  const query = document.getElementById('inbox-search').value.trim().toLowerCase();
  const shown = visibleRows.filter(row => (filter !== 'unread' || row.unreadCount) && `${row.profile.display_name} ${row.profile.username} ${messagePreview(row.lastMessage)}`.toLowerCase().includes(query));
  list.replaceChildren();
  for (const row of shown) {
    const button = element('button', `conversation-row${row.unreadCount ? ' has-unread' : ''}${active?.id === row.conversationId ? ' is-selected' : ''}`); button.type = 'button';
    const copy = element('span', 'chat-meta'), heading = element('span', 'chat-name'); heading.append(element('strong', '', row.profile.display_name || row.profile.username), element('small', 'chat-time', time(row.lastMessage?.created_at)));
    copy.append(heading, element('span', 'chat-preview', messagePreview(row.lastMessage))); button.append(avatar(row.profile, `avatar${row.isGroup ? ' group-avatar' : ''}`), copy);
    if (row.mentionCount && row.unreadCount) button.append(element('span', 'mention-badge', '@'));
    if (row.unreadCount) button.append(element('span', 'conversation-unread-badge', String(row.unreadCount)));
    button.addEventListener('click', () => openThread(row.conversationId, row.profile, row.isGroup)); list.append(button);
  }
  const unread = unreadTotal(visibleRows);
  document.dispatchEvent(new CustomEvent('kaidra:unread-data', { detail: { rows: visibleRows, count: unread } }));
  for (const id of ['nav-inbox-count', 'sidebar-inbox-count', 'inbox-unread-count']) { const badge = document.getElementById(id); if (badge) { badge.textContent = String(unread); badge.classList.toggle('hidden', !unread); } }
  document.querySelectorAll('[data-tab="inbox"]').forEach(button => button.setAttribute('aria-label', unread ? `Inbox, ${unread} unread messages` : 'Inbox'));
  const empty = document.getElementById('inbox-empty-state'); empty.classList.toggle('hidden', shown.length > 0);
  empty.querySelector('h3').textContent = query ? 'No conversations found' : filter === 'unread' ? 'No unread messages' : 'No conversations yet';
  list.setAttribute('aria-busy', 'false');
}
async function refreshList() {
  if (!userId) return; const version = ++listVersion;
  try { const result = await getInbox(userId); if (version !== listVersion) return; rows = result; renderList(); showError('inbox-error'); document.dispatchEvent(new CustomEvent('kaidra:inbox-data', { detail: { rows } })); }
  catch { if (version === listVersion) { list.setAttribute('aria-busy', 'false'); if (!rows.length) list.replaceChildren(emptyState('Your conversations could not load.', 'Check your connection and try again.', 'chat', { label: 'Try again', run: refreshList })); showError('inbox-error', 'Could not refresh your conversations. We’ll try again shortly.'); } }
}
async function refreshState(state = active) {
  if (!state) return;
  const version = state.stateVersion = (state.stateVersion || 0) + 1;
  let data;
  try { data = await getChatState(state.id, [...state.messages.keys()].filter(id => /^[0-9a-f-]{36}$/i.test(id))); }
  catch (error) { if (active === state && /Membership required|Group unavailable/i.test(error.message || '')) { for (const modal of [...document.querySelectorAll('.social-modal[data-conversation-id]')].reverse()) if (modal.dataset.conversationId === state.id) closeModal(modal.id); closeModal('chat-info-modal'); closeModal('new-chat-modal'); navigate('inbox'); notify('You no longer have access to this conversation.'); } throw error; }
  if (active !== state || version !== state.stateVersion) return;
  Object.assign(state, { members: data.members || [], reactions: data.reactions || [], reads: data.reads || [], polls: data.polls || [], pins: data.pins || [], quotes: data.quotes || [], discussions: data.discussions || [], deliveries: data.deliveries || [], permissions: data.conversation.permissions || {}, description: data.conversation.description, extended: data.extended, isGroup: !!data.conversation.is_group, createdBy: data.conversation.created_by });
  const revision=data.conversation.typing_revision;
  if(revision&&state.typingRevision!==revision){state.typing?.close();state.typingRevision=revision;state.typing=typingPresence(state.id,userId,()=>state.members,text=>{if(active===state)document.getElementById('chat-typing-status').textContent=text;},revision);}
  if (data.conversation.title) state.profile.display_name = data.conversation.title;
  if (state.isGroup) { state.profile.avatar_url = data.conversation.avatar_url; setAvatar(document.getElementById('dm-active-avatar'), state.profile); }
  document.getElementById('dm-active-name').textContent = state.profile.display_name || state.profile.username;
  document.getElementById('chat-member-count').textContent = state.isGroup ? `${state.members.length} people` : '';
  const pins = document.getElementById('chat-pins'); pins.classList.toggle('hidden', !state.pins.length); pins.textContent = `${state.pins.length} pinned ${state.pins.length === 1 ? 'message' : 'messages'}`;
  syncComposer(); renderMessages(state); document.dispatchEvent(new CustomEvent('kaidra:chat-state', {detail:{id:state.id}}));

}
async function snapshot(state) {
  try {
    const messages = await getMessages(state.id); if (active !== state) return;
    const received=new Set(messages.map(message=>message.id)),oldest=messages[0]?.created_at;
    for(const [id,stored] of state.messages)if(!stored.localState&&!received.has(id)&&(messages.length<100||stored.created_at>=oldest)){state.messages.delete(id);state.nodes.delete(id);}
    for (const message of messages) mergeMessage(state.messages, message); state.hasOlder = messages.length === 100; state.loading = false; renderMessages(state);
    acknowledgeDelivery(state); acknowledge(state);
  } catch { if (active === state) { state.loading = false; thread.setAttribute('aria-busy', 'false'); if (!state.messages.size) thread.replaceChildren(emptyState('Messages could not load.', 'Your conversation is still here. Please try again.', 'chat', { label: 'Try again', run: () => snapshot(state) })); showError('chat-error', 'Could not load messages. Reconnecting and trying again…'); } }
}
function closeThread() {
  if(active)for(const modal of [...document.querySelectorAll('.social-modal[data-conversation-id]')].reverse())if(modal.dataset.conversationId===active.id)closeModal(modal.id);
  voiceNotes.cancel(); active?.typing?.close(); discussionMode = false;
  if (active) { supabase.removeChannel(active.channel); if (active.interactions) supabase.removeChannel(active.interactions); }
  if (active) for (const message of active.messages.values()) if (message.localVoiceUrl) URL.revokeObjectURL(message.localVoiceUrl);
  active = null; thread.replaceChildren(); delete drawer.dataset.conversationId; document.getElementById('dm-active-name').textContent=''; document.getElementById('chat-member-count').textContent=''; document.getElementById('chat-pins').classList.add('hidden'); drawer.classList.remove('is-active'); sharedDraft = null; replyDraft = null; renderDraft(); syncOverlay(); renderList();
}
async function openThread(id, profile, isGroup = false) {
  if (active?.id === id) return;
  navigate(`inbox/${id}`); closeThread();
  const state = active = { initialUnread: rows.find(row => row.conversationId === id)?.unreadCount || 0, id, profile: { ...profile }, isGroup, messages: new Map(), nodes: new Map(), members: [], reactions: [], reads: [], extended: false, loading: true, hasOlder: false };
  drawer.dataset.conversationId = id;
  input.value = ''; input.style.height = ''; showError('chat-error'); thread.replaceChildren(); skeletons(thread, 'person', 3);
  setAvatar(document.getElementById('dm-active-avatar'), profile); document.getElementById('dm-active-name').textContent = profile.display_name || profile.username;
  drawer.classList.add('is-active'); syncOverlay(); renderList(); status('chat-connection-status', 'Connecting…');
  state.channel = subscribeToMessages(id, message => {
    if (active !== state) return; const arrived = !state.messages.has(message.id) && !state.loading; mergeMessage(state.messages, { ...message, localState: null }); renderMessages(state); if (arrived) state.nodes.get(message.id)?.classList.add('is-new'); refreshList();
    if (message.sender_id !== userId) { acknowledgeDelivery(state); acknowledge(state); }
  }, connection => {
    if (active !== state) return;
    const live = ['SUBSCRIBED', 'LIVE'].includes(connection); status('chat-connection-status', live ? 'Connected' : 'Reconnecting…');
    if (live) { snapshot(state); refreshState(state).catch(() => {}); }
  });
  state.interactions = subscribeToChatInteractions(id, () => refreshState(state).catch(() => {}));
  await Promise.allSettled([snapshot(state), refreshState(state)]); if (active === state && innerWidth >= 1100) input.focus({ preventScroll: true });
}
async function acknowledgeDelivery(state) {
 if (!state || active !== state || state.loading) return;
 state.deliveredIds ||= new Set();
 const ids = sortedMessages(state.messages).filter(m => m.sender_id !== userId && !m.localState && !state.deliveredIds.has(m.id)).map(m => m.id).slice(0,1000);
 if (!ids.length) return; ids.forEach(id => state.deliveredIds.add(id));
 try { await chatAction('kaidra_message_ack', {target_conversation:state.id,message_ids:ids,seen:false}); acknowledgeDelivery(state); }
 catch { ids.forEach(id => state.deliveredIds.delete(id)); }
}
async function acknowledge(state) {
 if (!state || active !== state || state.loading || document.hidden || topModal() || state.readPending) return;
 const box = thread.getBoundingClientRect(); state.seenIds ||= new Set();
 const ids = sortedMessages(state.messages).filter(message => {
  if (message.sender_id===userId || message.localState || state.seenIds.has(message.id)) return false;
  const node=state.nodes.get(message.id); if(!node)return false;
  const rect=node.getBoundingClientRect();return Math.min(rect.bottom,box.bottom)-Math.max(rect.top,box.top)>=Math.min(40,rect.height*.6);
 }).map(m=>m.id);
 if(!ids.length)return;
 state.readPending=true;let saved=false;
 try {await chatAction('kaidra_message_ack',{target_conversation:state.id,message_ids:ids.slice(-1000),seen:true});ids.forEach(id=>state.seenIds.add(id));saved=true;if(state.readFailure&&active===state)showError('chat-error');state.readFailure=false;if(active===state)await refreshList();}
 catch {state.readFailure=true;if(active===state)showError('chat-error',"Couldn't save read receipts. We'll retry when connected.");}
 finally {state.readPending=false;if(saved)requestAnimationFrame(()=>acknowledge(state));}
}

function textContent(bubble, text, members, mentionIds = [], mentionLabels = []) {
  const tokens = String(text || '').split(/(@[a-zA-Z0-9_]+|https?:\/\/[^\s]+)/g);
  for (const token of tokens) {
    const saved = mentionLabels.find(label => label.username?.toLowerCase() === token.slice(1).toLowerCase());
    const member = token.startsWith('@') && (saved ? {id:saved.user_id} : members.find(person => mentionIds.includes(person.id) && person.username?.toLowerCase() === token.slice(1).toLowerCase()));
    if (member) { const button = element('button', 'message-mention', token); button.type = 'button'; button.addEventListener('click', () => viewProfile(member.id)); bubble.append(button); }
    else if (/^https?:\/\//.test(token)) { const link = element('a', 'message-link', token); link.href = token; link.target = '_blank'; link.rel = 'noopener noreferrer'; bubble.append(link); }
    else bubble.append(document.createTextNode(token));
  }
}
for (const type of ['text']) registerMessageContent(type, (message, context) => {
  if (!message.content) return null;
  const bubble = element('div', 'message-bubble'); textContent(bubble, message.content, context.members, message.mention_ids, message.mention_labels); return bubble;
});
installMediaRenderers();
function buildMessage(message, state, consecutive = false) {
  if (message.message_type === 'system') { const row = message.event_data?.kind==='battle'?battleCard(message.event_data.battle_id):message.event_data?.kind==='relationship'?relationshipCard(message.event_data.relationship_id):element('div', 'system-message', message.content); row.dataset.messageId = message.id; return row; }
  const mine = message.sender_id === userId, row = element('article', `message-row${consecutive ? ' is-consecutive' : ''} ${mine ? 'outgoing' : 'incoming'}${message.localState ? ` is-${message.localState}` : ''}`); row.dataset.messageId = message.id;row.dataset.messageType=message.message_type;
  const member=state.members.find(person=>person.id===message.sender_id);const palette=['#85d7c0','#c3adfa','#e8c084','#94c9f0','#f1a5bf','#a7d88e'];let hue=0;for(const character of String(message.sender_id||'member'))hue=(hue*31+character.charCodeAt(0))>>>0;row.style.setProperty('--message-author-color',palette[hue%palette.length]);
  if(state.isGroup&&!mine&&!consecutive){const photo=avatar(member||{},'message-sender-avatar');const profile=element('button','message-sender-profile');profile.type='button';profile.setAttribute('aria-label',`View ${member?.display_name||member?.username||'member'}`);profile.append(photo);profile.addEventListener('click',()=>viewProfile(message.sender_id));row.append(profile);}
  if(state.isGroup&&!mine)row.classList.add('group-message');
  if (state.isGroup && !mine && !consecutive) { const member = state.members.find(person => person.id === message.sender_id); row.append(element('span', 'message-author', member?.display_name || member?.username || 'Member')); }
  if (message.deleted_at) { row.append(element('p','deleted-message','Message deleted')); return row; }
  if (message.external_ref_id) {
    const original = state.messages.get(message.external_ref_id) || state.quotes?.find(item => item.id === message.external_ref_id);
    const quote = element('button', 'reply-quote'); quote.type = 'button';
    const author = state.members.find(member => member.id === original?.sender_id);
    quote.append(element('strong', '', original?.sender_id===userId?'You':author?.display_name || author?.username || 'Original message'), element('span', '', original ? messagePreview(original) : 'View original message'));
    quote.addEventListener('click', () => jumpToMessage(message.external_ref_id)); row.append(quote);
  }
  if (message.shared_content) row.append(richCard(message.shared_content, true));
  const contentNode = message.message_type === 'discussion' ? discussionCard(message, state, userId, refreshState) : message.message_type === 'poll' ? pollCard(message, state, userId, refreshState) : renderMessageContent(message, { members: state.members });
  if(message.message_type==='discussion'&&message.sports_context)contentNode.prepend(richCard(message.sports_context,true));
  if (contentNode) row.append(contentNode);
  else if (!message.shared_content) row.append(element('p', 'muted', 'This message format is unavailable.'));
  const stamp=element('small','message-time',`${time(message.created_at)}${message.edited_at?' · edited':''}`);
  if(mine){const status=receipt(message,state,userId),mark=element('span',`message-receipt${status.read?' is-read':''}`,status.text);mark.title=status.label;mark.setAttribute('aria-label',status.label);stamp.append(document.createTextNode(' '),mark);}
  row.append(stamp);
  if(!message.localState&&['image','video','sticker'].includes(message.message_type)) {const forward=iconButton('forward','Forward '+messagePreview(message));forward.classList.add('media-forward');forward.addEventListener('click',()=>chooseConversation(null,'',message));row.append(forward);}

  if (message.localState === 'failed') { const retry = actionButton('Retry message', 'refresh', 'message-retry'); retry.addEventListener('click', () => deliver(state, message)); row.append(retry); }
  if (!message.localState) {
    const reply = () => { replyDraft = message; renderDraft(); input.focus(); };
    const actionsForMessage = () => [
      { label: 'Reply', icon: 'reply', run: reply },
      { label: 'React', icon: 'smile', run: () => reactPicker(row, message, state) },
      message.message_type==='discussion' && state.discussions?.find(item=>item.message_id===message.id)?.opponents?.length && {label:'Challenge',icon:'spark',run:()=>startChallenge({conversationId:state.id,discussionMessage:message,opponents:state.discussions.find(item=>item.message_id===message.id).opponents})},
      message.sender_id===userId && ['text','discussion'].includes(message.message_type) && !message.discussion_locked_at && {label:'Edit',icon:'edit',run:()=>editMessage(message,state)},
      message.sender_id===userId && {label:'Delete',icon:'trash',danger:true,run:async()=>{if(await confirmAction('Delete message?','This removes the message content for everyone.','Delete')){await chatAction('kaidra_message_change',{target_message:message.id,action:'delete'});await snapshot(state);}}},
      message.sender_id!==userId&&{label:'Report message',icon:'info',run:()=>reportMessage(message)},
      message.content && ['text','discussion','sticker'].includes(message.message_type) && { label: 'Copy text', icon: 'copy', run: () => navigator.clipboard.writeText(message.content).then(() => notify('Copied')) },
      (message.shared_content || ['text','discussion','image','voice_note','sticker','video','document'].includes(message.message_type)) && { label: 'Forward', icon: 'share', run: () => chooseConversation(message.shared_content || null, message.shared_content ? '' : ['text','discussion'].includes(message.message_type) ? message.content : '', ['image','voice_note','sticker','video','document'].includes(message.message_type) ? message : null) },
      groupAllowed(state, userId, 'pin_messages') && { label: state.pins?.some(pin => pin.id === message.id) ? 'Unpin message' : 'Pin message', icon: 'pin', run: async () => { await chatAction('kaidra_pin', { target_message: message.id, pinned: !state.pins?.some(pin => pin.id === message.id) }); await refreshState(state); } },
      ...(message.shared_content ? contentActions(message.shared_content).slice(0, 2) : []),
    ];
    bindContext(row, actionsForMessage, { title: 'Message actions' }); swipeToReply(row, reply);
    const actions = element('div', 'message-actions'), reactButton = iconButton('smile', 'React to message'), replyButton = iconButton('reply', 'Reply to message'), more = iconButton('more', 'More message actions');
    reactButton.addEventListener('click', () => reactPicker(reactButton, message, state)); replyButton.addEventListener('click', reply); more.addEventListener('click', () => openMenu(more, actionsForMessage(), 'Message actions'));
    actions.append(reactButton, replyButton, more); row.append(actions);
  }
  const reactions = state.reactions.filter(reaction => reaction.message_id === message.id && reaction.emoji);
  if (reactions.length) { const summary = element('div', 'reaction-summary'); for (const emoji of [...new Set(reactions.map(reaction => reaction.emoji))]) { const matching = reactions.filter(reaction => reaction.emoji === emoji); const button = element('button', `reaction-pill${matching.some(reaction => reaction.user_id === userId) ? ' mine' : ''}`, `${emoji} ${matching.length}`); button.type = 'button'; button.title = matching.map(reaction => state.members.find(member => member.id === reaction.user_id)?.display_name || 'Member').join(', '); button.addEventListener('click', async () => { try { await chatAction('kaidra_react', { target_message: message.id, reaction: emoji }); await refreshState(state); } catch { notify('Could not update your reaction.'); } }); summary.append(button); } row.append(summary); }
  return row;
}
document.addEventListener('kaidra:social-refresh',()=>{if(active&&!active.loading){const state=active;refreshList();snapshot(state).catch(()=>{});}});
function renderMessages(state) {
  if (!state || active !== state || state.loading) return;
  if(thread.querySelector('[data-gesture-active]')){state.pendingRender=true;return;}state.pendingRender=false;
  const stick = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 100, previousTop = thread.scrollTop;
  thread.setAttribute('aria-busy', 'false'); const messages = sortedMessages(state.messages), children = [];
  if (state.unreadStart === undefined && state.initialUnread) state.unreadStart = messages.filter(item => item.sender_id !== userId).slice(-state.initialUnread)[0]?.id || null;
  if (state.hasOlder) { const older = actionButton('Load earlier messages', 'arrow', 'load-older'); older.addEventListener('click', async () => { older.disabled = true; try { const height = thread.scrollHeight, batch = await getMessages(state.id, messages[0]); if (active !== state) return; batch.forEach(message => mergeMessage(state.messages, message)); acknowledgeDelivery(state); state.hasOlder = batch.length === 100; renderMessages(state); thread.scrollTop += thread.scrollHeight - height; } catch { notify('Could not load earlier messages.'); older.disabled = false; } }); children.push(older); }
  let date;
  for (const message of messages) {
    const day = new Date(message.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' }); if (day !== date) { children.push(element('div', 'chat-date-divider', day)); date = day; }
    if (message.id === state.unreadStart) children.push(element('div', 'chat-unread-divider', 'Unread messages'));
    const previous = messages[messages.indexOf(message) - 1], consecutive = previous?.sender_id === message.sender_id && previous.message_type !== 'system' && new Date(previous.created_at).toDateString()===new Date(message.created_at).toDateString() && (new Date(message.created_at) - new Date(previous.created_at)) < 300000;
    const signature = JSON.stringify([message, consecutive, state.polls, state.pins, state.quotes, state.members, state.reactions.filter(item => item.message_id === message.id), state.reads.filter(item => item.message_id === message.id), state.deliveries?.filter(item => item.message_id === message.id), state.discussions?.find(item => item.message_id === message.id), state.extended]);
    let node = state.nodes.get(message.id); if (!node || node.dataset.signature !== signature) { node = buildMessage(message, state, consecutive); node.dataset.signature = signature; state.nodes.set(message.id, node); }
    children.push(node);
  }
  if (!messages.length) children.push(element('p', 'thread-empty', 'Your conversation starts with a hello.'));
  const wanted=new Set(children);for(const node of [...thread.children])if(!wanted.has(node))node.remove();children.forEach((node,index)=>{const current=thread.children[index];if(current!==node)thread.insertBefore(node,current||null);}); if (stick || state.firstRender !== false) thread.scrollTop = thread.scrollHeight; else thread.scrollTop = previousTop; state.firstRender = false; syncJump(); requestAnimationFrame(() => acknowledge(state));
}
async function deliver(state, message) {
  if (message.localState === 'sending') return; message.localState = 'sending'; state.messages.set(message.id, message); renderMessages(state); if(active===state)thread.scrollTop=thread.scrollHeight;
  try {
    if (message.message_type === 'voice_note' && !message.media_url) {
      message.media_url = await uploadVoiceNote(state.id, message.localVoiceBlob, message.id); message.content = message.media_url;
    }
    const saved = await sendMessage({ id: message.id, conversationId: state.id, senderId: userId, content: message.content, messageType: message.message_type, mediaUrl: message.media_url, duration: message.media_duration_seconds, mediaMetadata: message.media_metadata, sharedContent: message.shared_content, replyTo: message.external_ref_id, mentionIds: message.mention_ids || [] });
    mergeMessage(state.messages, { ...saved, localState: null, localVoiceBlob: null }); if (!state.isGroup) recordFriendInteraction(state.profile.id).catch(() => {}); if (active === state) { showError('chat-error'); renderMessages(state); } refreshList();
  }
  catch { const current = state.messages.get(message.id); if (current?.localState) { current.localState = 'failed'; renderMessages(state); } }
}
function renderDraft() {
  syncComposer();
  const mode = document.getElementById('discussion-mode'); mode.classList.toggle('hidden',!discussionMode);
  const target = document.getElementById('share-draft-preview'); target.replaceChildren(); target.classList.toggle('hidden', !sharedDraft && !replyDraft);
  if (sharedDraft) target.append(richCard(sharedDraft, true)); if (replyDraft) {const quote=element('div','reply-draft');quote.append(element('strong','',`Replying to ${active?.members.find(member => member.id === replyDraft.sender_id)?.display_name || active?.members.find(member => member.id === replyDraft.sender_id)?.username || 'message'}`),element('span','',messagePreview(replyDraft)));target.append(quote);}
  if (sharedDraft || replyDraft) { const cancel = iconButton('close', 'Remove draft'); cancel.addEventListener('click', () => { sharedDraft = null; replyDraft = null; renderDraft(); }); target.append(cancel); }
}
document.getElementById('message-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!active || !userId || voiceBusy) return; let content = input.value.trim(); if (!content && !sharedDraft) return;
  if (/^\.challenge(?:\s|$)/i.test(content)) { const state=active;try{const challenge=challengeTarget(content,{members:state.members,userId,isGroup:state.isGroup});if(!await awakenBattleIdentity())return;const args={target_conversation:state.id,target_user:challenge.id,topic:challenge.flavour,stance:'',context:{entry_type:'direct'}},key=JSON.stringify(args);if(state.challengeRequest?.key!==key)state.challengeRequest={key,id:crypto.randomUUID()};await chatAction('kaidra_battle_create',{...args,request_id:state.challengeRequest.id});state.challengeRequest=null;input.value='';state.typing?.stop();renderDraft();await snapshot(state);}catch(error){if(active===state){showError('chat-error',challengeError(error));appendBattleConflict(document.getElementById('chat-error'),error);}}return;}
  if(/^\.forfeit(?:\s|$)/i.test(content)){if(content.trim().toLowerCase()!=='.forfeit'){showError('chat-error','Use .forfeit to concede your own fighter.');return;}try{await forfeitInConversation(active.id);input.value='';active.typing?.stop();await snapshot(active);}catch(error){showError('chat-error',error.message||'Could not forfeit.');}return;}
  const command=content.match(/^\.discuss(?:\s+([\s\S]*))?$/i); if(command){content=(command[1]||'').trim();if(!content){showError('chat-error','Add a statement after .discuss.');return;}}
  const isDiscussion=discussionMode||!!command; if(isDiscussion&&sharedDraft){showError('chat-error','Send the shared title separately from your discussion.');return;}
  if (content.length > 4000) { showError('chat-error', 'Keep your message under 4,000 characters.'); return; }
  const message = { id: crypto.randomUUID(), conversation_id: active.id, sender_id: userId, content, message_type: isDiscussion ? 'discussion' : 'text', shared_content: sharedDraft, external_ref_id: replyDraft?.id || null, mention_ids: (active.isGroup ? active.members || [] : []).filter(member => content.split(/\s+/).some(word => word.replace(/[.,!?;:]+$/, '') === `@${member.username}`)).map(member => member.id), created_at: new Date().toISOString(), localState: 'queued' };
  input.value = ''; input.style.height = ''; active.typing?.stop(); discussionMode = false; sharedDraft = null; replyDraft = null; renderDraft(); document.getElementById('mention-suggestions').classList.add('hidden'); deliver(active, message);
});
input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); document.getElementById('message-form').requestSubmit(); } });
input.addEventListener('input', () => {
  syncComposer(); active?.typing?.update(input.value);
  const stick=thread.scrollHeight-thread.scrollTop-thread.clientHeight<100;input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 140)}px`;if(stick)thread.scrollTop=thread.scrollHeight;
  const target = document.getElementById('mention-suggestions'), match = input.value.slice(0, input.selectionStart).match(/(?:^|\s)@([a-zA-Z0-9_]*)$/);
  const matches = match && active?.isGroup ? (active?.members || []).filter(member => member.id !== userId && member.username?.toLowerCase().startsWith(match[1].toLowerCase())).slice(0, 5) : [];
  target.classList.toggle('hidden', !matches.length); target.replaceChildren(...matches.map(member => { const button = element('button', '', `@${member.username}`); button.type = 'button'; button.prepend(avatar(member)); button.addEventListener('click', () => { const cursor = input.selectionStart, start = cursor - match[1].length - 1, replacement = `@${member.username} `; input.value = input.value.slice(0, start) + replacement + input.value.slice(cursor); input.focus(); input.setSelectionRange(start + replacement.length, start + replacement.length); target.classList.add('hidden'); syncComposer(); }); return button; }));
});
async function chooseConversation(content = null, text = '', sourceMessage = null, discussionContext = null) {
  if (!userId) return; const version = ++pickerVersion, sharing = !!(content || text || sourceMessage);
  closeModal('content-detail-modal'); openModal('new-chat-modal');
  document.getElementById('new-chat-title').textContent = sharing ? 'Send to…' : 'New conversation';
  document.getElementById('chat-picker-description').textContent = sharing ? 'Choose a destination to send this now.' : 'Find your people.';
  const target = document.getElementById('new-chat-list'); target.replaceChildren();
  if (content) target.append(richCard(content, true)); else if (text) target.append(element('p', 'share-text-preview', text));else if(sourceMessage)target.append(element('p','share-text-preview',`Forward ${messagePreview(sourceMessage)}`));
  const search = element('input'), tabs = element('div', 'library-tabs'), results = element('div', 'people-list'); search.type = 'search'; search.placeholder = 'Search conversations or people'; search.setAttribute('aria-label', search.placeholder);
  let category = 'recent', friends = [], sending = false; const requestIds = new Map();
  if (!sharing) { const group = actionButton('New group', 'people'); group.addEventListener('click', () => { closeModal('new-chat-modal'); groups.createGroup(); }); target.append(group); }
  target.append(search, tabs, results); skeletons(results, 'person', 3);
  function render() {
    results.replaceChildren();
    const people = friends.map(profile => ({ ...profile, conversationId: rows.find(row => !row.isGroup && row.profile.id === profile.id)?.conversationId }));
    const choices = category === 'people' ? people : rows.filter(row => category !== 'groups' || row.isGroup).map(row => ({ ...row.profile, conversationId: row.conversationId, isGroup: row.isGroup }));
    const query = search.value.toLowerCase();
    for (const profile of choices.filter(profile => `${profile.display_name} ${profile.username}`.toLowerCase().includes(query))) {
      const button = element('button', 'person-row'); button.type = 'button'; button.append(avatar(profile), element('strong', '', profile.display_name || profile.username), element('small', 'muted', profile.isGroup ? 'Group' : ''));
      button.addEventListener('click', async () => {
        if (sending) return; sending = true; results.querySelectorAll('button').forEach(button => button.disabled = true);
        try {
          const id = profile.conversationId || await getOrCreateConversation(profile.id);
          if (sharing) {
            if (!requestIds.has(id)) requestIds.set(id, crypto.randomUUID());
            let path;
            if(sourceMessage){const source=sourceMessage.media_url||sourceMessage.content,extension=source.split('.').at(-1);if(!source.startsWith(sourceMessage.conversation_id+'/')||!['jpg','jpeg','png','webp','gif','webm','ogg','m4a','mp4','wav','pdf','txt','zip','doc','docx','xls','xlsx','ppt','pptx','bin'].includes(extension))throw new Error('Unavailable media');path=`${id}/${requestIds.get(id)}.${extension}`;const bucket=mediaBucket(sourceMessage.message_type);const {error}=await supabase.storage.from(bucket).copy(source,path);if(error&&!['409','Duplicate'].includes(String(error.statusCode||error.error)))throw error;}
            await sendMessage({ id: requestIds.get(id), conversationId: id, senderId: userId, content: text, sharedContent: content, ...(discussionContext?{messageType:'discussion',sportsContext:discussionContext}:{}), ...(sourceMessage?{messageType:sourceMessage.message_type,mediaUrl:path,duration:sourceMessage.media_duration_seconds,mediaMetadata:sourceMessage.media_metadata}: {}) });
            closeModal('new-chat-modal'); notify(`Sent to ${profile.display_name || profile.username}`); refreshList(); if (active?.id === id) snapshot(active);
          } else { closeModal('new-chat-modal'); await openThread(id, profile, !!profile.isGroup); }
        } catch { notify(sharing ? 'Could not send. Try again or choose another conversation.' : 'Could not open this conversation.'); }
        finally { sending = false; results.querySelectorAll('button').forEach(button => button.disabled = false); }
      }); results.append(button);
    }
    if (!results.children.length) results.append(element('p', 'muted', category === 'recent' ? 'No matching recent chats. Try People or Groups.' : 'No matches here.'));
  }
  for (const name of ['recent','people','groups']) { const button = actionButton(name[0].toUpperCase() + name.slice(1)); button.classList.toggle('active', name === category); button.addEventListener('click', () => { category = name; [...tabs.children].forEach(node => node.classList.toggle('active', node === button)); render(); }); tabs.append(button); }
  search.addEventListener('input', render);
  try { friends = await getMutualFriends(userId); if (version !== pickerVersion) return; render(); }
  catch { results.replaceChildren(element('p', 'form-error', 'Could not load your people. Close and try again.')); }
  finally { results.setAttribute('aria-busy', 'false'); }
}
document.getElementById('new-chat-btn').addEventListener('click', () => chooseConversation()); document.getElementById('placeholder-new-chat').addEventListener('click', () => chooseConversation());
document.getElementById('close-chat-btn').addEventListener('click', () => navigate('inbox')); document.addEventListener('kaidra:close-chat', closeThread);
document.getElementById('chat-header-user').addEventListener('click', () => { if (active?.isGroup) document.getElementById('chat-info-btn').click(); else if (active) viewProfile(active.profile.id); });
document.addEventListener('kaidra:open-thread', event => openThread(event.detail.conversationId, event.detail.profile, event.detail.isGroup));
document.addEventListener('kaidra:message-user', async event => { try { const id = await getOrCreateConversation(event.detail.profile.id); await openThread(id, event.detail.profile); } catch { notify('Could not open your conversation. Check that you are friends and try again.'); } });
document.addEventListener('kaidra:share-content', event => chooseConversation(event.detail.content, event.detail.text, null, event.detail.discussionContext));
document.addEventListener('kaidra:modal-close', event => { if (event.detail.id === 'new-chat-modal') ++pickerVersion; const state=active;if(state)requestAnimationFrame(()=>acknowledge(state)); });
document.getElementById('inbox-search').addEventListener('input', renderList);
document.querySelectorAll('[data-inbox-filter]').forEach(button => button.addEventListener('click', () => { filter = button.dataset.inboxFilter; document.querySelectorAll('[data-inbox-filter]').forEach(item => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)); }); renderList(); }));
const voiceNotes = installVoiceNotes({ getActive: () => active, onBusy: value => { voiceBusy = value; input.disabled = value; syncComposer(); }, onSend: (blob, duration) => {
  if (!active || !userId) return;
  const message = { id: crypto.randomUUID(), conversation_id: active.id, sender_id: userId, content: '', message_type: 'voice_note', media_duration_seconds: duration, external_ref_id: replyDraft?.id || null, created_at: new Date().toISOString(), localState: 'queued', localVoiceBlob: blob, localVoiceUrl: URL.createObjectURL(blob) };
  replyDraft = null; renderDraft(); deliver(active, message);
} });
const groups = installGroups({ jumpToMessage, getUserId: () => userId, getActive: () => active, openThread, refreshList, refreshState });
function startRealtime() {
  if (!userId || inboxChannel) return; inboxChannel = subscribeToInboxUpdates(userId, payload => { refreshList(); const message=payload?.new;if(payload?.table==='messages'&&message?.sender_id!==userId&&message?.id&&message?.conversation_id&&active?.id!==message.conversation_id)chatAction('kaidra_message_ack',{target_conversation:message.conversation_id,message_ids:[message.id],seen:false}).catch(()=>{}); if (active && payload?.table === 'chat_signals') refreshState(active).catch(() => {}); }, connection => { const live = ['SUBSCRIBED', 'LIVE'].includes(connection); status('inbox-connection-status', live ? 'Connected' : 'Reconnecting…'); if (live) refreshList(); });
  // Realtime plus reconnect/visibility snapshots; no recurring message polling.
}
document.addEventListener('visibilitychange', () => { if (document.hidden) active?.typing?.stop(); if (!document.hidden) { refreshList(); if (active) { snapshot(active); refreshState(active).catch(() => {}); } } });
window.addEventListener('online', () => { refreshList(); if (active) snapshot(active); });
window.addEventListener('pagehide', () => { clearInterval(poll); if (inboxChannel) supabase.removeChannel(inboxChannel); inboxChannel = null; closeThread(); }); window.addEventListener('pageshow', startRealtime);
account.then(async current => { if (!current) return; userId = current.userId; skeletons(list, 'person', 3); await refreshList(); startRealtime(); openRoute(parseRoute(location.hash)); });

function syncJump() { document.getElementById('jump-to-bottom').classList.toggle('hidden', !active || thread.scrollHeight - thread.scrollTop - thread.clientHeight < 160); }
thread.addEventListener('scroll', () => { syncJump(); clearTimeout(active?.readTimer); if(active){const state=active;state.readTimer=setTimeout(()=>acknowledge(state),100);if(state.lastScrollTop!==undefined&&thread.scrollTop<state.lastScrollTop-25)state.keyboardStick=false;state.lastScrollTop=thread.scrollTop;state.nearBottom=thread.scrollHeight-thread.scrollTop-thread.clientHeight<100;} }, { passive: true });
input.addEventListener('focus',()=>{if(active)active.keyboardStick=thread.scrollHeight-thread.scrollTop-thread.clientHeight<100;});
input.addEventListener('blur',()=>active?.typing?.stop());
window.visualViewport?.addEventListener('resize',()=>{const state=active;if(state?.keyboardStick)requestAnimationFrame(()=>{if(active===state&&state.keyboardStick)thread.scrollTop=thread.scrollHeight;});});
document.getElementById('jump-to-bottom').addEventListener('click', () => { thread.scrollTo({ top: thread.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); });
let routeVersion = 0;
async function openRoute(route) {
  const version = ++routeVersion;
  if (route.view !== 'inbox' || !route.id || active?.id === route.id) return;
  const current = await account; if (!current) return; userId = current.userId;
  let row = rows.find(item => item.conversationId === route.id);
  try { if (!row) row = (await getInbox(userId)).find(item => item.conversationId === route.id); }
  catch { notify('Could not open this conversation. Try again.'); return; }
  if (version !== routeVersion || parseRoute(location.hash).path !== route.path) return;
  if (row) openThread(row.conversationId, row.profile, row.isGroup);
  else showError('inbox-error', 'This conversation is unavailable or you are no longer a member.');
}
document.addEventListener('kaidra:route-change', event => openRoute(event.detail));

function reactPicker(anchor, message, state) {
  openReactions(anchor, ['❤️','😂','🔥','👍','😮','👏'], state.reactions.find(row => row.message_id === message.id && row.user_id === userId)?.emoji, async emoji => { await chatAction('kaidra_react', { target_message: message.id, reaction: emoji }); await refreshState(state); });
}
async function jumpToMessage(id) {
  const state = active; if (!state) return;
  try {
    if (!state.messages.has(id)) { const {data,error} = await supabase.from('messages').select('*').eq('id', id).eq('conversation_id', state.id).single(); if (error || !data) throw error; if (active !== state) return; mergeMessage(state.messages, data); acknowledgeDelivery(state); renderMessages(state); await refreshState(state); }
    const node = state.nodes.get(id); node?.scrollIntoView({ block: 'center', behavior: 'smooth' }); node?.classList.add('message-highlight'); setTimeout(() => node?.classList.remove('message-highlight'), 1800);
  } catch { notify('This original message is unavailable.'); }
}
document.getElementById('chat-pins').addEventListener('click', () => {
  if (!active) return; const panel = dialog('Pinned messages');
  for (const message of active.pins || []) { const button = actionButton(messagePreview(message), 'pin'); button.addEventListener('click', () => { panel.close(); jumpToMessage(message.id); }); panel.card.append(button); } panel.open();
});
document.getElementById('composer-plus').addEventListener('click', event => {
  if (!active) return;
  openMenu(event.currentTarget, [
    { label: 'Start discussion', icon: 'spark', run: () => { discussionMode=true;renderDraft();input.focus(); } },
    { label: 'Challenge', icon: 'spark', run: () => startChallenge({conversationId:active.id,targetUser:active.isGroup?undefined:active.profile.id}) },
    { label: 'Share entertainment', icon: 'film', run: () => navigate('discover') },
    groupAllowed(active, userId, 'create_polls') && { label: 'Poll', icon: 'poll', run: () => { const state = active; createPoll(state, async () => { await snapshot(state); await refreshState(state); }); } },
  ], 'Add to conversation');
});
document.getElementById('composer-emoji').addEventListener('click', event => openMenu(event.currentTarget, ['😊','❤️','😂','🔥','👍','🎬','⚽','✨'].map(emoji => ({label:emoji,run:()=>{const start=input.selectionStart;input.setRangeText(emoji, start, input.selectionEnd,'end');input.dispatchEvent(new Event('input'));input.focus();}})), 'Emoji'));

function editMessage(message,state){const panel=dialog('Edit message'),form=element('form'),text=element('textarea'),save=actionButton('Save','check','primary-button'),error=element('p','form-error');text.value=message.content;text.maxLength=4000;text.required=true;text.setAttribute('aria-label','Message text');save.type='submit';form.append(text,error,save);panel.card.append(form);form.addEventListener('submit',async event=>{event.preventDefault();save.disabled=true;try{await chatAction('kaidra_message_change',{target_message:message.id,action:'edit',body:text.value});panel.close();await snapshot(state);}catch(problem){error.textContent=problem.message||'Could not edit.';}finally{save.disabled=false;}});panel.open();}
document.getElementById('discussion-mode-close').addEventListener('click',()=>{discussionMode=false;renderDraft();input.focus();});

for(const event of ['pointerup','pointercancel'])thread.addEventListener(event,()=>{const state=active;if(state?.pendingRender)requestAnimationFrame(()=>renderMessages(state));});

document.addEventListener('kaidra:jump-discussion',async event=>{const {conversationId,messageId}=event.detail;try{const row=rows.find(row=>row.conversationId===conversationId)||(await getInbox(userId)).find(row=>row.conversationId===conversationId);if(!row)throw new Error('Unavailable');await openThread(row.conversationId,row.profile,row.isGroup);if(active?.loading)await snapshot(active);await jumpToMessage(messageId);}catch{notify('This discussion is unavailable.');}});

mediaPicker({getActive:()=>active,onFile:async(state,file,kind)=>{
  const id=crypto.randomUUID();try{const media=await uploadMedia(state.id,file,id,kind);const reply=active===state?replyDraft?.id:null;if(active===state){replyDraft=null;renderDraft();}await deliver(state,{id,conversation_id:state.id,sender_id:userId,content:'',...media,external_ref_id:reply||null,created_at:new Date().toISOString(),localState:'queued'});}catch(error){notify(error.message||'Could not upload this file.');}
}});
document.getElementById('composer-stickers').addEventListener('click',()=>stickerPicker({userId,getActive:()=>active,onSticker:async(state,media)=>{const reply=active===state?replyDraft?.id:null;if(active===state){replyDraft=null;renderDraft();}await deliver(state,{...media,conversation_id:state.id,sender_id:userId,content:'',external_ref_id:reply||null,created_at:new Date().toISOString(),localState:'queued'});}}));
