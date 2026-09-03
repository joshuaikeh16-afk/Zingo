/* ==========================================================================
   Kaidra — Core Application & Event Router
   ========================================================================== */

import { supabase, requireAuth, getUserPreferences, updateUserPreferences, getMutualFriends, getOrCreateConversation, sendMessage } from './supabase-client.js';

let currentUserId = null;

document.addEventListener('DOMContentLoaded', async function() {

  const session = await requireAuth();
  if (session) currentUserId = session.user.id;

  // Settings mini user card — real data, not the hardcoded placeholder
  if (currentUserId) {
    const { data: profile } = await supabase.from('profiles').select('username, display_name, avatar_url').eq('id', currentUserId).maybeSingle();
    if (profile) {
      const nameEl = document.getElementById('settings-user-name');
      const handleEl = document.getElementById('settings-user-handle');
      const avatarEl = document.getElementById('settings-user-avatar');
      if (nameEl) nameEl.textContent = profile.display_name || profile.username;
      if (handleEl) handleEl.textContent = '@' + profile.username;
      if (avatarEl) avatarEl.src = profile.avatar_url || `https://placehold.co/80x80/1a1625/f2ede4?text=${profile.username[0].toUpperCase()}`;
    }
  }

  // Real Settings: load current values, persist on change
  if (currentUserId) {
    const prefs = await getUserPreferences(currentUserId);
    const toggleMap = {
      'setting-allow-dms': 'allow_dms',
      'setting-public-watchlist': 'public_watchlist',
      'setting-notify-dm': 'notify_dm',
      'setting-nsfw-filter': 'nsfw_filter',
    };
    Object.entries(toggleMap).forEach(([elId, prefKey]) => {
      const el = document.getElementById(elId);
      if (!el) return;
      el.checked = !!prefs[prefKey];
      el.addEventListener('change', () => {
        updateUserPreferences(currentUserId, { [prefKey]: el.checked }).catch((err) => {
          console.error('Failed to save setting:', err);
          el.checked = !el.checked; // revert on failure
        });
      });
    });
  }

  // Real Logout
  const logoutBtn = document.getElementById('settings-logout-btn');
  logoutBtn?.addEventListener('click', async () => {
    logoutBtn.disabled = true;
    await supabase.auth.signOut();
    window.location.replace('/auth.html');
  });

  // Bottom Navigation Routing
  document.querySelectorAll('#app-bottom-nav .nav-item').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('#app-bottom-nav .nav-item').forEach(function(b) {
        b.classList.remove('active');
      });
      btn.classList.add('active');
      
      var targetTab = btn.getAttribute('data-tab');

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

  // Direct Message Drawer — close control only (opening is owned by
  // inbox.js's openThread, and by forwardArticleToChat below)
  var chatDrawer = document.getElementById('chat-view-drawer');
  var closeChatBtn = document.getElementById('close-chat-btn');
  if (closeChatBtn) {
    closeChatBtn.addEventListener('click', function() {
      if (chatDrawer) chatDrawer.classList.remove('is-active');
    });
  }

  // Forward-to-DM Picker
  // Listens for 'kaidra:news-forward-request' (dispatched by news-data.js)
  // and lets the user pick a real friend to forward the story to.
  var forwardOverlay = document.getElementById('forward-picker-overlay');
  var forwardList = document.getElementById('forward-picker-list');
  var closeForwardBtn = document.getElementById('close-forward-picker-btn');

  function openForwardPicker(article) {
    if (!forwardOverlay || !forwardList || !currentUserId) return;
    forwardList.innerHTML = '<div class="find-friends-hint">Loading friends…</div>';
    forwardOverlay.classList.add('is-open');

    getMutualFriends(currentUserId).then(function(friends) {
      forwardList.innerHTML = '';

      if (friends.length === 0) {
        forwardList.innerHTML = '<div class="find-friends-hint">Add a friend first to forward stories.</div>';
        return;
      }

      friends.forEach(function(friend) {
        var name = friend.display_name || friend.username;
        var avatarUrl = friend.avatar_url || ('https://placehold.co/80x80/1a1625/f2ede4?text=' + name[0].toUpperCase());

        var pickRow = document.createElement('div');
        pickRow.className = 'forward-pick-row';
        pickRow.innerHTML =
          '<img class="avatar" src="' + avatarUrl + '" alt="' + name + '" />' +
          '<span>' + name + '</span>';

        pickRow.addEventListener('click', function() {
          forwardArticleToFriend(friend.id, name, avatarUrl, article);
        });

        forwardList.appendChild(pickRow);
      });
    });
  }

  function closeForwardPicker() {
    if (forwardOverlay) forwardOverlay.classList.remove('is-open');
  }

  function forwardArticleToFriend(friendId, name, avatarUrl, article) {
    var content = 'Check out this news: ' + article.title +
      (article.sourceUrl ? ' — ' + article.sourceUrl : '') +
      (article.relatedAnimeTitle ? ' (About: ' + article.relatedAnimeTitle + ')' : '');

    getOrCreateConversation(friendId).then(function(conversationId) {
      return sendMessage({ conversationId: conversationId, senderId: currentUserId, content: content })
        .then(function() { return conversationId; });
    }).then(function(conversationId) {
      document.dispatchEvent(new CustomEvent('kaidra:open-conversation', {
        detail: { conversationId: conversationId, otherUserId: friendId, otherUserName: name, otherUserAvatar: avatarUrl }
      }));
    }).catch(function(err) {
      console.error('Failed to forward article:', err);
    });

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

});