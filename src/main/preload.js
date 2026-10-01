'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('worldforge', {
  openScanDialog: () => ipcRenderer.invoke('scan:openDialog'),
  saveWorld: (json, filePath) => ipcRenderer.invoke('world:save', { json, filePath }),
  openWorld: () => ipcRenderer.invoke('world:open'),
  exportGlb: (data) => ipcRenderer.invoke('export:glb', data),
  startReceiver: (port) => ipcRenderer.invoke('receiver:start', port),
  stopReceiver: () => ipcRenderer.invoke('receiver:stop'),
  receiverInfo: () => ipcRenderer.invoke('receiver:info'),
  onScanReceived: (cb) => ipcRenderer.on('scan:received', (_e, scan) => cb(scan)),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, action) => cb(action)),
});
