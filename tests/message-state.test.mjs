import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeMessage, sortedMessages, messagePreview } from '../js/message-state.js';
const row = { id: 'a', created_at: '2026-10-03T12:00:00Z', content: 'Hello', localState: 'sending' };
test('optimistic send + realtime echo + acknowledgement remains one message', () => {
  const map = new Map();
  mergeMessage(map, row);
  mergeMessage(map, { ...row, localState: null });
  mergeMessage(map, { ...row, localState: null });
  assert.equal(map.size, 1); assert.equal(map.get('a').localState, null);
});
test('a lost acknowledgement cannot make a delivered message failed', () => {
  const map = new Map();
  mergeMessage(map, { ...row, localState: null });
  mergeMessage(map, { ...row, localState: 'failed' });
  assert.equal(map.get('a').localState, null);
});
test('failed messages can retry without changing identity', () => {
  const map = new Map();
  mergeMessage(map, { ...row, localState: 'failed' });
  mergeMessage(map, row);
  assert.equal(map.size, 1); assert.equal(map.get('a').localState, 'sending');
});
test('stale snapshot does not undo a read receipt', () => {
  const map = new Map();
  mergeMessage(map, { ...row, read_at: '2026-10-03T12:01:00Z', localState: null });
  mergeMessage(map, { ...row, read_at: null, localState: null });
  assert.equal(map.get('a').read_at, '2026-10-03T12:01:00Z');
});
test('out-of-order delivery is sorted chronologically and consistently', () => {
  const map = new Map();
  mergeMessage(map, { ...row, id: 'c', created_at: '2026-10-03T12:02:00Z' });
  mergeMessage(map, { ...row, id: 'b' }); mergeMessage(map, row);
  assert.deepEqual(sortedMessages(map).map((message) => message.id), ['a','b','c']);
});
test('media previews do not expose storage paths', () => {
  assert.equal(messagePreview({ message_type: 'image', media_url: '/private/path' }), 'Photo');
  assert.equal(messagePreview({ message_type: 'voice_note' }), 'Voice message');
});
