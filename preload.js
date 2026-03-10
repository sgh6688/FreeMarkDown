const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  openMarkdown: () => ipcRenderer.invoke("dialog:open-markdown"),
  saveMarkdown: (payload) => ipcRenderer.invoke("file:save-markdown", payload),
  saveMarkdownAs: (payload) => ipcRenderer.invoke("dialog:save-markdown", payload),
  exportPdf: (payload) => ipcRenderer.invoke("file:export-pdf", payload),
  exportWord: (payload) => ipcRenderer.invoke("file:export-word", payload),
  setWindowTitle: (title) => ipcRenderer.invoke("window:set-title", title),
  onMenuAction: (handler) => ipcRenderer.on("menu-action", (_event, action) => handler(action))
});
