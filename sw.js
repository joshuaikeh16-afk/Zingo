// Used for notifications requested by an open Kaidra session. No offline cache.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).pathname === '/app.html');
    if (existing) { await existing.navigate('/app.html#home'); return existing.focus(); }
    return self.clients.openWindow('/app.html#home');
  })());
