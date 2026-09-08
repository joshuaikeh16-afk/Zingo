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

  // Local presentation preferences are intentionally device-level. They do
  // not affect the social or watchlist data stored in Supabase.
  const themeSelect = document.getElementById('setting-theme');
  const spoilerSelect = document.getElementById('setting-spoilers');
  const savedTheme = localStorage.getItem('kaidra:theme') || 'dark';
  const savedSpoilers = localStorage.getItem('kaidra:spoilers') || 'protected';
  if (themeSelect) themeSelect.value = savedTheme;
  if (spoilerSelect) spoilerSelect.value = savedSpoilers;
  const applyTheme = (theme) => document.documentElement.dataset.theme = theme;
  applyTheme(savedTheme);
  themeSelect?.addEventListener('change', () => { localStorage.setItem('kaidra:theme', themeSelect.value); applyTheme(themeSelect.value); });
  spoilerSelect?.addEventListener('change', () => localStorage.setItem('kaidra:spoilers', spoilerSelect.value));

  // Real Settings: load current values, persist on change
  if (currentUserId) {
    const prefs = await getUserPreferences(currentUserId);
    const toggleMap = {
      'setting-allow-dms': 'allow_dms',
      'setting-allow-nonfriend-dms': 'allow_nonfriend_dms',
      'setting-allow-follower-dms': 'allow_follower_dms',
      'setting-public-watchlist': 'public_watchlist',
      'setting-notify-dm': 'notify_dm',
      'setting-notify-likes': 'notify_likes',
      'setting-notify-comments': 'notify_comments',
      'setting-nsfw-filter': 'nsfw_filter',
    };
    Object.entries(toggleMap).forEach(([elId, prefKey]) => {
      const el = document.getElementById(elId);
      if (!el) return;
      el.checked = !!prefs[prefKey];
      el.addEventListener('change', () => {
        updateUserPreferences(currentUserId, { [prefKey]: el.checked }).then(() => {
          if (prefKey === 'nsfw_filter') {
            document.dispatchEvent(new CustomEvent('kaidra:content-preference-change', { detail: { allowSensitive: el.checked } }));
          }
        }).catch((err) => {
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

  // Bottom Navigation Routing. Persist the last tab so a refresh does not
  // always reset the user to Home.
  const tabStorageKey = currentUserId ? `kaidra:last-tab:${currentUserId}` : 'kaidra:last-tab';
  function activateTab(targetTab, persist = true) {
    document.querySelectorAll('#app-bottom-nav .nav-item').forEach((button) => {
      button.classList.toggle('active', button.getAttribute('data-tab') === targetTab);
    });
    document.querySelectorAll('.tab-pane').forEach((pane) => pane.classList.remove('active'));
    document.getElementById('tab-' + targetTab)?.classList.add('active');
    if (persist) localStorage.setItem(tabStorageKey, targetTab);
    document.dispatchEvent(new CustomEvent('kaidra:tab-change', { detail: { tab: targetTab } }));
  }
  document.querySelectorAll('#app-bottom-nav .nav-item').forEach((btn) => {
    btn.addEventListener('click', () => activateTab(btn.getAttribute('data-tab')));
  });
  const savedTab = localStorage.getItem(tabStorageKey);
  const hasBrowseGenre = new URLSearchParams(window.location.search).has('genre');
  if (hasBrowseGenre) activateTab('watchlist', false);
  else if (savedTab && document.getElementById('tab-' + savedTab)) activateTab(savedTab, false);

  // Home has two anime-first surfaces: recommendations and news.
  const homeModeButtons = document.querySelectorAll('.home-mode-btn, .home-news-link');
  const recommendationsView = document.getElementById('recommendations-view');
  const newsView = document.getElementById('news-scroll-view');
  homeModeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.homeMode;
      homeModeButtons.forEach((item) => {
        const active = item === button;
        item.classList.toggle('active', active);
        item.setAttribute('aria-selected', String(active));
      });
      recommendationsView?.classList.toggle('hidden', mode !== 'recommendations');
      newsView?.classList.toggle('hidden', mode !== 'news');
      document.dispatchEvent(new CustomEvent('kaidra:home-mode-change', { detail: { mode } }));
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
    var content = article.kind === 'video'
      ? 'Check out this Kaidra video: ' + (article.post.caption || article.url)
      : 'Check out this news: ' + article.title +
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

  document.addEventListener('kaidra:video-forward-request', function(e) {
    openForwardPicker({ kind: 'video', post: e.detail.post, url: e.detail.url });
  });

  if (closeForwardBtn) closeForwardBtn.addEventListener('click', closeForwardPicker);

  // Mobile-first dismissal: drag a sheet down instead of reaching for a
  // tiny X. Desktop close buttons remain available through CSS.
  document.querySelectorAll('.video-post-sheet, .video-audio-sheet, .video-comments-sheet, .video-share-sheet').forEach((sheet) => {
    let startY = null;
    let startX = null;
    sheet.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse') return;
      startY = event.clientY;
      startX = event.clientX;
      sheet.setPointerCapture?.(event.pointerId);
    });
    sheet.addEventListener('pointermove', (event) => {
      if (startY == null) return;
      const deltaY = event.clientY - startY;
      if (deltaY > 0 && Math.abs(deltaY) > Math.abs(event.clientX - startX)) sheet.style.transform = `translateY(${Math.min(deltaY, 240)}px)`;
    });
    sheet.addEventListener('pointerup', (event) => {
      if (startY == null) return;
      const shouldClose = event.clientY - startY > 80;
      const parent = sheet.parentElement;
      startY = null; startX = null;
      if (shouldClose) {
        sheet.classList.add('is-swipe-closing');
        window.setTimeout(() => {
          parent?.querySelector('button[aria-label="Close"], .video-post-close')?.click();
          sheet.classList.remove('is-swipe-closing');
          sheet.style.transform = '';
        }, 180);
      } else {
        sheet.style.transform = '';
      }
    });
    sheet.addEventListener('pointercancel', () => { startY = null; startX = null; sheet.style.transform = ''; });
  });

  document.querySelectorAll('.chat-overlay, .settings-panel, .forward-picker-panel').forEach((panel) => {
    let startX = null;
    panel.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse') return;
      startX = event.clientX;
      panel.setPointerCapture?.(event.pointerId);
    });
    panel.addEventListener('pointerup', (event) => {
      if (startX == null) return;
      const deltaX = event.clientX - startX;
      startX = null;
      if (deltaX > 80) {
        panel.querySelector('button[aria-label="Close Chat"], #close-settings-btn, #close-forward-picker-btn')?.click();
      }
    });
    panel.addEventListener('pointercancel', () => { startX = null; });
  });

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
