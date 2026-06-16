/* Electron entry point — wraps the studio (index.html) in a native window.
 * The web app is untouched: same files, same behavior as in the browser. */
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: 'Marionette Studio',
    backgroundColor: '#1e1e24',
  });

  win.loadFile(path.join(__dirname, '..', 'index.html'));

  // "▶ Test in Game" calls window.open('game.html') — give it a real window.
  // Anything pointing outside the app goes to the system browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('file:')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 960,
          height: 600,
          title: 'Marionette — Game Test',
          backgroundColor: '#1e1e24',
        },
      };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
