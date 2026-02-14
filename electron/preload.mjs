import electronRenderer from "electron/renderer";

const { contextBridge, ipcRenderer } = electronRenderer;

contextBridge.exposeInMainWorld("worklog", {
  getEntry: (date) => ipcRenderer.invoke("worklog:get-entry", date),
  upsertEntry: (input) => ipcRenderer.invoke("worklog:upsert-entry", input),
  listEntries: (params) => ipcRenderer.invoke("worklog:list-entries", params),
  generateWeeklySummary: (params) => ipcRenderer.invoke("worklog:generate-weekly-summary", params),
  getMeta: () => ipcRenderer.invoke("worklog:get-meta"),
  setTheme: (theme) => ipcRenderer.invoke("worklog:set-theme", theme),
  copyToClipboard: (text) => ipcRenderer.invoke("worklog:copy-to-clipboard", text),
  openDataFolder: () => ipcRenderer.invoke("worklog:open-data-folder"),
});
