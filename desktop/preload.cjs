const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('builderDesktop', {
  selectRepositoryRoot: () => ipcRenderer.invoke('builder:select-repository-root'),
  selectInputFolder: (options = {}) => ipcRenderer.invoke('builder:select-input-folder', options),
  selectInputFiles: (options = {}) => ipcRenderer.invoke('builder:select-input-files', options),
});
