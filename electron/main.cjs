const { app, BrowserWindow, screen } = require('electron');
const path = require('path');
const fs = require('fs');

// Icon — safe fallback if file missing
const ICON_PATH = path.join(__dirname, 'icon.png');
const appIcon = fs.existsSync(ICON_PATH) ? ICON_PATH : undefined;

let mainWindow = null;
let splashWindow = null;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SPLASH SCREEN — Animated MMB Logo
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function createSplashWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  splashWindow = new BrowserWindow({
    width: 500,
    height: 400,
    x: Math.round((width - 500) / 2),
    y: Math.round((height - 400) / 2),
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.setMenuBarVisibility(false);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN WINDOW
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function createMainWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.min(1400, width - 100),
    height: Math.min(900, height - 100),
    minWidth: 1000,
    minHeight: 700,
    show: false,
    frame: true,
    title: 'MMB Agent 24/7',
    icon: appIcon,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Dev: load Vite dev server | Prod: load built index.html
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:5178');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.setMenuBarVisibility(false);

  mainWindow.once('ready-to-show', () => {
    setTimeout(() => {
      if (splashWindow) {
        splashWindow.close();
        splashWindow = null;
      }
      mainWindow.show();
      mainWindow.focus();
    }, 1000);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// START BACKEND — runs inside Electron's Node.js
// No system Node.js installation needed on any PC
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function startBackend() {
  // Packaged app: server is in extraResources (real filesystem, writable)
  // Dev: server is at project root/server/
  const serverPath = app.isPackaged
    ? path.join(process.resourcesPath, 'server', 'index.cjs')
    : path.join(__dirname, '..', 'server', 'index.cjs');

  console.log('[Electron] Loading backend:', serverPath);
  console.log('[Electron] Using Electron built-in Node.js — no system Node.js needed');

  // Intercept process.exit() so server shutdown doesn't kill Electron abruptly
  // Instead, route it through app.quit() for clean window teardown
  const _realExit = process.exit.bind(process);
  process.exit = (code) => {
    console.log(`[Electron] Server called process.exit(${code ?? 0}) — routing to app.quit()`);
    app.quit();
    // Hard exit after 3s if app.quit() hangs
    setTimeout(() => _realExit(code ?? 0), 3000);
  };

  try {
    require(serverPath);
    console.log('[Electron] Backend server running inside Electron process');
  } catch (err) {
    console.error('[Electron] Backend failed to load:', err.message);
    // Show error and quit after a moment so user can see the log
    setTimeout(() => app.quit(), 3000);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// APP LIFECYCLE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.whenReady().then(() => {
  // 1. Show splash
  createSplashWindow();

  // 2. Load backend server into this process (no spawn needed)
  startBackend();

  // 3. Give server 3s to initialise, then show main window
  setTimeout(() => {
    createMainWindow();
  }, 3000);
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  // Trigger server's graceful shutdown (SIGTERM handler in index.cjs)
  try { process.emit('SIGTERM'); } catch { /* ignore */ }
});
