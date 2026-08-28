/**
 * Kaidra Web - App Shell & Interactivity JS
 * Controls bottom navigation tab switching, compose modal, status viewer,
 * message thread interactions, and search handlers.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Navigation tabs -- Home removed entirely, Inbox (Chats) is the
  // default/primary tab now, matching WhatsApp's own layout.
  const navFriends = document.getElementById('nav-friends');
  const navCompose = document.getElementById('nav-compose');
  const navInbox = document.getElementById('nav-inbox');
  const navProfile = document.getElementById('nav-profile');

  // Views
  const viewFriends = document.getElementById('view-friends');
  const viewInbox = document.getElementById('view-inbox');
  const viewProfile = document.getElementById('view-profile');
  const viewDiscover = document.getElementById('view-discover');

  // Tab switching helper
  function switchTab(targetViewId, activeNavBtn) {
    const views = [viewFriends, viewInbox, viewProfile, viewDiscover];
    views.forEach((v) => {
      if (v) v.classList.add('hidden');
    });

    const targetView = document.getElementById(targetViewId);
    if (targetView) targetView.classList.remove('hidden');

    [navFriends, navInbox, navProfile].forEach((btn) => {
      if (btn) {
        btn.classList.remove('active', 'text-violet-400');
        btn.classList.add('text-slate-400');
      }
    });

    if (activeNavBtn) {
      activeNavBtn.classList.add('active', 'text-violet-400');
      activeNavBtn.classList.remove('text-slate-400');
    }
  }

  if (navFriends) navFriends.addEventListener('click', () => switchTab('view-friends', navFriends));
  if (navInbox) navInbox.addEventListener('click', () => switchTab('view-inbox', navInbox));
  if (navProfile) navProfile.addEventListener('click', () => switchTab('view-profile', navProfile));

  // Top header Discover button toggle
  const discoverHeaderBtn = document.getElementById('header-discover-btn');
  if (discoverHeaderBtn) {
    discoverHeaderBtn.addEventListener('click', () => {
      switchTab('view-discover', null);
    });
  }

  // Compose Modal Toggle
  const composeModal = document.getElementById('compose-modal');
  const composeCloseBtn = document.getElementById('compose-close-btn');
  const optionStatus = document.getElementById('compose-option-status');
  const optionSotd = document.getElementById('compose-option-sotd');
  const statusFlow = document.getElementById('compose-status-flow');
  const sotdFlow = document.getElementById('compose-sotd-flow');

  if (navCompose && composeModal) {
    navCompose.addEventListener('click', () => {
      composeModal.classList.remove('hidden');
    });
  }

  if (composeCloseBtn && composeModal) {
    composeCloseBtn.addEventListener('click', () => {
      composeModal.classList.add('hidden');
    });
  }

  // Compose Flow Option Switcher
  if (optionStatus && optionSotd) {
    optionStatus.addEventListener('click', () => {
      optionStatus.classList.add('bg-violet-600', 'text-white');
      optionStatus.classList.remove('bg-slate-800', 'text-slate-400');
      optionSotd.classList.add('bg-slate-800', 'text-slate-400');
      optionSotd.classList.remove('bg-violet-600', 'text-white');

      if (statusFlow) statusFlow.classList.remove('hidden');
      if (sotdFlow) sotdFlow.classList.add('hidden');
    });

    optionSotd.addEventListener('click', () => {
      optionSotd.classList.add('bg-violet-600', 'text-white');
      optionSotd.classList.remove('bg-slate-800', 'text-slate-400');
      optionStatus.classList.add('bg-slate-800', 'text-slate-400');
      optionStatus.classList.remove('bg-violet-600', 'text-white');

      if (sotdFlow) sotdFlow.classList.remove('hidden');
      if (statusFlow) statusFlow.classList.add('hidden');
    });
  }

  // Status Viewer Modal
  const statusModal = document.getElementById('status-viewer-modal');
  const statusCloseBtn = document.getElementById('status-close-btn');
  const friendAvatars = document.querySelectorAll('.friend-status-avatar');

  // SOTD Listen Modal
  const sotdListenModal = document.getElementById('sotd-listen-modal');
  const sotdListenCloseBtn = document.getElementById('sotd-listen-close-btn');

  friendAvatars.forEach((avatar) => {
    avatar.addEventListener('click', (e) => {
      // If user tapped on the SOTD indicator badge specifically, open SOTD modal
      if (e.target.closest('.sotd-indicator')) {
        e.stopPropagation();
        if (sotdListenModal) sotdListenModal.classList.remove('hidden');
        return;
      }
      if (statusModal) statusModal.classList.remove('hidden');
    });
  });

  if (statusCloseBtn && statusModal) {
    statusCloseBtn.addEventListener('click', () => {
      statusModal.classList.add('hidden');
    });
  }

  if (sotdListenCloseBtn && sotdListenModal) {
    sotdListenCloseBtn.addEventListener('click', () => {
      sotdListenModal.classList.add('hidden');
    });
  }

  // Sticker Tray Toggle
  const stickerBtn = document.getElementById('message-sticker-btn');
  const stickerTray = document.getElementById('sticker-tray');
  if (stickerBtn && stickerTray) {
    stickerBtn.addEventListener('click', () => {
      stickerTray.classList.toggle('hidden');
    });
  }

  // Sticker selection
  const stickerOptions = document.querySelectorAll('.sticker-option');
  const messageInput = document.getElementById('message-text-input');
  stickerOptions.forEach((option) => {
    option.addEventListener('click', () => {
      if (messageInput) {
        messageInput.value += option.textContent.trim();
      }
      if (stickerTray) stickerTray.classList.add('hidden');
    });
  });

  // Real message sending is handled by inbox.js, not here -- see that
  // file for the actual Supabase-backed send logic.

  // SOTD recipient select toggle
  const friendOptions = document.querySelectorAll('.friend-option');
  friendOptions.forEach((opt) => {
    opt.addEventListener('click', () => {
      opt.classList.toggle('bg-violet-600/30');
      opt.classList.toggle('border-violet-500');
    });
  });

  // Note: real like/bookmark logic previously lived in home.js/news.js
  // -- both removed entirely along with the Home tab (News + Videos),
  // per the pivot to a chat-first app matching WhatsApp's structure.
});
