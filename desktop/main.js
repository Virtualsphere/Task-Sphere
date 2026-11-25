// TaskSphere desktop app (Windows + macOS).
// A native window around the live TaskSphere site, so the website, desktop app and
// server always share the same code and data. Nothing here changes the website.
const {
  app, BrowserWindow, Menu, Notification, Tray, dialog, shell, session, desktopCapturer, ipcMain, nativeImage,
} = require('electron');
const path = require('path');
const fs = require('fs');

// Override with TASKSPHERE_URL=http://localhost:5000 npm start to test against a local server
const APP_URL = (process.env.TASKSPHERE_URL || 'https://pm.virtualspheretechnologies.in').replace(/\/$/, '');
const APP_ORIGIN = new URL(APP_URL).origin;
const isMac = process.platform === 'darwin';

const ICON = path.join(__dirname, 'build', 'icon.png');

let mainWindow = null;
let tray = null;
let quitting = false; // really quitting (tray menu, Cmd+Q, shutdown), as opposed to closing the window
let inCall = false;   // told by the page (see app-preload.js)

// Google refuses to sign in from browsers it thinks are "embedded" (it looks for
// "Electron" in the user agent). Present as the plain Chrome that Electron is built on.
app.userAgentFallback = app.userAgentFallback
  .replace(/\sElectron\/\S+/, '')
  .replace(/\sTaskSphere\/\S+/, '');

// Windows: notifications only show with the app id set (must match build.appId)
if (process.platform === 'win32') app.setAppUserModelId('com.virtualsphere.tasksphere');

// One window only: opening the app again focuses the existing window
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
}

// ---------- URL rules ----------
const isOwnUrl = (url) => {
  try {
    if (url.startsWith('blob:')) url = url.slice(5); // files/images opened from chats
    return new URL(url).origin === APP_ORIGIN;
  } catch { return false; }
};
const isGoogleSignIn = (url) => {
  try { return /(^|\.)accounts\.google\.com$/.test(new URL(url).hostname); } catch { return false; }
};
const openExternal = (url) => {
  if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
};

// ---------- Remember window size/position ----------
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
function loadWindowState() {
  try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { return { width: 1400, height: 900 }; }
}
function saveWindowState(win, extra = {}) {
  try {
    const b = win.getNormalBounds();
    fs.writeFileSync(stateFile(), JSON.stringify({ ...loadWindowState(), ...b, maximized: win.isMaximized(), ...extra }));
  } catch { /* not important */ }
}

// ---------- Running in the background ----------
// Closing the window only hides it, so huddle calls still ring and messages still notify.
// Quit from the tray icon (Windows) or with Cmd+Q / the Dock (macOS).
function showWindow() {
  if (!mainWindow) { if (app.isReady()) createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function hideWindow() {
  // Never leave someone on a call in a window they can't see without saying so: the microphone stays on
  if (inCall) {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question', title: 'TaskSphere', message: 'You are in a huddle',
      detail: 'If you close the window, the huddle keeps going in the background and people can still hear you.',
      buttons: ['Keep window open', 'Continue in background'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (choice === 0) return;
  }
  const win = mainWindow;
  const firstTime = !loadWindowState().backgroundTipShown;
  saveWindowState(win, { backgroundTipShown: true });
  // macOS: hiding a full-screen window leaves a black screen, so leave full screen first
  if (isMac && win.isFullScreen()) {
    win.once('leave-full-screen', () => win.hide());
    win.setFullScreen(false);
  } else {
    win.hide();
  }
  if (firstTime && Notification.isSupported()) {
    const n = new Notification({
      title: 'TaskSphere is still running',
      body: isMac ? 'You will still get calls and messages. To quit, press Cmd+Q.'
        : 'You will still get calls and messages. To quit, right-click the TaskSphere icon next to the clock.',
      icon: ICON,
    });
    n.on('click', showWindow);
    n.show();
  }
}

function setupTray() {
  if (isMac) return; // macOS: the Dock icon does this job
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 32, height: 32, quality: 'best' }));
  tray.setToolTip('TaskSphere');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open TaskSphere', click: showWindow },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
  tray.on('click', showWindow);
}

function setInCall(value) {
  inCall = value;
  tray?.setToolTip(value ? 'TaskSphere (in a huddle)' : 'TaskSphere');
}

// Messages from the page (app-preload.js); only TaskSphere itself in the main window is listened to
const fromApp = (e) => mainWindow && e.sender === mainWindow.webContents && isOwnUrl(e.senderFrame?.url || '');
ipcMain.on('app:show', (e) => { if (fromApp(e)) showWindow(); });
ipcMain.on('app:in-call', (e, value) => { if (fromApp(e)) setInCall(value === true); });

