// Bridge for the screen-share picker window (picker.html)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  getSources: () => ipcRenderer.invoke('picker:sources'),
  choose: (id) => ipcRenderer.send('picker:choose', id),
});
