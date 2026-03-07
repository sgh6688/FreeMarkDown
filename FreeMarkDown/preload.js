const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  openMarkdown: () => ipcRenderer.invoke("dialog:open-markdown"),
  saveMarkdown: (payload) => ipcRenderer.invoke("file:save-markdown", payload),
  saveMarkdownAs: (payload) => ipcRenderer.invoke("dialog:save-markdown", payload),
  setWindowTitle: (title) => ipcRenderer.invoke("window:set-title", title),
  onMenuAction: (handler) => ipcRenderer.on("menu-action", (_event, action) => handler(action))
});
