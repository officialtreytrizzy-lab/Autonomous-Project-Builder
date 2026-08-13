import { contextBridge, ipcRenderer } from 'electron';

// Expose safe desktop capabilities to the Next.js frontend
contextBridge.exposeInMainWorld('desktopApi', {
  isDesktop: true,
  platform: process.platform,
  sendNotification: (title, body) => ipcRenderer.send('desktop:notify', { title, body }),
  openPath: (targetPath) => ipcRenderer.invoke('desktop:open-path', targetPath),
  minimize: () => ipcRenderer.send('desktop:minimize'),
  maximize: () => ipcRenderer.send('desktop:maximize'),
  close: () => ipcRenderer.send('desktop:close'),
  onServerReady: (callback) => ipcRenderer.on('server:ready', (_event, data) => callback(data)),
});
