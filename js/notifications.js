import { supabase } from './supabase-client.js';
import { account } from './session.js';
import { element, openModal, closeModal, showError, notify, avatar, navigate, viewProfile, emptyState } from './ui.js';
import { icon } from './icons.js';
import {goRoute} from './router.js';
import { openContent } from './content-view.js';
import { externalLink, feedError } from './content-client.js';
let userId, channel, generation = 0;
let pendingRequests = [], notifications = [], unreadCount = 0, messageRows = [], unreadMessages = 0;
function render() {
  const count = unreadCount + pendingRequests.length + unreadMessages, badge = document.getElementById('alerts-count'); badge.textContent = count > 99 ? '99+' : String(count); badge.classList.toggle('hidden', !count);
  const mark = document.getElementById('mark-alerts-read'); mark.disabled = !unreadCount; mark.replaceChildren(icon('check'), document.createTextNode('Mark updates as read'));
  list.replaceChildren();
  for (const request of pendingRequests) {
    const button = element('button', 'notification-row unread-alert'); button.type = 'button';
    const copy = element('span', 'notification-copy'); copy.append(element('strong', '', `${request.requester.display_name || request.requester.username} wants to connect`), element('span', '', 'Review this friend request'), element('small', '', new Date(request.created_at).toLocaleString()));
    button.append(avatar(request.requester), copy); button.addEventListener('click', () => { closeModal('alerts-modal'); viewProfile(request.requester.id); }); list.append(button);
  }
  for (const row of messageRows.filter(row => row.unreadCount && !row.muted)) {
    const button = element('button', 'notification-row unread-alert'); button.type = 'button';
    const copy = element('span', 'notification-copy'); copy.append(element('strong', '', row.profile.display_name || row.profile.username), element('span', '', `${row.mentionCount ? 'You were mentioned · ' : ''}${row.unreadCount} unread ${row.unreadCount === 1 ? 'message' : 'messages'}`));
    button.append(avatar(row.profile), copy); button.addEventListener('click', () => { closeModal('alerts-modal'); document.dispatchEvent(new CustomEvent('kaidra:open-thread', { detail: row })); }); list.append(button);
  }
  for (const item of notifications) {
    const card = element('article', `notification-row${item.read_at ? '' : ' unread-alert'}`), copy = element('div', 'notification-copy');
    const matchId = /^match:(\d+):/.exec(item.event_key || '')?.[1];
    const sportsRoute=item.payload?.sports;
    const internal=sportsRoute||matchId||item.category&&item.category!=='football';
    const link = internal ? element('button', 'notification-title', item.title) : externalLink(item.title, item.url);
    if (internal) link.type = 'button';
    link.addEventListener('click', async () => { if(sportsRoute){closeModal('alerts-modal');goRoute(`sports/${sportsRoute.sport}/${sportsRoute.entity_type}/${sportsRoute.external_id}`);} else if (matchId) { closeModal('alerts-modal'); openContent({ kind: 'match', id: matchId, title: item.title }); } else if(internal){closeModal('alerts-modal');if(item.payload?.item)openContent(item.payload.item);else if(item.payload?.battle_id)goRoute(`battle/${item.payload.battle_id}`);else goRoute(item.url||'home');} const result = await supabase.from('app_notifications').update({ read_at: new Date().toISOString() }).eq('id', item.id).eq('user_id', userId); if (!result.error) refresh(); });
    copy.append(link, element('span', '', item.body), element('small', '', new Date(item.created_at).toLocaleString())); card.append(icon(({social:'spark',battle:'spark',relationship:'people',friend:'people'})[item.category]||'ball', 'notification-symbol'), copy);const dismiss=element('button','icon-button');dismiss.type='button';dismiss.setAttribute('aria-label','Dismiss notification');dismiss.append(icon('close'));dismiss.addEventListener('click',async()=>{dismiss.disabled=true;const result=await supabase.from('app_notifications').update({dismissed_at:new Date().toISOString(),read_at:item.read_at||new Date().toISOString()}).eq('id',item.id).eq('user_id',userId);if(result.error){notify('Could not dismiss. Retry.');dismiss.disabled=false;}else refresh();});card.append(dismiss);list.append(card);
  }
  if (!pendingRequests.length && !notifications.length && !unreadMessages) list.append(emptyState('No notifications', 'Messages, friend activity and entertainment updates appear here.', 'bell'));
}
document.addEventListener('kaidra:unread-data', event => { messageRows = event.detail.rows; unreadMessages = messageRows.filter(row => !row.muted).reduce((sum,row) => sum + row.unreadCount, 0); render(); });
document.addEventListener('kaidra:friends-data', event => { pendingRequests = event.detail.requests; render(); });
const list = document.getElementById('alerts-list');
const deliveredInBrowser = new Set();
const enabled = document.getElementById('sports-alerts-enabled');
const newsEnabled = document.getElementById('sports-news-enabled');
const competition = document.getElementById('alerts-competition');
const browserStatus = document.getElementById('browser-alert-status');
function browserOptIn() { return userId && localStorage.getItem(`kaidra:browser-alerts:${userId}`) === 'true'; }
function updateBrowserStatus() {
  const button = document.getElementById('enable-browser-alerts');
  if (!('Notification' in window)) { button.disabled = true; browserStatus.textContent = 'This browser does not support system alerts. In-app alerts are still available.'; return; }
  button.replaceChildren(icon('bell'), element('span', '', browserOptIn() ? 'Disable browser notifications' : 'Enable browser notifications'));
  browserStatus.textContent = Notification.permission === 'denied' ? 'Browser alerts are blocked. You can change this in browser settings. In-app alerts still work.' : 'Browser alerts appear while Kaidra is open. Your in-app alerts are saved.';
}
async function refresh() {
  if (!userId) return;
  const request = ++generation;
  try {
    const [latest, unread] = await Promise.all([
      supabase.from('app_notifications').select('*').eq('user_id', userId).is('dismissed_at',null).order('created_at', { ascending: false }).limit(50),
      supabase.from('app_notifications').select('id', { count: 'exact', head: true }).eq('user_id', userId).is('dismissed_at',null).is('read_at', null),
    ]);
    if (request !== generation) return;
    if (latest.error || unread.error) throw latest.error || unread.error;
    unreadCount = unread.count || 0; notifications = latest.data || []; render();
  } catch { if (request === generation) feedError(list, refresh, 'Updates could not load. Please try again.'); }
}
async function showBrowserAlert(item) {
  if (!browserOptIn() || !('Notification' in window) || Notification.permission !== 'granted' || deliveredInBrowser.has(item.id)) return;
  deliveredInBrowser.add(item.id);
  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.register('/sw.js');
      const ready = registration.active ? registration : await navigator.serviceWorker.ready;
      await ready.showNotification(item.title, { body: item.body, tag: item.id, data: { url: `/app.html#${item.payload?.sports?item.url:item.payload?.battle_id?`battle/${item.payload.battle_id}`:item.url?.startsWith('inbox/')?item.url:'home'}` } });
    } else {
      const notification = new Notification(item.title, { body: item.body, tag: item.id });
      notification.onclick = () => { window.focus(); notification.close(); openModal('alerts-modal'); };
    }
  } catch { browserStatus.textContent = 'System alerts are unavailable in this browser. Your alerts are saved in the app.'; }
}
function connect() {
  if (channel) supabase.removeChannel(channel);
  channel = supabase.channel(`alerts:${userId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'app_notifications', filter: `user_id=eq.${userId}` }, (payload) => { refresh(); showBrowserAlert(payload.new); }).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'app_notifications', filter: `user_id=eq.${userId}` }, refresh).subscribe((status) => { if (status === 'SUBSCRIBED') refresh(); });
}
document.getElementById('open-alerts-btn').addEventListener('click', () => { openModal('alerts-modal'); refresh(); });
document.getElementById('mark-alerts-read').addEventListener('click', async (event) => {
  const button = event.currentTarget; button.disabled = true;
  try { const { error } = await supabase.from('app_notifications').update({ read_at: new Date().toISOString() }).eq('user_id', userId).is('read_at', null); if (error) throw error; await refresh(); }
  catch { notify('Could not mark alerts as read. Try again.'); }
  finally { button.disabled = false; }
});
document.getElementById('save-alerts-btn').addEventListener('click', async (event) => {
  const button = event.currentTarget; button.disabled = true; showError('alerts-error');
  try {
    const { error } = await supabase.from('sports_alert_settings').upsert({ user_id: userId, enabled: enabled.checked, news_enabled: newsEnabled.checked, competition: competition.value, updated_at: new Date().toISOString() });
    if (error) throw error;
    notify('Your football alerts have been saved.');
  } catch { showError('alerts-error', 'Could not save alerts. Please try again.'); }
  finally { button.disabled = false; }
});
document.getElementById('enable-browser-alerts').addEventListener('click', async () => {
  if (!userId || !('Notification' in window)) return;
  if (browserOptIn()) localStorage.removeItem(`kaidra:browser-alerts:${userId}`);
  else {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') localStorage.setItem(`kaidra:browser-alerts:${userId}`, 'true');
  }
  updateBrowserStatus();
});
(async () => {
  const current = await account; if (!current) return; userId = current.userId;
  updateBrowserStatus(); connect(); refresh();
  const { data, error } = await supabase.from('sports_alert_settings').select('*').eq('user_id', userId).maybeSingle();
  if (error) { showError('alerts-error', 'Alert preferences could not load. Try saving your choices again.'); return; }
  enabled.checked = data?.enabled || false; newsEnabled.checked = data?.news_enabled || false; competition.value = data?.competition || 'ALL';
})();
document.addEventListener('kaidra:social-refresh',refresh);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
window.addEventListener('online', () => { if (userId) { connect(); refresh(); } });
window.addEventListener('pagehide', () => { if (channel) supabase.removeChannel(channel); });
window.addEventListener('pageshow', (event) => { if (event.persisted && userId) { connect(); refresh(); } });