// ---------- Main window ----------
function createWindow() {
  const state = loadWindowState();
  mainWindow = new BrowserWindow({
    x: state.x, y: state.y, width: state.width, height: state.height,
    minWidth: 900, minHeight: 600,
    title: 'TaskSphere',
    icon: ICON,
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'app-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  if (state.maximized) mainWindow.maximize();
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (e) => {
    if (quitting) { saveWindowState(mainWindow); return; }
    e.preventDefault();
    hideWindow();
  });
  mainWindow.on('closed', () => { mainWindow = null; setInCall(false); });
  // Windows is shutting down or signing out: don't hold it up
  mainWindow.on('query-session-end', () => { quitting = true; });
  mainWindow.on('session-end', () => { quitting = true; });

  const wc = mainWindow.webContents;

  // New windows: Google sign-in popup and our own files stay in the app; everything else
  // (Meet links, attachments on other sites, etc.) opens in the default browser.
  wc.setWindowOpenHandler(({ url }) => {
    if (isGoogleSignIn(url) || isOwnUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520, height: 680, autoHideMenuBar: true,
          webPreferences: { preload: undefined, contextIsolation: true, nodeIntegration: false, sandbox: true },
        },
      };
    }
    openExternal(url);
    return { action: 'deny' };
  });

  // The main window never navigates away from TaskSphere
  wc.on('will-navigate', (e, url) => {
    if (!isOwnUrl(url)) { e.preventDefault(); openExternal(url); }
  });

  wc.on('did-navigate', () => setInCall(false)); // page reloaded: any call is over

  // Server unreachable / no internet → friendly retry page
  wc.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* aborted */) return;
    mainWindow.loadFile(path.join(__dirname, 'offline.html'), { query: { url: url || APP_URL } });
  });

  mainWindow.loadURL(APP_URL);
}

// ---------- Permissions (camera, mic, notifications, screen share) ----------
function setupPermissions() {
  const ses = session.defaultSession;
  const allowed = new Set(['media', 'notifications', 'fullscreen', 'clipboard-sanitized-write', 'display-capture']);

  ses.setPermissionRequestHandler((wc, permission, callback) => {
    callback(isOwnUrl(wc.getURL()) && allowed.has(permission));
  });
  // Electron passes the origin as a URL ("https://host/"), so compare normalized origins
  ses.setPermissionCheckHandler((_wc, permission, origin) => isOwnUrl(origin) && allowed.has(permission));

  // Huddle screen sharing (navigator.mediaDevices.getDisplayMedia)
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 200 },
        fetchWindowIcons: false,
      });
      const chosen = await pickScreenSource(sources);
      // Rejecting = calling back with no video; the page treats it as "cancelled"
      callback(chosen ? { video: chosen } : {});
    } catch {
      callback({});
    }
  }, { useSystemPicker: true }); // macOS 15+: native picker; elsewhere our own picker below
}

// Small window listing screens/windows to share
function pickScreenSource(sources) {
  return new Promise((resolve) => {
    const picker = new BrowserWindow({
      parent: mainWindow, modal: true, width: 760, height: 560, resizable: false,
      minimizable: false, maximizable: false, title: 'Share your screen',
      autoHideMenuBar: true, show: false,
      webPreferences: { preload: path.join(__dirname, 'picker-preload.js'), contextIsolation: true, sandbox: true },
    });
    let done = false;
    const finish = (id) => {
      if (done) return;
      done = true;
      ipcMain.removeHandler('picker:sources');
      ipcMain.removeAllListeners('picker:choose');
      resolve(sources.find((s) => s.id === id) || null);
      if (!picker.isDestroyed()) picker.close();
    };
    ipcMain.handle('picker:sources', () => sources.map((s) => ({
      id: s.id, name: s.name, isScreen: s.id.startsWith('screen:'), thumbnail: s.thumbnail.toDataURL(),
    })));
    ipcMain.on('picker:choose', (_e, id) => finish(id));
    picker.on('closed', () => finish(null));
    picker.once('ready-to-show', () => picker.show());
    picker.loadFile(path.join(__dirname, 'picker.html'));
  });
}

// ---------- Menu ----------
// macOS needs an app menu, otherwise Cmd+C / Cmd+V / Cmd+Q don't work.
function setupMenu() {
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    ...(isMac ? [{ role: 'fileMenu' }] : []),
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- App lifecycle ----------
app.whenReady().then(() => {
  setupPermissions();
  setupMenu();
  if (isMac && app.dock) app.dock.setIcon(nativeImage.createFromPath(ICON));
  createWindow();
  setupTray();
  if (!isMac && mainWindow) mainWindow.setMenuBarVisibility(false); // Windows: menu hidden, Alt shows it

  // macOS: clicking the dock icon reopens the window
  app.on('activate', () => showWindow());
});

app.on('before-quit', () => { quitting = true; });

app.on('window-all-closed', () => {
  if (!isMac) app.quit(); // macOS apps stay in the dock until Cmd+Q
});
