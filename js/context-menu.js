import { element, actionButton, iconButton, openModal, closeModal, topModal, notify } from './ui.js';
// One modal/focus boundary serves anchored desktop menus and mobile bottom sheets.
let sequence = 0;
export function dialog(title, className = '') {
  const id = `context-dialog-${++sequence}`, modal = element('div', `social-modal hidden ${className}`), card = element('div', 'social-modal-card');
  const parent = document.getElementById(topModal()); if (parent?.dataset.conversationId) modal.dataset.conversationId = parent.dataset.conversationId;
  modal.id = id; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', `${id}-title`);
  const heading = element('div', 'modal-heading'), name = element('h2', '', title), close = iconButton('close', 'Close'); name.id = `${id}-title`;
  close.addEventListener('click', () => closeModal(id)); heading.append(name, close); card.append(heading); modal.append(card); document.body.append(modal);
  modal.addEventListener('click', event => { if (event.target === modal) closeModal(id); });
  const cleanup = event => { if (event.detail.id === id) { if(modal.classList.contains('reaction-closing'))setTimeout(()=>modal.remove(),110);else modal.remove(); document.removeEventListener('kaidra:modal-close', cleanup); } };
  document.addEventListener('kaidra:modal-close', cleanup);
  return { id, modal, card, open: () => openModal(id), close: () => closeModal(id) };
}
export function confirmAction(title, description, label = 'Confirm') {
  return new Promise(resolve => {
    const panel = dialog(title, 'confirm-modal'); panel.card.append(element('p', 'muted', description));
    const actions = element('div', 'detail-actions'), cancel = actionButton('Cancel'), confirm = actionButton(label, 'check', 'danger-button');
    let accepted = false;
    cancel.addEventListener('click', panel.close); confirm.addEventListener('click', () => { accepted = true; panel.close(); }); actions.append(cancel, confirm); panel.card.append(actions);
    const finish = event => { if (event.detail.id === panel.id) { document.removeEventListener('kaidra:modal-close', finish); resolve(accepted); } };
    document.addEventListener('kaidra:modal-close', finish); panel.open();
  });
}
export function openMenu(anchor, actions, title = 'Actions', point) {
  const panel = dialog(title, 'context-layer'), menu = element('div', 'context-menu'); menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', title);
  for (const action of actions.filter(Boolean)) {
    const button = actionButton(action.label, action.icon || 'arrow', `context-action${action.danger ? ' is-danger' : ''}`);
    button.setAttribute('role', 'menuitem'); button.disabled = !!action.disabled;
    button.addEventListener('click', async () => { panel.close(); try { await action.run(); } catch { notify('Could not complete that action. Please try again.'); } }); menu.append(button);
  }
  menu.addEventListener('keydown', event => {
    const buttons = [...menu.querySelectorAll('button:not(:disabled)')], at = buttons.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus(); }
  });
  const conversation = anchor.closest('[data-conversation-id]')?.dataset.conversationId; if (conversation) panel.modal.dataset.conversationId = conversation;
  panel.card.append(menu); const box = anchor.getBoundingClientRect();
  panel.card.style.setProperty('--menu-x', `${Math.max(8, Math.min(point?.x ?? box.right - 230, innerWidth - 250))}px`);
  panel.card.style.setProperty('--menu-y', `${Math.max(8, Math.min(point?.y ?? box.bottom + 6, innerHeight - actions.length * 46 - 90))}px`);
  panel.open(); menu.querySelector('button:not(:disabled)')?.focus(); return panel;
}

export function openReactions(anchor, choices, selected, choose) {
  const panel = dialog('React', 'reaction-popover'), strip = element('div', 'reaction-strip');
  const conversation = anchor.closest('[data-conversation-id]')?.dataset.conversationId;
  if (conversation) panel.modal.dataset.conversationId = conversation;
  strip.setAttribute('aria-label', 'Message reactions');
  for (const emoji of choices) {
    const button = element('button', 'reaction-choice', emoji); button.type = 'button';
    button.setAttribute('aria-label', `React ${emoji}`); button.setAttribute('aria-pressed', String(selected === emoji));
    button.addEventListener('click', async () => { panel.close(); try { await choose(emoji); } catch { notify('Could not update your reaction. Try again.'); } }); strip.append(button);
  }
  panel.card.append(strip);
  function position() {
    const viewport = window.visualViewport, box = anchor.getBoundingClientRect();
    const top = viewport?.offsetTop || 0, height = viewport?.height || innerHeight;
    const width = Math.min(320, innerWidth - 24);
    const y = box.top - 70 >= top + 8 ? box.top - 70 : Math.min(box.bottom + 8, top + height - 72);
    panel.card.style.left = `${Math.max(12, Math.min(box.left, innerWidth - width - 12))}px`;
    panel.card.style.top = `${Math.max(top + 8, y)}px`; panel.card.style.width = `${width}px`;
  }
  position(); window.visualViewport?.addEventListener('resize', position);window.visualViewport?.addEventListener('scroll', position);window.addEventListener('resize',position);
  const cleanup = event => { if (event.detail.id === panel.id) { window.visualViewport?.removeEventListener('resize', position);window.visualViewport?.removeEventListener('scroll',position);window.removeEventListener('resize',position); document.removeEventListener('kaidra:modal-close', cleanup); } };
  document.addEventListener('kaidra:modal-close', cleanup); panel.open(); return panel;
}
export function bindContext(node, getActions, { title = 'Actions', more = false } = {}) {
  let timer, start, suppressUntil = 0;
  const show = event => { clearTimeout(timer); if (Date.now() < suppressUntil) return; suppressUntil = Date.now() + 800; openMenu(node, getActions(), title, event && { x: event.clientX, y: event.clientY }); };
  node.addEventListener('contextmenu', event => { if (event.target.closest('audio, input, textarea')) return; event.preventDefault(); event.stopPropagation(); show(event); });
  node.addEventListener('pointerdown', event => { if (event.target.closest('[data-library-key]') && event.target.closest('[data-library-key]') !== node) return; if (event.pointerType === 'mouse' || event.target.closest('audio, input, textarea, .context-more')) return; start = { x: event.clientX, y: event.clientY }; timer = setTimeout(() => show(event), 500); });
  node.addEventListener('pointermove', event => { if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) clearTimeout(timer); });
  for (const event of ['pointerup', 'pointercancel', 'pointerleave']) node.addEventListener(event, () => clearTimeout(timer));
  node.addEventListener('click', event => { if (Date.now() < suppressUntil) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  node.addEventListener('keydown', event => { if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) { event.preventDefault(); show(); } });
  if (more) { const button = iconButton('more', title, 'icon-button context-more'); button.addEventListener('click', event => { event.stopPropagation(); openMenu(button, getActions(), title); }); node.append(button); }
}
