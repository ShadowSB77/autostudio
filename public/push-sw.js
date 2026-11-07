// Web-push handler, imported into the generated service worker.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: 'Напоминание', body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Напоминание о записи', {
    body: data.body || '',
    icon: data.icon,
    data: { url: data.url || '' },
    tag: 'booking-reminder',
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data && event.notification.data.url || '', self.registration.scope).href;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.startsWith(url) && 'focus' in c) return c.focus();
    return clients.openWindow(url);
  }));
});
