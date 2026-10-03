import { supabase, chatAction } from './supabase-client.js';
import { account } from './session.js';
import { notify } from './ui.js';
let entries = new Map(), pending = new Set(), ready, userId, channel, generation = 0;
export const libraryKey = item => `${item.kind || item.type}:${item.kind === 'article' ? item.url : item.id}`;
const announce = () => document.dispatchEvent(new CustomEvent('kaidra:library-change'));
export function libraryState(item) { return entries.get(libraryKey(item)) || {}; }
export function libraryItems(collection) { return [...entries.values()].filter(row => row[collection === 'favorites' ? 'is_favorite' : 'is_watchlisted']).map(row => ({ ...row.snapshot, provider: row.provider, kind: row.media_type, id: row.external_id, title: row.title, image: row.cover_url })); }
export async function loadLibrary() {
  const current = await account; if (!current) return; userId = current.userId;
  const version = ++generation;
  const { data, error } = await supabase.from('user_watchlist').select('provider,media_type,external_id,title,cover_url,snapshot,is_favorite,is_watchlisted').eq('user_id', userId).order('created_at', { ascending: false });
  if (error) throw error;
  if (version !== generation) return;
  const updated = new Map((data || []).map(row => [`${row.media_type}:${row.external_id}`, row]));
  for (const key of pending) if (entries.has(key)) updated.set(key, entries.get(key));
  entries = updated; announce();
}
export async function libraryReady() { if (!ready) ready = loadLibrary().catch(error => { ready = null; throw error; }); return ready; }
export async function toggleLibrary(item, collection) {
  try { await libraryReady(); } catch { notify('Your library could not load. Please try again.'); return; }
  const key = libraryKey(item); if (pending.has(key)) return;
  const previous = entries.get(key), field = collection === 'favorites' ? 'is_favorite' : 'is_watchlisted', saved = !previous?.[field];
  pending.add(key); ++generation;
  entries.set(key, { ...previous, media_type: item.kind || item.type, external_id: String(item.id || item.url), title: item.title, cover_url: item.image, snapshot: item, [field]: saved }); announce();
  try { const row = await chatAction('kaidra_library_save', { item, collection, saved }); entries.set(key, row); notify(saved ? `Added to ${collection === 'favorites' ? 'Favorites' : 'Watchlist'}` : 'Removed from your library'); }
  catch { if (previous) entries.set(key, previous); else entries.delete(key); notify('Could not save that change. Your library has been restored.'); }
  finally { pending.delete(key); announce(); }
}
account.then(current => {
  if (!current) return;
  libraryReady().catch(() => {});
  channel = supabase.channel(`library:${current.userId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'user_watchlist', filter: `user_id=eq.${current.userId}` }, () => loadLibrary().catch(() => {})).subscribe(status => { if (status === 'SUBSCRIBED') loadLibrary().catch(() => {}); });
});
window.addEventListener('pagehide', () => { if (channel) supabase.removeChannel(channel); });
