/* ==========================================================================
   Kaidra — Core Application & Event Router
   ========================================================================== */

document.addEventListener('DOMContentLoaded', function() {
  
  var newsViewBtn = document.getElementById('news-view-btn');
  var viewBtnLabel = document.getElementById('view-btn-label');
  var currentView = 'grid'; 
  var hasDefaultPreference = false;

  // Update Gesture Button UI
  function updateViewButtonState() {
    if (hasDefaultPreference) {
      newsViewBtn.classList.add('is-hidden');
      return;
    }

    newsViewBtn.classList.remove('is-hidden');
    if (currentView === 'scroll') {
      newsViewBtn.classList.add('active-scroll');
      viewBtnLabel.textContent = 'Grid';
    } else {
      newsViewBtn.classList.remove('active-scroll');
      viewBtnLabel.textContent = 'Scroll';
    }
  }

  // Toggle Mode on Header Button Tap
  if (newsViewBtn) {
    newsViewBtn.addEventListener('click', function() {
      currentView = (currentView === 'grid') ? 'scroll' : 'grid';
      updateViewButtonState();

      document.dispatchEvent(new CustomEvent('kaidra:news-view-change', { 
        detail: { view: currentView } 
      }));
    });
  }

  // Bottom Navigation Routing
  document.querySelectorAll('#app-bottom-nav .nav-item').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('#app-bottom-nav .nav-item').forEach(function(b) {
        b.classList.remove('active');
      });
      btn.classList.add('active');
      
      var targetTab = btn.getAttribute('data-tab');

      if (targetTab === 'news' && !hasDefaultPreference) {
        newsViewBtn.classList.remove('is-hidden');
      } else {
        newsViewBtn.classList.add('is-hidden');
      }

      document.querySelectorAll('.tab-pane').forEach(function(pane) {
        pane.classList.remove('active');
      });
      var targetPane = document.getElementById('tab-' + targetTab);
      if (targetPane) {
        targetPane.classList.add('active');
      }

      document.dispatchEvent(new CustomEvent('kaidra:tab-change', { 
        detail: { tab: targetTab } 
      }));
    });
  });

  // Settings Slide-Over Controls
  var settingsOverlay = document.getElementById('settings-overlay');
  var openSettingsBtn = document.getElementById('open-settings-btn');
  var closeSettingsBtn = document.getElementById('close-settings-btn');

  function openSettings() {
    if (settingsOverlay) settingsOverlay.classList.add('is-open');
  }

  function closeSettings() {
    if (settingsOverlay) settingsOverlay.classList.remove('is-open');
  }

  if (openSettingsBtn) openSettingsBtn.addEventListener('click', openSettings);
  if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', closeSettings);

  // Direct Message Drawer Controls
  var chatDrawer = document.getElementById('chat-view-drawer');
  var closeChatBtn = document.getElementById('close-chat-btn');

  function openDirectMessage(chatId, username, avatarUrl) {
    if (username) document.getElementById('dm-active-name').textContent = username;
    if (avatarUrl) document.getElementById('dm-active-avatar').src = avatarUrl;
    if (chatDrawer) chatDrawer.classList.add('is-active');
  }

  function closeDirectMessage() {
    if (chatDrawer) chatDrawer.classList.remove('is-active');
  }

  if (closeChatBtn) closeChatBtn.addEventListener('click', closeDirectMessage);

  // Bind Inbox Row Clicks to Open DM Drawer
  document.querySelectorAll('#chats-container .chat-row').forEach(function(row) {
    row.addEventListener('click', function() {
      var chatId = row.getAttribute('data-chat-id');
      var username = row.getAttribute('data-username');
      var avatarUrl = row.getAttribute('data-avatar');
      openDirectMessage(chatId, username, avatarUrl);
    });
  });

  // News View Switcher Listener
  document.addEventListener('kaidra:news-view-change', function(e) {
    var mode = e.detail.view;
    var gridView = document.getElementById('news-grid-view');
    var scrollView = document.getElementById('news-scroll-view');

    if (mode === 'scroll') {
      if (gridView) gridView.style.display = 'none';
      if (scrollView) scrollView.style.display = 'flex';
    } else {
      if (gridView) gridView.style.display = 'flex';
      if (scrollView) scrollView.style.display = 'none';
    }
  });

  // Watchlist Filter Pill Switcher
  document.querySelectorAll('#watchlist-filters .status-pill').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('#watchlist-filters .status-pill').forEach(function(b) {
        b.classList.remove('active');
      });
      btn.classList.add('active');

      var status = btn.getAttribute('data-status');
      document.dispatchEvent(new CustomEvent('kaidra:watchlist-filter-change', { 
        detail: { status: status } 
      }));
    });
  });

  // News Category Filter Chip Switcher
  document.querySelectorAll('#news-category-filters .filter-chip').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('#news-category-filters .filter-chip').forEach(function(b) {
        b.classList.remove('active');
      });
      btn.classList.add('active');

      var category = btn.getAttribute('data-category');
      document.dispatchEvent(new CustomEvent('kaidra:news-filter-change', { 
        detail: { category: category } 
      }));
    });
  });

  // Forward-to-DM Picker
  // Listens for 'kaidra:news-forward-request' (dispatched by news-data.js)
  // and lets the user pick an existing Inbox contact to forward the story to.
  // HOOK: listen for 'kaidra:dm-forward-send' to persist the forwarded
  // message via Supabase.
  var forwardOverlay = document.getElementById('forward-picker-overlay');
  var forwardList = document.getElementById('forward-picker-list');
  var closeForwardBtn = document.getElementById('close-forward-picker-btn');

  function openForwardPicker(article) {
    if (!forwardOverlay || !forwardList) return;
    forwardList.innerHTML = '';

    document.querySelectorAll('#chats-container .chat-row').forEach(function(row) {
      var username = row.getAttribute('data-username');
      var avatarUrl = row.getAttribute('data-avatar');
      var chatId = row.getAttribute('data-chat-id');

      var pickRow = document.createElement('div');
      pickRow.className = 'forward-pick-row';
      pickRow.innerHTML =
        '<img class="avatar" src="' + avatarUrl + '" alt="' + username + '" />' +
        '<span>' + username + '</span>';

      pickRow.addEventListener('click', function() {
        forwardArticleToChat(chatId, username, avatarUrl, article);
      });

      forwardList.appendChild(pickRow);
    });

    forwardOverlay.classList.add('is-open');
  }

  function closeForwardPicker() {
    if (forwardOverlay) forwardOverlay.classList.remove('is-open');
  }

  function forwardArticleToChat(chatId, username, avatarUrl, article) {
    openDirectMessage(chatId, username, avatarUrl);

    var messagesBody = document.getElementById('dm-messages-container');
    if (messagesBody) {
      var row = document.createElement('div');
      row.className = 'message-row outgoing';
      row.innerHTML =
        '<div class="message-bubble">' +
          'Check out this news:' +
          '<div class="shared-news-card">' +
            '<img class="shared-news-thumb" src="' + article.coverImage + '" alt="News" />' +
            '<div class="shared-news-meta">' +
              '<span class="shared-news-title">' + article.title + '</span>' +
              (article.relatedAnimeTitle ? '<span class="shared-news-anime">About: ' + article.relatedAnimeTitle + '</span>' : '') +
            '</div>' +
          '</div>' +
        '</div>' +
        '<span class="message-time">Now</span>';
      messagesBody.appendChild(row);
    }

    document.dispatchEvent(new CustomEvent('kaidra:dm-forward-send', {
      detail: { chatId: chatId, article: article }
    }));

    closeForwardPicker();
  }

  document.addEventListener('kaidra:news-forward-request', function(e) {
    openForwardPicker(e.detail);
  });

  if (closeForwardBtn) closeForwardBtn.addEventListener('click', closeForwardPicker);

  // Anime Tag → Watchlist Jump
  // Lets a user verify what a news story is actually about by jumping
  // straight to a search for the real anime on the Watchlist tab.
  document.addEventListener('kaidra:news-view-anime', function(e) {
    var title = e.detail.title;
    if (!title) return;

    var watchlistNavBtn = document.querySelector('#app-bottom-nav .nav-item[data-tab="watchlist"]');
    if (watchlistNavBtn) watchlistNavBtn.click();

    var searchInput = document.getElementById('anilist-search-input');
    if (searchInput) {
      searchInput.value = title;
      searchInput.dispatchEvent(new Event('input'));
    }
  });

  // Settings Preference Toggle Listener
  var settingLockScroll = document.getElementById('setting-lock-scroll');
  if (settingLockScroll) {
    settingLockScroll.addEventListener('change', function(e) {
      hasDefaultPreference = e.target.checked;
      updateViewButtonState();
    });
  }

});