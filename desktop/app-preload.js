// The only things the TaskSphere page can ask the desktop app to do
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tasksphereDesktop', {
  show: () => ipcRenderer.send('app:show'),                       // a notification was clicked
  setInCall: (value) => ipcRenderer.send('app:in-call', !!value), // warn before hiding the window during a huddle
});
