// Resolve only explicit participants; a group never picks an arbitrary opponent.
export function challengeTarget(text, {members = [], userId, isGroup = false} = {}) {
  if (!/^\.challenge(?:\s|$)/i.test(text)) return null;
  const rest = text.replace(/^\.challenge\s*/i, ''), explicit = rest.match(/^@([a-zA-Z0-9_]+)(?:\s+([\s\S]*))?$/);
  const others = members.filter(member => member.id !== userId);
  if (explicit) {
    const member = others.find(member => member.username?.toLowerCase() === explicit[1].toLowerCase());
    if (!member) throw new Error('Choose another member of this conversation.');
    return {id:member.id, flavour:explicit[2] || ''};
  }
  if (rest.startsWith('@')) throw new Error('Use .challenge @username with optional challenge text.');
  if (isGroup || others.length !== 1) throw new Error('Choose someone to challenge: .challenge @username');
  return {id:others[0].id, flavour:rest};
}
