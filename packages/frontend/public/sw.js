/**
 * Service Worker for Chat3D
 * Handles push notification display and click events.
 * Enables desktop notifications even when the browser tab is closed.
 */

/* eslint-disable no-restricted-globals */

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }

  const { title, body, tag, url } = payload;

  const options = {
    body: body || "",
    tag: tag || "chat3d",
    data: { url: url || "/" },
    // Don't re-buzz if same tag already showing (replace silently)
    renotify: false,
  };

  event.waitUntil(
    self.registration.showNotification(title || "Chat3D", options),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const urlToOpen = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        // Focus existing tab if one exists
        for (const client of clients) {
          if (client.url.includes(self.location.origin) && "focus" in client) {
            // Navigate to the correct URL if needed
            if (urlToOpen !== "/" && !client.url.endsWith(urlToOpen)) {
              client.navigate(urlToOpen);
            }
            return client.focus();
          }
        }
        // Otherwise open a new window
        return self.clients.openWindow(urlToOpen);
      }),
  );
});
