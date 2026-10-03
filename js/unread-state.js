export function unreadTotal(rows) {
  return rows.reduce((total, row) => total + Math.max(0, Number(row.unreadCount) || 0), 0);
}
export function compareMessages(left, right) {
  const seconds = value => Math.floor(Date.parse(value.created_at) / 1000);
  const fraction = value => (value.created_at.match(/\.(\d+)/)?.[1] || '').padEnd(9, '0');
  return seconds(left) - seconds(right) || fraction(left).localeCompare(fraction(right)) || left.id.localeCompare(right.id);
}
export function applyReadMarks(rows, marks, pending = null) {
  return rows.map(row => {
    const mark = pending?.id === row.conversationId ? pending.through : marks.get(row.conversationId);
    return mark && (!row.lastMessage || compareMessages(row.lastMessage, mark) <= 0) ? { ...row, unreadCount: 0 } : row;
  });
}
