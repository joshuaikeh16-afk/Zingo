import { supabase, requireAuth } from './supabase-client.js';

const row = document.getElementById('gemini-conversation-row');
const input = document.getElementById('message-text-input');
const messages = document.getElementById('gemini-messages');
const thread = document.getElementById('message-thread-container');
const sendButton = document.getElementById('message-send-btn');
const history = [];

function addMessage(text, role) {
  if (!thread) return;
  const el = document.createElement('div');
  el.className = `message-row ${role === 'user' ? 'outgoing' : 'incoming'}`;
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = text;
  el.appendChild(bubble);
  thread.appendChild(el);
  thread.scrollTop = thread.scrollHeight;
}

function openGeminiChat() {
  document.getElementById('dm-active-name').textContent = 'Kaidra AI';
  document.getElementById('dm-active-avatar').src = 'https://placehold.co/80x80/8b8fff/ffffff?text=AI';
  document.getElementById('chat-view-drawer')?.classList.add('is-active');
  if (thread && !thread.dataset.geminiReady) {
    thread.innerHTML = '';
    addMessage('Hey! I’m Kaidra AI. Ask me for anime recommendations, explanations, or help organizing your list.', 'assistant');
    thread.dataset.geminiReady = 'true';
  }
  input?.focus();
}

async function askGemini(prompt) {
  const clean = prompt.trim();
  if (!clean || !thread) return;
  addMessage(clean, 'user');
  input.value = '';
  sendButton.disabled = true;
  const pending = document.createElement('div');
  pending.className = 'gemini-message assistant';
  pending.textContent = 'Thinking…';
  pending.className = 'message-row incoming';
  const pendingBubble = document.createElement('div');
  pendingBubble.className = 'message-bubble';
  pendingBubble.textContent = 'Thinking…';
  pending.appendChild(pendingBubble);
  thread.appendChild(pending);
  try {
    const session = await requireAuth();
    if (!session) return;
    const { data, error } = await supabase.functions.invoke('gemini-chat', { body: { prompt: clean, history } });
    if (error) throw error;
    pendingBubble.textContent = data?.text || 'I could not answer that right now.';
    history.push({ role: 'user', parts: [{ text: clean }] }, { role: 'model', parts: [{ text: pendingBubble.textContent }] });
  } catch (error) {
    pendingBubble.textContent = 'Gemini is unavailable. Check the model and API key in Supabase.';
    console.error('Gemini assistant failed:', error);
  } finally {
    sendButton.disabled = false;
    thread.scrollTop = thread.scrollHeight;
  }
}

row?.addEventListener('click', openGeminiChat);
row?.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') openGeminiChat(); });
sendButton?.addEventListener('click', () => { if (document.getElementById('dm-active-name')?.textContent === 'Kaidra AI') askGemini(input?.value || ''); });
input?.addEventListener('keydown', (event) => { if (event.key === 'Enter' && document.getElementById('dm-active-name')?.textContent === 'Kaidra AI') { event.preventDefault(); askGemini(input.value); } });
