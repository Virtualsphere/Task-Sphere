// Desktop (operating-system) notifications via the browser's Notification API.
// They appear while TaskSphere is open in a tab, even in the background or minimised.
// Clicking one brings the tab to the front and opens the related page.

export const desktopSupported = () => typeof window !== 'undefined' && 'Notification' in window;
export const desktopPermission = () => (desktopSupported() ? Notification.permission : 'unsupported');

export async function askDesktopPermission() {
  if (!desktopSupported()) return 'unsupported';
  try { return await Notification.requestPermission(); } catch { return Notification.permission; }
}

let navigateTo = null;
export const setNotificationNavigator = (fn) => { navigateTo = fn; };

const open = new Map(); // tag -> Notification (so it can be closed later, e.g. when a huddle ends)

/**
 * Show a desktop notification. Returns false when not allowed.
 * `tag` replaces an earlier notification with the same tag (no duplicates),
 * `sticky` keeps it on screen until the person acts on it (used for huddle calls).
 */
export function showDesktop({ title, body, tag, path, sticky = false, silent = false }) {
  if (desktopPermission() !== 'granted') return false;
  try {
    const n = new Notification(title, {
      body: String(body || '').slice(0, 240),
      tag,
      renotify: !!tag,
      requireInteraction: sticky,
      silent,
      icon: '/icon-192.png',
      badge: '/favicon-32.png',
    });
    n.onclick = () => {
      window.tasksphereDesktop?.show(); // desktop app: the window may be hidden
      window.focus();
      if (path && navigateTo) navigateTo(path);
      n.close();
    };
    n.onclose = () => { if (tag && open.get(tag) === n) open.delete(tag); };
    if (tag) open.set(tag, n);
    return true;
  } catch {
    return false; // e.g. some mobile browsers only allow notifications from a service worker
  }
}

export function closeDesktop(tag) {
  open.get(tag)?.close();
  open.delete(tag);
}
