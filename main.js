const { app, BrowserWindow, Menu, dialog, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const HTMLtoDOCX = require("html-to-docx");
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

function sanitizeFileName(name) {
  const normalized = String(name || "").replace(/[\\/:*?"<>|]/g, "-").trim();
  return normalized || "untitled";
}

function getDefaultExportPath(filePath, title, extension) {
  const safeTitle = sanitizeFileName(title);
  if (filePath) {
    return filePath.replace(/\.[^.]+$/, extension);
  }
  return path.join(app.getPath("documents"), `${safeTitle}${extension}`);
}

async function resolveExportPath(options) {
  if (options.filePath) {
    return options.filePath;
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: options.defaultPath,
    filters: options.filters
  });

  if (result.canceled || !result.filePath) {
    return null;
  }

  return result.filePath;
}

async function exportPdf(payload) {
  const targetPath = await resolveExportPath({
    filePath: payload.filePath,
    defaultPath: getDefaultExportPath(payload.currentFilePath, payload.title, ".pdf"),
    filters: [{ name: "PDF", extensions: ["pdf"] }]
  });
  if (!targetPath) {
    return null;
  }

  const exportWindow = new BrowserWindow({
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: true,
      javascript: false
    }
  });

  try {
    await exportWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(payload.documentHtml)}`);
    const pdfBuffer = await exportWindow.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      generateTaggedPDF: true,
      generateDocumentOutline: true,
      margins: {
        top: 0,
        bottom: 0,
        left: 0,
        right: 0
      }
    });
    await fs.writeFile(targetPath, pdfBuffer);
    return { filePath: targetPath };
  } finally {
    if (!exportWindow.isDestroyed()) {
      exportWindow.destroy();
    }
  }
}

async function exportWord(payload) {
  const targetPath = await resolveExportPath({
    filePath: payload.filePath,
    defaultPath: getDefaultExportPath(payload.currentFilePath, payload.title, ".docx"),
    filters: [{ name: "Word Document", extensions: ["docx"] }]
  });
  if (!targetPath) {
    return null;
  }

  const docxBuffer = await HTMLtoDOCX(payload.documentHtml, null, {
    title: payload.title,
    creator: pkg.productName,
    font: "Segoe UI",
    fontSize: 22,
    margins: {
      top: 1080,
      right: 960,
      bottom: 1080,
      left: 960
    },
    table: {
      row: {
        cantSplit: true
      }
    },
    decodeUnicode: true,
    lang: "zh-CN"
  });
  await fs.writeFile(targetPath, docxBuffer);
  return { filePath: targetPath };
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
        { type: "separator" },
        {
          label: "导出",
          submenu: [
            { label: "Markdown", accelerator: "CmdOrCtrl+Shift+S", click: () => sendMenuAction("export-markdown") },
            { label: "PDF", accelerator: "CmdOrCtrl+Alt+P", click: () => sendMenuAction("export-pdf") },
            { label: "Word (.docx)", click: () => sendMenuAction("export-word") }
          ]
        },
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

ipcMain.handle("file:export-pdf", async (_event, payload) => exportPdf(payload));
ipcMain.handle("file:export-word", async (_event, payload) => exportWord(payload));

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

