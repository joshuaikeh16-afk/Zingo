// Realtime echoes, fetch snapshots, and HTTP acknowledgements can arrive in any order.
export function mergeMessage(messages, incoming) {
  if (!incoming?.id) return;
  const previous = messages.get(incoming.id);
  const next = { ...previous, ...incoming };
  if (previous?.read_at && !incoming.read_at) next.read_at = previous.read_at;
  if (previous && !previous.localState && incoming.localState) next.localState = null;
  messages.set(incoming.id, next);
}
export function sortedMessages(messages) {
  return [...messages.values()].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}
export function messagePreview(message) {
  if (!message) return 'Start the conversation';
  if (message.shared_content?.title) return `Shared ${message.shared_content.title}`;
  if (message.message_type === 'image') return 'Photo';
  if (message.message_type === 'voice_note') return 'Voice message';
  return message.content || 'Message';
}
