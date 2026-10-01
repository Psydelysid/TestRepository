'use strict';
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs/promises');
const QRCode = require('qrcode');
const { ScanServer, SUPPORTED_EXTENSIONS, extensionOf } = require('./scan-server');

let mainWindow = null;
const scanServer = new ScanServer({
  onScan: (scan) => {
    if (!mainWindow) throw new Error('WorldForge window is not open');
    mainWindow.webContents.send('scan:received', {
      name: scan.name,
      ext: scan.ext,
      source: scan.source,
      data: scan.data.buffer.slice(scan.data.byteOffset, scan.data.byteOffset + scan.data.byteLength),
    });
  },
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#14161b',
    title: 'WorldForge',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
  // The renderer blocks unload while there are unsaved changes; ask the user.
  mainWindow.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question',
      buttons: ['Discard changes', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'You have unsaved changes in this world.',
      detail: 'Close anyway and lose them?',
    });
    if (choice === 0) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function menuAction(action) {
  return () => mainWindow?.webContents.send('menu', action);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New World', accelerator: 'CmdOrCtrl+N', click: menuAction('new') },
        { label: 'Open World…', accelerator: 'CmdOrCtrl+O', click: menuAction('open') },
        { label: 'Save World', accelerator: 'CmdOrCtrl+S', click: menuAction('save') },
        { label: 'Save World As…', accelerator: 'CmdOrCtrl+Shift+S', click: menuAction('saveAs') },
        { type: 'separator' },
        { label: 'Import Scan / Model…', accelerator: 'CmdOrCtrl+I', click: menuAction('import') },
        { label: 'Export as GLB…', accelerator: 'CmdOrCtrl+E', click: menuAction('exportGlb') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        // These shortcuts are handled in the renderer so they don't hijack text fields.
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', registerAccelerator: false, click: menuAction('undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', registerAccelerator: false, click: menuAction('redo') },
        { type: 'separator' },
        { label: 'Duplicate', accelerator: 'CmdOrCtrl+D', registerAccelerator: false, click: menuAction('duplicate') },
        { label: 'Delete', accelerator: 'Delete', registerAccelerator: false, click: menuAction('delete') },
        { label: 'Focus Selection', accelerator: 'F', registerAccelerator: false, click: menuAction('focus') },
      ],
    },
    {
      label: 'Scans',
      submenu: [
        { label: 'Receive Scans from Devices…', click: menuAction('receiver') },
        { label: 'Import Scan File…', click: menuAction('import') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const worldFilters = [{ name: 'WorldForge World', extensions: ['world', 'json'] }];

function registerIpc() {
  ipcMain.handle('scan:openDialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import scan or model',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '3D scans & models', extensions: SUPPORTED_EXTENSIONS },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (result.canceled) return [];
    return Promise.all(result.filePaths.map(readScanFile));
  });

  ipcMain.handle('world:save', async (_e, { json, filePath }) => {
    let target = filePath;
    if (!target) {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Save world',
        defaultPath: 'my-world.world',
        filters: worldFilters,
      });
      if (result.canceled) return null;
      target = result.filePath;
    }
    await fs.writeFile(target, json, 'utf8');
    return target;
  });

  ipcMain.handle('world:open', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open world',
      properties: ['openFile'],
      filters: worldFilters,
    });
    if (result.canceled) return null;
    const filePath = result.filePaths[0];
    return { filePath, json: await fs.readFile(filePath, 'utf8') };
  });

  ipcMain.handle('export:glb', async (_e, data) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export world as GLB',
      defaultPath: 'world.glb',
      filters: [{ name: 'glTF Binary', extensions: ['glb'] }],
    });
    if (result.canceled) return null;
    await fs.writeFile(result.filePath, Buffer.from(data));
    return result.filePath;
  });

  ipcMain.handle('receiver:start', async (_e, port) => withQr(await scanServer.start(port || 8765)));
  ipcMain.handle('receiver:stop', async () => { await scanServer.stop(); return { running: false }; });
  ipcMain.handle('receiver:info', async () => withQr(scanServer.info()));
}

async function withQr(info) {
  if (!info.running) return info;
  const qr = await QRCode.toDataURL(info.urls[0], { margin: 1, width: 220 });
  return { ...info, qr };
}

async function readScanFile(filePath) {
  const buf = await fs.readFile(filePath);
  return {
    name: path.basename(filePath),
    ext: extensionOf(filePath),
    source: 'file',
    // Lets .gltf files resolve their external .bin / texture files.
    baseUrl: pathToFileURL(path.dirname(filePath)).href + '/',
    data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
}

app.whenReady().then(() => {
  registerIpc();
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { scanServer.stop(); });
