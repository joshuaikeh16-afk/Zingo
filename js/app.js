/**
 * Kaidra Web - App Shell & Interactivity JS
 * Controls bottom navigation tab switching, compose modal, status viewer,
 * message thread interactions, and search handlers.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Navigation tabs
  const navHome = document.getElementById('nav-home');
  const navFriends = document.getElementById('nav-friends');
  const navCompose = document.getElementById('nav-compose');
  const navInbox = document.getElementById('nav-inbox');
  const navProfile = document.getElementById('nav-profile');

  // Views
  const viewHome = document.getElementById('view-home');
  const viewFriends = document.getElementById('view-friends');
  const viewInbox = document.getElementById('view-inbox');
  const viewProfile = document.getElementById('view-profile');
  const viewDiscover = document.getElementById('view-discover');

  // Tab switching helper
  function switchTab(targetViewId, activeNavBtn) {
    const views = [viewHome, viewFriends, viewInbox, viewProfile, viewDiscover];
    views.forEach((v) => {
      if (v) v.classList.add('hidden');
    });

    const targetView = document.getElementById(targetViewId);
    if (targetView) targetView.classList.remove('hidden');

    [navHome, navFriends, navInbox, navProfile].forEach((btn) => {
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

  if (navHome) navHome.addEventListener('click', () => switchTab('view-home', navHome));
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

  friendAvatars.forEach((avatar) => {
    avatar.addEventListener('click', () => {
      if (statusModal) statusModal.classList.remove('hidden');
    });
  });

  if (statusCloseBtn && statusModal) {
    statusCloseBtn.addEventListener('click', () => {
      statusModal.classList.add('hidden');
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

  // Message Sending Demo
  const sendBtn = document.getElementById('message-send-btn');
  const threadContainer = document.getElementById('message-thread-container');
  if (sendBtn && messageInput && threadContainer) {
    const handleSend = () => {
      const text = messageInput.value.trim();
      if (!text) return;

      const bubble = document.createElement('div');
      bubble.className = 'message-bubble self-end bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-2xl rounded-tr-xs p-3 text-sm max-w-[80%] shadow-md ml-auto';
      bubble.setAttribute('data-message-id', 'msg-' + Date.now());
      bubble.setAttribute('data-message-type', 'text');
      bubble.textContent = text;

      threadContainer.appendChild(bubble);
      messageInput.value = '';
      threadContainer.scrollTop = threadContainer.scrollHeight;
    };

    sendBtn.addEventListener('click', handleSend);
    messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleSend();
    });
  }

  // SOTD recipient select toggle
  const friendOptions = document.querySelectorAll('.friend-option');
  friendOptions.forEach((opt) => {
    opt.addEventListener('click', () => {
      opt.classList.toggle('bg-violet-600/30');
      opt.classList.toggle('border-violet-500');
    });
  });

  // Feed like & bookmark toggles
  document.addEventListener('click', (e) => {
    const likeBtn = e.target.closest('.like-btn');
    if (likeBtn) {
      likeBtn.classList.toggle('text-rose-500');
      likeBtn.classList.toggle('text-slate-400');
    }

    const bookmarkBtn = e.target.closest('.bookmark-btn');
    if (bookmarkBtn) {
      bookmarkBtn.classList.toggle('text-amber-400');
      bookmarkBtn.classList.toggle('text-slate-400');
    }
  });
});
