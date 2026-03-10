const { app, BrowserWindow, Menu, dialog, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const pkg = require("./package.json");

let mainWindow;
const appIcon = path.join(__dirname, "assets", "icon.png");

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1080,
    minHeight: 720,
    title: pkg.productName,
    icon: appIcon,
    backgroundColor: "#f4efe7",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await mainWindow.loadFile(path.join(__dirname, "index.html"));
}

function sendMenuAction(action) {
  mainWindow?.webContents.send("menu-action", action);
}

async function showAboutDialog() {
  await dialog.showMessageBox(mainWindow, {
    type: "info",
    title: `About ${pkg.productName}`,
    message: pkg.productName,
    detail: [
      `Version ${pkg.version}`,
      "Portable edition for Windows",
      "A focused Markdown editor inspired by the Typora workflow."
    ].join("\n"),
    buttons: ["OK"],
    icon: appIcon
  });
}

function buildMenu() {
  const template = [
    {
      label: "文件",
      submenu: [
        { label: "新建", accelerator: "CmdOrCtrl+N", click: () => sendMenuAction("new") },
        { label: "打开", accelerator: "CmdOrCtrl+O", click: () => sendMenuAction("open") },
        { type: "separator" },
        { label: "保存", accelerator: "CmdOrCtrl+S", click: () => sendMenuAction("save") },
        { label: "另存为", accelerator: "CmdOrCtrl+Shift+S", click: () => sendMenuAction("save-as") },
        { type: "separator" },
        { role: "quit", label: "退出" }
      ]
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" }
      ]
    },
    {
      label: "视图",
      submenu: [
        { label: "切换源码模式", accelerator: "CmdOrCtrl+Shift+M", click: () => sendMenuAction("toggle-mode") },
        { type: "separator" },
        { role: "reload", label: "重新加载" },
        { role: "togglefullscreen", label: "全屏" }
      ]
    },
    {
      label: "帮助",
      submenu: [
        { label: "关于 FreeMarkDown", click: () => showAboutDialog() }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle("dialog:open-markdown", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [
      { name: "Markdown", extensions: ["md", "markdown", "txt"] },
      { name: "All Files", extensions: ["*"] }
    ]
  });

  if (result.canceled || !result.filePaths[0]) {
    return null;
  }

  const filePath = result.filePaths[0];
  const markdown = await fs.readFile(filePath, "utf8");
  return { filePath, markdown };
});

ipcMain.handle("dialog:save-markdown", async (_event, payload) => {
  const defaultPath = payload.filePath || path.join(app.getPath("documents"), `${payload.title || "untitled"}.md`);
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath,
    filters: [{ name: "Markdown", extensions: ["md"] }]
  });

  if (result.canceled || !result.filePath) {
    return null;
  }

  await fs.writeFile(result.filePath, payload.markdown, "utf8");
  return { filePath: result.filePath };
});

ipcMain.handle("file:save-markdown", async (_event, payload) => {
  if (!payload.filePath) {
    return null;
  }

  const targetFilePath = payload.nextFilePath || payload.filePath;
  if (targetFilePath !== payload.filePath && await pathExists(targetFilePath)) {
    return {
      error: "TARGET_EXISTS",
      message: `同目录下已存在文件：${path.basename(targetFilePath)}`,
      filePath: payload.filePath
    };
  }

  await fs.writeFile(targetFilePath, payload.markdown, "utf8");
  if (targetFilePath !== payload.filePath && await pathExists(payload.filePath)) {
    await fs.unlink(payload.filePath);
  }

  return {
    filePath: targetFilePath,
    renamed: targetFilePath !== payload.filePath
  };
});

ipcMain.handle("window:set-title", (_event, title) => {
  if (mainWindow) {
    mainWindow.setTitle(title || pkg.productName);
  }
});

app.whenReady().then(async () => {
  buildMenu();
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

