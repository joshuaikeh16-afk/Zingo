// Only public offline assets are cached. Auth, chat, and library responses stay on the network.
const CACHE = 'kaidra-offline-v1';
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['/offline.html','/assets/app-icon-192.png','/assets/app-icon-512.png','/assets/app-icon-maskable.png']))));
self.addEventListener('activate', event => event.waitUntil((async()=>{for(const name of await caches.keys())if(name.startsWith('kaidra-offline-')&&name!==CACHE)await caches.delete(name);await self.clients.claim();})()));
self.addEventListener('message', event => {if(event.data?.type==='ACTIVATE_UPDATE')self.skipWaiting();});
self.addEventListener('fetch', event => {
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin)return;
 if(request.mode==='navigate')event.respondWith(fetch(request).catch(async()=>await caches.match('/offline.html')||Response.error()));
});
self.addEventListener('notificationclick', event => {
 event.notification.close();event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true}),existing=windows.find(client=>new URL(client.url).pathname==='/app.html');
  const destination='/app.html#home';if(existing){await existing.navigate(destination);return existing.focus();}return self.clients.openWindow(destination);
 })());
});
