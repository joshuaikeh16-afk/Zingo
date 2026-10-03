import { searchUsers } from './supabase-client.js';
import { account } from './session.js';
import { openModal, closeModal, element, artwork, avatar, viewProfile } from './ui.js';
import { contentRequest } from './content-client.js';
import { openContent } from './content-view.js';
import { metadata, kindLabel } from './media.js';
const input = document.getElementById('global-search-input'), results = document.getElementById('global-search-results');
let timer, version = 0;
document.getElementById('open-global-search').addEventListener('click', () => openModal('global-search-modal'));
document.addEventListener('keydown', event => {
  if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.target.closest('input,textarea,select,[contenteditable]') && !document.querySelector('.social-modal:not(.hidden)') && !document.querySelector('.chat-overlay.is-active')) { event.preventDefault(); openModal('global-search-modal'); }
  if (event.key === 'ArrowDown' && event.target === input) { event.preventDefault(); results.querySelector('button')?.focus(); }
});
results.addEventListener('keydown', event => {
  if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
  const buttons = [...results.querySelectorAll('button')], index = buttons.indexOf(document.activeElement);
  event.preventDefault(); if (event.key === 'ArrowUp' && index <= 0) input.focus(); else buttons[Math.min(buttons.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
});
input.addEventListener('input', () => {
  clearTimeout(timer); const currentVersion = ++version, query = input.value.trim();
  results.replaceChildren(element('p', 'muted', query.length < 2 ? 'Type at least two characters.' : 'Searching…'));
  if (query.length < 2) return;
  timer = setTimeout(async () => {
    const current = await account; if (!current) return;
    const [titles, people] = await Promise.allSettled([contentRequest('catalog', { category: 'for-you', query, region: document.getElementById('content-region').value }), searchUsers(query, current.userId)]);
    if (version !== currentVersion) return;
    results.replaceChildren();
    function group(label) { const section = element('section', 'search-result-group'); section.append(element('h3', '', label)); results.append(section); return section; }
    const titleGroup = group('Movies & series');
    if (titles.status === 'fulfilled' && titles.value.configured) {
      for (const item of titles.value.items.slice(0, 8)) {
        const button = element('button', 'search-result'); button.type = 'button'; const copy = element('span', 'search-result-copy'); copy.append(element('strong', '', item.title), element('small', '', [kindLabel(item), metadata(item)].filter(Boolean).join(' · '))); button.append(artwork(item.image, '', ''), copy);
        button.addEventListener('click', () => { closeModal('global-search-modal'); openContent(item); }); titleGroup.append(button);
      }
      if (!titles.value.items.length) titleGroup.append(element('p', 'muted', 'No matching titles.'));
    } else titleGroup.append(element('p', 'muted', 'Title search is temporarily unavailable. Try again.'));
    const peopleGroup = group('People');
    if (people.status === 'fulfilled') {
      for (const person of people.value.slice(0, 6)) {
        const button = element('button', 'search-result'); button.type = 'button'; const copy = element('span', 'search-result-copy'); copy.append(element('strong', '', person.display_name || person.username), element('small', '', `@${person.username}`)); button.append(avatar(person), copy);
        button.addEventListener('click', () => { closeModal('global-search-modal'); viewProfile(person.id); }); peopleGroup.append(button);
      }
      if (!people.value.length) peopleGroup.append(element('p', 'muted', 'No matching people.'));
    } else peopleGroup.append(element('p', 'muted', 'People search is temporarily unavailable.'));
  }, 300);
});
document.addEventListener('kaidra:modal-close', event => { if (event.detail.id === 'global-search-modal') { ++version; clearTimeout(timer); } });

document.addEventListener('kaidra:modal-open', event => { if (event.detail.id === 'global-search-modal' && input.value.trim().length >= 2) input.dispatchEvent(new Event('input')); });
