import { supabase, chatAction } from './supabase-client.js';
import { notify } from './ui.js';
let entries = new Map(), pending = new Set(), userId, channel, inFlight, loaded = false, lastError, lastLoaded = 0, refreshRequested = false;
const providerFor = item => item.provider || ({movie:'tmdb',tv:'tmdb',anime:'mal',manga:'mal',article:'news',match:'football-data'})[item.kind || item.type];
export const libraryKey = item => JSON.stringify([providerFor(item), item.kind || item.type, String((item.kind || item.type) === 'article' ? item.url || item.id : item.id)]);
const rowKey = row => libraryKey({provider:row.provider,kind:row.media_type,id:row.external_id,url:row.external_id});
const announce = () => document.dispatchEvent(new CustomEvent('kaidra:library-change'));
export function libraryState(item) { return entries.get(libraryKey(item)) || {}; }
export function libraryStateByKey(key) { return entries.get(key) || {}; }
export function libraryItems(collection) { return [...entries.values()].filter(row => row[collection === 'favorites' ? 'is_favorite' : 'is_watchlisted']).map(row => ({ ...row.snapshot, provider: row.provider, kind: row.media_type, id: row.external_id, title: row.title || row.snapshot?.title || 'Saved title', image: row.cover_url, ...(row.media_type === 'article' ? {url:row.external_id} : {}) })); }
const permanent = error => /^(42703|42P01|42501|PGRST20[245])$/.test(error?.code || '') || [400,401,403,404].includes(error?.status);
export async function loadLibrary({force = false, refresh = false} = {}) {
  if(inFlight){if(refresh)refreshRequested=true;return inFlight;}
  if(lastError && permanent(lastError) && !force)throw lastError;
  if(loaded && !force && !refresh && Date.now()-lastLoaded<1000)return;
  inFlight=(async()=>{
    if(!userId){const {data:{session}}=await supabase.auth.getSession();if(!session)return;userId=session.user.id;}
    const {data,error,status}=await supabase.from('user_watchlist').select('provider,media_type,external_id,title,cover_url,snapshot,is_favorite,is_watchlisted').eq('user_id',userId).order('created_at',{ascending:false});
    if(error){if(status)error.status=status;lastError=error;throw error;}
    const updated=new Map((data||[]).map(row=>[rowKey(row),row]));for(const key of pending)if(entries.has(key))updated.set(key,entries.get(key));entries=updated;loaded=true;lastError=null;lastLoaded=Date.now();announce();
  })();try{await inFlight;}finally{inFlight=null;if(refreshRequested){refreshRequested=false;queueMicrotask(()=>loadLibrary({refresh:true}).catch(()=>{}));}}
}
export async function libraryReady(options) { if(options?.force || !loaded)return loadLibrary(options); }
export async function toggleLibrary(item,collection) {
  try{await libraryReady();}catch{notify('Your library could not load. Open your Profile to retry.');return;}
  const key=libraryKey(item);if(pending.has(key))return;
  const previous=entries.get(key),field=collection==='favorites'?'is_favorite':'is_watchlisted',saved=!previous?.[field];pending.add(key);
  entries.set(key,{...previous,provider:providerFor(item),media_type:item.kind||item.type,external_id:String(item.kind==='article'?item.url:item.id),title:item.title,cover_url:item.image,snapshot:item,[field]:saved});announce();
  try{const row=await chatAction('kaidra_library_save',{item:{...item,provider:providerFor(item)},collection,saved});entries.set(key,row);notify(saved?`Added to ${collection==='favorites'?'Favorites':'Watchlist'}`:'Removed from your library');}
  catch{if(previous)entries.set(key,previous);else entries.delete(key);notify('Could not save that change. Your library has been restored.');}
  finally{pending.delete(key);announce();}
}
async function connect(){
 if(!document.getElementById('profile-favorites'))return;
 try{await libraryReady();}catch{}
 if(!userId||channel)return;
 channel=supabase.channel(`library:${userId}`).on('postgres_changes',{event:'*',schema:'public',table:'user_watchlist',filter:`user_id=eq.${userId}`},()=>loadLibrary({refresh:true}).catch(()=>{})).subscribe(status=>{if(status==='SUBSCRIBED')loadLibrary({refresh:true}).catch(()=>{});});
}
connect();window.addEventListener('pageshow',event=>{if(event.persisted)connect();});window.addEventListener('pagehide',()=>{if(channel)supabase.removeChannel(channel);channel=null;});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&document.getElementById('profile-favorites'))loadLibrary().catch(()=>{});});
