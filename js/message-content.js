// Presentation registry for server-authorized message types. Adding a renderer
// never grants permission to create an event or supplies battle/relationship state.
const renderers = new Map();
export function registerMessageContent(type, render) {
  if (typeof type !== 'string' || typeof render !== 'function') throw new TypeError('A message type and renderer are required');
  renderers.set(type, render);
}
export function renderMessageContent(message, context) {
  return renderers.get(message.message_type)?.(message, context) || null;
}
