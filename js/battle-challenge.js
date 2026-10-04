import { actionButton } from './ui.js';
import { goRoute } from './router.js';

export function battleConflictId(error) {
  if (error?.code !== 'P0001' || !/already has an open battle|already have an open battle/.test(error.message || '')) return null;
  try {
    const id = JSON.parse(error.details).battle_id;
    return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
  } catch { return null; }
}

export function challengeError(error) {
  if (error?.code === '23505' && /battles_open_pair_idx|battle_one_open_conversation/.test(error.message || '')) return 'An open battle is already waiting. Respond to it, cancel it or finish it before creating another.';
  return error?.message || 'Could not send challenge.';
}

export function appendBattleConflict(container, error, beforeOpen = () => {}) {
  const id = battleConflictId(error);
  if (!id) return;
  const open = actionButton('Open existing battle', 'arrow');
  open.addEventListener('click', () => { beforeOpen(); goRoute(`battle/${id}`); });
  container.append(open);
}
