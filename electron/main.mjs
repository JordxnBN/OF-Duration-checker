import path from "node:path";
import electronMain from "electron/main";
import dbModule from "./db.cjs";

const { app, BrowserWindow, clipboard, ipcMain, shell } = electronMain;
const { createStore } = dbModule;
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

let mainWindow = null;
let store = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: "Worklog",
    backgroundColor: "#f4efe3",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(import.meta.dirname, "preload.mjs"),
    },
  });

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(import.meta.dirname, "..", "dist", "index.html"));
  }
}

function requireStore() {
  if (!store) {
    throw new Error("Store not initialized.");
  }
  return store;
}

function validateDateKey(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Date must be in YYYY-MM-DD format.");
  }
  return date;
}

function registerIpcHandlers() {
  ipcMain.handle("worklog:get-entry", (_event, date) => {
    return requireStore().getEntry(validateDateKey(date));
  });

  ipcMain.handle("worklog:upsert-entry", (_event, input) => {
    if (!input || typeof input !== "object") {
      throw new Error("Invalid entry input.");
    }

    return requireStore().upsertEntry({
      date: validateDateKey(input.date),
      done: typeof input.done === "string" ? input.done : "",
      blocked: typeof input.blocked === "string" ? input.blocked : "",
      next: typeof input.next === "string" ? input.next : "",
    });
  });

  ipcMain.handle("worklog:list-entries", (_event, params) => {
    const safeParams = params && typeof params === "object" ? params : {};
    return requireStore().listEntries(safeParams);
  });

  ipcMain.handle("worklog:generate-weekly-summary", (_event, params) => {
    if (!params || typeof params !== "object") {
      throw new Error("Invalid weekly summary params.");
    }
    const weekStart = validateDateKey(params.weekStart);
    const format = params.format === "text" ? "text" : "markdown";
    return requireStore().createWeeklySummary({ weekStart, format });
  });

  ipcMain.handle("worklog:get-meta", () => {
    const userDataPath = app.getPath("userData");
    return {
      appVersion: app.getVersion(),
      dbPath: path.join(userDataPath, "worklog.sqlite"),
      theme: requireStore().getTheme(),
    };
  });

  ipcMain.handle("worklog:set-theme", (_event, theme) => {
    if (theme !== "light" && theme !== "dark") {
      throw new Error("Theme must be light or dark.");
    }
    return requireStore().setTheme(theme);
  });

  ipcMain.handle("worklog:copy-to-clipboard", (_event, text) => {
    clipboard.writeText(typeof text === "string" ? text : "");
    return true;
  });

  ipcMain.handle("worklog:open-data-folder", async () => {
    const result = await shell.openPath(app.getPath("userData"));
    return result.length === 0;
  });
}

app.whenReady().then(() => {
  const dbPath = path.join(app.getPath("userData"), "worklog.sqlite");
  store = createStore(dbPath);
  registerIpcHandlers();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (store) {
    store.close();
  }
});
