self.addEventListener("install", (event) => {
  // Activate immediately.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        // Clear any caches created by older service workers.
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      } catch {
        // ignore
      }
      try {
        await self.registration.unregister();
      } catch {
        // ignore
      }
      try {
        // Let controlled pages pick up the non-SW network path.
        const clientsList = await self.clients.matchAll({ type: "window" });
        await Promise.all(clientsList.map((client) => client.navigate(client.url)));
      } catch {
        // ignore
      }
    })(),
  );
});

// No fetch handler on purpose.

