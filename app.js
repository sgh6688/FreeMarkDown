const STORAGE_KEY = "inkdown-document";
const TIPS_STORAGE_KEY = "freemarkdown-tips-state";
const TOOLBAR_STORAGE_KEY = "freemarkdown-toolbar-state";
const LAYOUT_STORAGE_KEY = "freemarkdown-layout-state";
const desktopAPI = window.electronAPI || null;
const supportsFileSystemAccess = typeof window.showOpenFilePicker === "function" && typeof window.showSaveFilePicker === "function";

const appShell = document.querySelector(".app-shell");
const editor = document.getElementById("editor");
const sourceEditor = document.getElementById("sourceEditor");
const filePicker = document.getElementById("filePicker");
const documentTitle = document.getElementById("documentTitle");
const wordCount = document.getElementById("wordCount");
const lineCount = document.getElementById("lineCount");
const imageCount = document.getElementById("imageCount");
const saveState = document.getElementById("saveState");
const modeState = document.getElementById("modeState");
const filePathMeta = document.getElementById("filePathMeta");
const emptyDocumentTemplate = document.getElementById("emptyDocumentTemplate");
const editorFrame = document.getElementById("editorFrame");
const toggleModeButton = document.querySelector('[data-action="toggle-mode"]');
const outline = document.getElementById("outline");
const outlineCount = document.getElementById("outlineCount");
const dropOverlay = document.getElementById("dropOverlay");
const tipsPanel = document.getElementById("tipsPanel");
const tipsToggleButton = document.getElementById("tipsToggleButton");
const tipsCollapseButton = document.getElementById("tipsCollapseButton");
const leftRailToggleButton = document.getElementById("leftRailToggleButton");
const leftRailDockButton = document.getElementById("leftRailDockButton");
const exportMenuButton = document.getElementById("exportMenuButton");
const exportMenu = document.getElementById("exportMenu");
const exportMenuItems = document.querySelectorAll("[data-export-kind]");
const toolbarGroups = document.querySelectorAll("[data-toolbar-group]");
const tableActionButtons = document.querySelectorAll("[data-table-action]");

if (exportMenu.parentElement !== document.body) {
  document.body.append(exportMenu);
}

let sourceMode = false;
let saveTimer = null;
let dragDepth = 0;
let headingId = 0;
let currentFilePath = null;
let currentFileHandle = null;
let isDocumentDirty = false;
let lastActiveTableCell = null;
let exportMenuOpen = false;

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function splitTableCells(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isTableSeparator(line) {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim());
}

function buildTableHtml(headerLine, bodyLines) {
  const headers = splitTableCells(headerLine);
  const rows = bodyLines.map(splitTableCells);
  const head = `<thead><tr>${headers.map((cell) => `<th>${inlineMarkdownToHtml(cell)}</th>`).join("")}</tr></thead>`;
  const body = rows.length
    ? `<tbody>${rows.map((row) => `<tr>${headers.map((_, index) => `<td>${inlineMarkdownToHtml(row[index] || "")}</td>`).join("")}</tr>`).join("")}</tbody>`
    : "<tbody></tbody>";
  return `<table>${head}${body}</table>`;
}

function inlineMarkdownToHtml(text) {
  return escapeHtml(text)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/g, (_, alt, src, title) => {
      const caption = title ? `<figcaption>${escapeHtml(title)}</figcaption>` : "";
      return `<figure><img src="${escapeAttribute(src)}" alt="${escapeAttribute(alt || "image")}">${caption}</figure>`;
    })
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/_([^_]+)_/g, "<em>$1</em>");
}

function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let inCodeBlock = false;
  let codeLines = [];
  let listType = null;
  let inTaskList = false;

  function closeList() {
    if (inTaskList) {
      html.push("</ul>");
      inTaskList = false;
    }
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  }

  function closeCodeBlock() {
    if (inCodeBlock) {
      html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      inCodeBlock = false;
      codeLines = [];
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (line.trim().startsWith("```")) {
      closeList();
      if (inCodeBlock) {
        closeCodeBlock();
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (!line.trim()) {
      closeList();
      html.push("");
      continue;
    }

    if (line.includes("|") && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      closeList();
      const bodyLines = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|")) {
        bodyLines.push(lines[index]);
        index += 1;
      }
      index -= 1;
      html.push(buildTableHtml(line, bodyLines));
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      html.push(`<h${level}>${inlineMarkdownToHtml(headingMatch[2])}</h${level}>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      closeList();
      html.push(`<blockquote><p>${inlineMarkdownToHtml(line.replace(/^>\s?/, ""))}</p></blockquote>`);
      continue;
    }

    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      closeList();
      html.push("<hr>");
      continue;
    }

    const taskMatch = line.match(/^[-*]\s+\[( |x|X)\]\s+(.*)$/);
    if (taskMatch) {
      if (!inTaskList) {
        closeList();
        inTaskList = true;
        html.push('<ul class="task-list">');
      }
      const checked = taskMatch[1].toLowerCase() === "x";
      html.push(`<li class="${checked ? "is-checked" : ""}"><label><input type="checkbox" ${checked ? "checked" : ""} data-task-checkbox><span>${inlineMarkdownToHtml(taskMatch[2])}</span></label></li>`);
      continue;
    }

    const ulMatch = line.match(/^[-*]\s+(.*)$/);
    if (ulMatch) {
      if (listType !== "ul") {
        closeList();
        listType = "ul";
        html.push("<ul>");
      }
      html.push(`<li>${inlineMarkdownToHtml(ulMatch[1])}</li>`);
      continue;
    }

    const olMatch = line.match(/^\d+\.\s+(.*)$/);
    if (olMatch) {
      if (listType !== "ol") {
        closeList();
        listType = "ol";
        html.push("<ol>");
      }
      html.push(`<li>${inlineMarkdownToHtml(olMatch[1])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${inlineMarkdownToHtml(line)}</p>`);
  }

  closeList();
  closeCodeBlock();
  return html.join("\n");
}

function getInlineMarkdown(node) {
  return Array.from(node.childNodes).map((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      return child.textContent.replace(/\u00a0/g, " ");
    }
    if (child.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    const tag = child.tagName.toLowerCase();
    if (tag === "strong" || tag === "b") {
      return `**${getInlineMarkdown(child)}**`;
    }
    if (tag === "em" || tag === "i") {
      return `*${getInlineMarkdown(child)}*`;
    }
    if (tag === "code" && child.parentElement.tagName.toLowerCase() !== "pre") {
      return `\`${child.textContent}\``;
    }
    if (tag === "a") {
      return `[${getInlineMarkdown(child)}](${child.getAttribute("href") || "#"})`;
    }
    if (tag === "img") {
      return `![${child.getAttribute("alt") || "image"}](${child.getAttribute("src") || ""})`;
    }
    if (tag === "figure") {
      const image = child.querySelector("img");
      if (!image) {
        return getInlineMarkdown(child);
      }
      const caption = child.querySelector("figcaption")?.textContent?.trim();
      const alt = image.getAttribute("alt") || "image";
      const src = image.getAttribute("src") || "";
      return caption ? `![${alt}](${src} "${caption}")` : `![${alt}](${src})`;
    }
    if (tag === "span") {
      return getInlineMarkdown(child);
    }
    if (tag === "br") {
      return "\n";
    }
    return getInlineMarkdown(child);
  }).join("").trim();
}

function tableToMarkdown(table) {
  const rows = Array.from(table.querySelectorAll("tr")).map((row) => Array.from(row.children).map((cell) => getInlineMarkdown(cell)));
  if (!rows.length) {
    return "";
  }
  const header = `| ${rows[0].join(" | ")} |`;
  const divider = `| ${rows[0].map(() => "---").join(" | ")} |`;
  const body = rows.slice(1).map((row) => `| ${rows[0].map((_, index) => row[index] || "").join(" | ")} |`);
  return [header, divider, ...body].join("\n");
}

function pushBlock(lines, value) {
  const normalized = value.trim();
  if (!normalized) {
    return;
  }
  lines.push(normalized);
  lines.push("");
}

function hasNestedBlock(node) {
  return Array.from(node.children || []).some((child) => /^(H[1-3]|P|DIV|BLOCKQUOTE|PRE|UL|OL|FIGURE|TABLE|HR)$/.test(child.tagName));
}

function htmlToMarkdown(root) {
  const lines = [];

  Array.from(root.childNodes).forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      pushBlock(lines, node.textContent || "");
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const tag = node.tagName.toLowerCase();

    if (["h1", "h2", "h3"].includes(tag)) {
      pushBlock(lines, `${"#".repeat(Number(tag[1]))} ${getInlineMarkdown(node)}`);
      return;
    }

    if (tag === "p") {
      pushBlock(lines, getInlineMarkdown(node));
      return;
    }

    if (tag === "div") {
      if (hasNestedBlock(node)) {
        const nestedMarkdown = htmlToMarkdown(node);
        if (nestedMarkdown) {
          pushBlock(lines, nestedMarkdown);
        }
      } else {
        pushBlock(lines, getInlineMarkdown(node));
      }
      return;
    }

    if (tag === "blockquote") {
      pushBlock(lines, getInlineMarkdown(node).split("\n").map((line) => `> ${line}`).join("\n"));
      return;
    }

    if (tag === "pre") {
      pushBlock(lines, `\`\`\`\n${node.textContent.replace(/\n$/, "")}\n\`\`\``);
      return;
    }

    if (tag === "ul" && node.classList.contains("task-list")) {
      Array.from(node.children).forEach((child) => {
        const checked = child.querySelector('input[type="checkbox"]')?.checked;
        const text = getInlineMarkdown(child.querySelector("span") || child);
        lines.push(`- [${checked ? "x" : " "}] ${text}`);
      });
      lines.push("");
      return;
    }

    if (tag === "ul" || tag === "ol") {
      Array.from(node.children).forEach((child, index) => {
        const marker = tag === "ul" ? "- " : `${index + 1}. `;
        lines.push(`${marker}${getInlineMarkdown(child)}`);
      });
      lines.push("");
      return;
    }

    if (tag === "figure") {
      pushBlock(lines, getInlineMarkdown(node));
      return;
    }

    if (tag === "table") {
      pushBlock(lines, tableToMarkdown(node));
      return;
    }

    if (tag === "hr") {
      pushBlock(lines, "---");
      return;
    }

    pushBlock(lines, getInlineMarkdown(node));
  });

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function getMarkdown() {
  return sourceMode ? sourceEditor.value : htmlToMarkdown(editor);
}

function updateStats(markdown) {
  const normalized = markdown.trim();
  wordCount.textContent = normalized ? normalized.replace(/\s+/g, "").length : "0";
  lineCount.textContent = normalized ? String(markdown.split(/\r?\n/).length) : "0";
  imageCount.textContent = String((markdown.match(/!\[[^\]]*\]\(/g) || []).length);
}

function sanitizeFileName(name) {
  const normalized = (name || "").replace(/[\\/:*?"<>|]/g, "-").trim();
  return normalized || "untitled";
}

function getFilePathParts(filePath) {
  const fullPath = filePath || "";
  const fileName = fullPath.split(/[/\\]/).pop() || "";
  const extensionMatch = fileName.match(/(\.[^.]+)$/);
  const extension = extensionMatch?.[1] || ".md";
  const stem = extensionMatch ? fileName.slice(0, -extension.length) : fileName;
  return { fileName, extension, stem };
}

function getRenamedFilePath(title) {
  if (!currentFilePath) {
    return null;
  }

  const { fileName, extension, stem } = getFilePathParts(currentFilePath);
  const safeTitle = sanitizeFileName(title);
  if (safeTitle === stem) {
    return null;
  }

  return currentFilePath.replace(new RegExp(`${fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), `${safeTitle}${extension}`);
}

function buildExportHtmlDocument(title, contentHtml, options = {}) {
  const pageTitle = escapeHtml(title || "FreeMarkDown");
  const htmlTag = options.wordCompatible
    ? '<html lang="zh-CN" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">'
    : '<html lang="zh-CN">';

  return [
    "<!DOCTYPE html>",
    htmlTag,
    "<head>",
    '<meta charset="UTF-8">',
    `<title>${pageTitle}</title>`,
    options.wordCompatible ? "<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->" : "",
    "<style>",
    "@page { size: A4; margin: 18mm 16mm 20mm; }",
    "body { margin: 0; color: #1f2328; background: #ffffff; font-family: 'Segoe UI', 'PingFang SC', sans-serif; }",
    ".document { max-width: 820px; margin: 0 auto; padding: 0; line-height: 1.72; font-size: 14px; }",
    "h1, h2, h3 { margin: 1.4em 0 0.6em; line-height: 1.28; color: #111827; }",
    "h1 { font-size: 2em; border-bottom: 1px solid #d8dee4; padding-bottom: 0.3em; }",
    "h2 { font-size: 1.5em; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.25em; }",
    "h3 { font-size: 1.2em; }",
    "p, blockquote, pre, ul, ol, table, figure, hr { margin: 1em 0; }",
    "ul, ol { padding-left: 1.8em; }",
    "blockquote { padding-left: 1em; color: #4b5563; border-left: 4px solid #d1d5db; }",
    "pre { padding: 12px 14px; background: #f6f8fa; border: 1px solid #d8dee4; border-radius: 8px; overflow: hidden; white-space: pre-wrap; word-break: break-word; }",
    "code { padding: 0.12em 0.35em; background: rgba(175, 184, 193, 0.24); border-radius: 4px; font-family: Consolas, 'SFMono-Regular', monospace; }",
    "pre code { padding: 0; background: transparent; }",
    "table { width: 100%; border-collapse: collapse; table-layout: fixed; }",
    "th, td { border: 1px solid #d0d7de; padding: 7px 10px; text-align: left; vertical-align: top; }",
    "th { background: #f6f8fa; }",
    "img { max-width: 100%; height: auto; border-radius: 8px; }",
    "figure { display: block; }",
    "figcaption { color: #6b7280; font-size: 12px; margin-top: 6px; }",
    "a { color: #0969da; text-decoration: none; }",
    "hr { border: 0; border-top: 1px solid #d8dee4; }",
    "</style>",
    "</head>",
    "<body>",
    `<main class="document">${contentHtml}</main>`,
    "</body>",
    "</html>"
  ].filter(Boolean).join("");
}

function getExportPayload() {
  const markdown = getMarkdown();
  const title = documentTitle.value.trim() || "untitled";
  const contentHtml = markdownToHtml(markdown);
  return {
    title: sanitizeFileName(title),
    currentFilePath,
    markdown,
    documentHtml: buildExportHtmlDocument(title, contentHtml)
  };
}

function getFileMetaLabel() {
  if (currentFilePath) {
    return currentFilePath;
  }
  return desktopAPI || supportsFileSystemAccess ? "未关联文件" : "浏览器下载模式";
}

function refreshStatusMeta() {
  modeState.textContent = sourceMode ? "源码模式" : "所见即所得";
  filePathMeta.textContent = getFileMetaLabel();
  filePathMeta.title = currentFilePath || "";
}

function getWindowTitle() {
  const title = documentTitle.value.trim() || "未命名文档";
  const dirtyPrefix = isDocumentDirty ? "• " : "";
  const suffix = currentFilePath ? ` - ${currentFilePath}` : "";
  return `${dirtyPrefix}FreeMarkDown - ${title}${suffix}`;
}

function refreshWindowTitle() {
  if (desktopAPI) {
    desktopAPI.setWindowTitle(getWindowTitle());
  } else {
    document.title = getWindowTitle();
  }
}

function setExportMenuOpen(open) {
  exportMenuOpen = open;
  exportMenu.hidden = !open;
  exportMenuButton.setAttribute("aria-expanded", String(open));
  if (open) {
    updateExportMenuPosition();
  }
}

function toggleExportMenu(forceOpen = !exportMenuOpen) {
  setExportMenuOpen(forceOpen);
}

function updateExportMenuPosition() {
  if (!exportMenuOpen) {
    return;
  }

  const buttonRect = exportMenuButton.getBoundingClientRect();
  const menuWidth = exportMenu.offsetWidth;
  const menuHeight = exportMenu.offsetHeight;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const top = buttonRect.bottom + menuHeight + 12 <= viewportHeight
    ? buttonRect.bottom + 8
    : Math.max(12, buttonRect.top - menuHeight - 8);
  const left = Math.min(
    Math.max(12, buttonRect.right - menuWidth),
    Math.max(12, viewportWidth - menuWidth - 12)
  );

  exportMenu.style.top = `${Math.round(top)}px`;
  exportMenu.style.left = `${Math.round(left)}px`;
}

function readTipsState() {
  try {
    return JSON.parse(localStorage.getItem(TIPS_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function persistTipsState(state) {
  localStorage.setItem(TIPS_STORAGE_KEY, JSON.stringify(state));
}

function applyTipsState() {
  const state = readTipsState();
  const collapsed = Boolean(state.collapsed);
  tipsPanel.classList.toggle("is-collapsed", collapsed);
  tipsCollapseButton.textContent = collapsed ? "展开" : "收起";
  tipsToggleButton.textContent = collapsed ? "展开提示" : "折叠提示";
}

function setTipsState(partial) {
  const nextState = { ...readTipsState(), ...partial };
  persistTipsState(nextState);
  applyTipsState();
}

function readLayoutState() {
  try {
    return JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function persistLayoutState(state) {
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(state));
}

function applyLayoutState() {
  const state = readLayoutState();
  const leftRailCollapsed = Boolean(state.leftRailCollapsed) && window.innerWidth > 1180;
  appShell.classList.toggle("is-left-rail-collapsed", leftRailCollapsed);
  leftRailToggleButton.setAttribute("aria-expanded", String(!leftRailCollapsed));
  leftRailToggleButton.textContent = leftRailCollapsed ? "展开" : "折叠";
  leftRailDockButton.setAttribute("aria-hidden", String(!leftRailCollapsed));
}

function setLayoutState(partial) {
  const nextState = { ...readLayoutState(), ...partial };
  persistLayoutState(nextState);
  applyLayoutState();
}

function readToolbarState() {
  try {
    return JSON.parse(localStorage.getItem(TOOLBAR_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function persistToolbarState(state) {
  localStorage.setItem(TOOLBAR_STORAGE_KEY, JSON.stringify(state));
}

function updateActiveOutline() {
  if (sourceMode) {
    outline.querySelectorAll("button").forEach((button) => button.classList.remove("is-active"));
    return;
  }

  const headings = Array.from(editor.querySelectorAll("h1, h2, h3"));
  if (!headings.length) {
    return;
  }

  let activeId = headings[0].id;
  const threshold = 220;
  headings.forEach((heading) => {
    if (heading.getBoundingClientRect().top <= threshold) {
      activeId = heading.id;
    }
  });

  let activeButton = null;
  outline.querySelectorAll("button").forEach((button) => {
    const isActive = button.dataset.targetId === activeId;
    button.classList.toggle("is-active", isActive);
    if (isActive) {
      activeButton = button;
    }
  });

  activeButton?.scrollIntoView({ block: "nearest" });
}

function refreshOutline() {
  const headings = sourceMode
    ? Array.from(sourceEditor.value.matchAll(/^(#{1,3})\s+(.+)$/gm)).map((match, index) => ({
        id: `source-heading-${index}`,
        level: match[1].length,
        text: match[2].trim(),
        action: () => {
          sourceEditor.focus();
          sourceEditor.setSelectionRange(match.index, match.index);
        }
      }))
    : Array.from(editor.querySelectorAll("h1, h2, h3")).map((heading) => {
        if (!heading.id) {
          heading.id = `heading-${++headingId}`;
        }
        return {
          id: heading.id,
          level: Number(heading.tagName[1]),
          text: heading.textContent.trim(),
          action: () => heading.scrollIntoView({ behavior: "smooth", block: "start" })
        };
      });

  outline.innerHTML = "";
  outlineCount.textContent = String(headings.length);

  if (!headings.length) {
    outline.innerHTML = '<p class="outline-empty">文档里还没有标题</p>';
    return;
  }

  headings.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.level = String(item.level);
    button.dataset.targetId = item.id;
    button.textContent = item.text;
    button.addEventListener("click", item.action);
    outline.appendChild(button);
  });

  updateActiveOutline();
}

function refreshDerivedState() {
  updateStats(getMarkdown());
  refreshOutline();
  refreshStatusMeta();
  refreshWindowTitle();
}

function setEditorHtml(html) {
  editor.innerHTML = html.trim();
  editor.classList.toggle("is-empty", !editor.textContent.trim());
  refreshDerivedState();
}

function persistLocalDraft() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    title: documentTitle.value.trim() || "未命名文档",
    markdown: getMarkdown(),
    filePath: currentFilePath
  }));
}

function persistDocumentState(label = null) {
  clearTimeout(saveTimer);
  const markdown = getMarkdown();
  persistLocalDraft();
  isDocumentDirty = false;
  saveState.textContent = label || `已保存 ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  updateStats(markdown);
  refreshStatusMeta();
  refreshWindowTitle();
}

function scheduleSave() {
  isDocumentDirty = true;
  saveState.textContent = currentFilePath ? "未保存修改" : "本地草稿";
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => persistDocumentState(currentFilePath ? "已更新草稿" : "本地草稿"), 220);
  refreshDerivedState();
}

function applyDocument({ title, markdown, filePath = null, fileHandle = null, stateLabel = "已打开" }) {
  currentFilePath = filePath;
  currentFileHandle = fileHandle;
  documentTitle.value = title || "未命名文档";
  sourceEditor.value = markdown || "";
  setEditorHtml(markdownToHtml(markdown || ""));
  persistDocumentState(stateLabel);
}

function loadDocument() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    currentFilePath = null;
    currentFileHandle = null;
    documentTitle.value = "未命名文档";
    setEditorHtml(emptyDocumentTemplate.innerHTML);
    saveState.textContent = "本地草稿";
    return;
  }

  try {
    const doc = JSON.parse(raw);
    applyDocument({ title: doc.title, markdown: doc.markdown, filePath: doc.filePath || null, stateLabel: doc.filePath ? "已恢复文件" : "已恢复" });
  } catch {
    currentFilePath = null;
    currentFileHandle = null;
    documentTitle.value = "未命名文档";
    setEditorHtml(emptyDocumentTemplate.innerHTML);
    saveState.textContent = "恢复失败";
  }
}

function toggleMode(forceSource = !sourceMode) {
  sourceMode = forceSource;
  editorFrame.classList.toggle("is-source-mode", sourceMode);
  toggleModeButton.textContent = sourceMode ? "所见即所得" : "源码模式";

  if (sourceMode) {
    sourceEditor.value = htmlToMarkdown(editor);
    sourceEditor.focus();
    sourceEditor.setSelectionRange(sourceEditor.value.length, sourceEditor.value.length);
  } else {
    setEditorHtml(markdownToHtml(sourceEditor.value));
    editor.focus();
  }

  scheduleSave();
}

function updateSourceSelection(start, end, replacement, selectionMode = "preserve") {
  sourceEditor.setRangeText(replacement, start, end, selectionMode);
  sourceEditor.focus();
  scheduleSave();
}

function indentSourceSelection(outdent = false) {
  const indentUnit = "  ";
  const { value, selectionStart, selectionEnd } = sourceEditor;

  if (!outdent && selectionStart === selectionEnd) {
    updateSourceSelection(selectionStart, selectionEnd, indentUnit, "end");
    return;
  }

  const blockStart = value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
  const rawBlockEnd = value.indexOf("\n", selectionEnd);
  const blockEnd = rawBlockEnd === -1 ? value.length : rawBlockEnd;
  const lines = value.slice(blockStart, blockEnd).split("\n");
  const updatedLines = lines.map((line) => {
    if (!outdent) {
      return `${indentUnit}${line}`;
    }
    if (line.startsWith("\t")) {
      return line.slice(1);
    }
    if (line.startsWith(indentUnit)) {
      return line.slice(indentUnit.length);
    }
    if (line.startsWith(" ")) {
      return line.slice(1);
    }
    return line;
  });

  updateSourceSelection(blockStart, blockEnd, updatedLines.join("\n"));
}

function isInsideFencedCodeBlock(markdown, position) {
  const lines = markdown.slice(0, position).split(/\r?\n/);
  let inCodeBlock = false;
  lines.forEach((line) => {
    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock;
    }
  });
  return inCodeBlock;
}

function getSourceContinuation(lineText, atLineEnd) {
  const taskMatch = lineText.match(/^(\s*[-*])\s+\[(?: |x|X)\]\s?(.*)$/);
  if (taskMatch) {
    if (!taskMatch[2].trim() && atLineEnd) {
      return { type: "replace-line", text: "" };
    }
    return { type: "insert", text: `\n${taskMatch[1]} [ ] ` };
  }

  const orderedMatch = lineText.match(/^(\s*)(\d+)\.\s+(.*)$/);
  if (orderedMatch) {
    if (!orderedMatch[3].trim() && atLineEnd) {
      return { type: "replace-line", text: "" };
    }
    return { type: "insert", text: `\n${orderedMatch[1]}${Number(orderedMatch[2]) + 1}. ` };
  }

  const unorderedMatch = lineText.match(/^(\s*[-*])\s+(.*)$/);
  if (unorderedMatch) {
    if (!unorderedMatch[2].trim() && atLineEnd) {
      return { type: "replace-line", text: "" };
    }
    return { type: "insert", text: `\n${unorderedMatch[1]} ` };
  }

  const quoteMatch = lineText.match(/^(\s*(?:>\s?)+)(.*)$/);
  if (quoteMatch) {
    if (!quoteMatch[2].trim() && atLineEnd) {
      return { type: "replace-line", text: "" };
    }
    const prefix = quoteMatch[1].endsWith(" ") ? quoteMatch[1] : `${quoteMatch[1]} `;
    return { type: "insert", text: `\n${prefix}` };
  }

  return null;
}

function handleSourceEnter(event) {
  if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) {
    return;
  }

  const { value, selectionStart, selectionEnd } = sourceEditor;
  if (selectionStart !== selectionEnd) {
    return;
  }

  const lineStart = value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
  const rawLineEnd = value.indexOf("\n", selectionStart);
  const lineEnd = rawLineEnd === -1 ? value.length : rawLineEnd;
  if (isInsideFencedCodeBlock(value, lineStart)) {
    return;
  }

  const lineText = value.slice(lineStart, lineEnd);
  const continuation = getSourceContinuation(lineText, selectionStart === lineEnd);
  if (!continuation) {
    return;
  }

  event.preventDefault();
  if (continuation.type === "replace-line") {
    updateSourceSelection(lineStart, lineEnd, "", "start");
    return;
  }

  updateSourceSelection(selectionStart, selectionEnd, continuation.text, "end");
}

function promptForLink() {
  const url = window.prompt("输入链接 URL", "https://");
  if (!url) {
    return;
  }

  if (sourceMode) {
    const start = sourceEditor.selectionStart;
    const end = sourceEditor.selectionEnd;
    const selected = sourceEditor.value.slice(start, end) || "链接文本";
    sourceEditor.setRangeText(`[${selected}](${url})`, start, end, "end");
    sourceEditor.focus();
    scheduleSave();
    return;
  }

  document.execCommand("createLink", false, url);
  scheduleSave();
}

function createTaskListItem(text = "内容", checked = false) {
  const li = document.createElement("li");
  li.className = checked ? "is-checked" : "";
  const label = document.createElement("label");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = checked;
  checkbox.dataset.taskCheckbox = "true";
  const span = document.createElement("span");
  span.contentEditable = "true";
  span.textContent = text;
  label.append(checkbox, span);
  li.appendChild(label);
  return li;
}

function getCurrentBlock() {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) {
    return null;
  }
  let node = selection.anchorNode;
  while (node && node !== editor) {
    if (node.nodeType === Node.ELEMENT_NODE && ["P", "DIV", "LI", "H1", "H2", "H3", "BLOCKQUOTE"].includes(node.tagName)) {
      return node;
    }
    node = node.parentNode;
  }
  return null;
}

function findClosestTag(node, tagNames) {
  let current = node;
  while (current && current !== editor) {
    if (current.nodeType === Node.ELEMENT_NODE && tagNames.includes(current.tagName)) {
      return current;
    }
    current = current.parentNode;
  }
  return null;
}

function placeCursorAtEnd(element) {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertNodeNearCurrentBlock(node) {
  const block = getCurrentBlock();
  if (!block) {
    editor.appendChild(node);
    return;
  }

  const blockText = block.textContent.trim();
  if (["P", "DIV"].includes(block.tagName) && !blockText) {
    block.replaceWith(node);
    return;
  }

  block.insertAdjacentElement("afterend", node);
}

function createEditorParagraph() {
  const paragraph = document.createElement("p");
  paragraph.appendChild(document.createElement("br"));
  return paragraph;
}

function getSelectionContainer() {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) {
    return null;
  }
  return selection.anchorNode;
}

function getCaretMetrics(element) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount || !selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer) && element !== range.startContainer) {
    return null;
  }

  const prefixRange = range.cloneRange();
  prefixRange.selectNodeContents(element);
  prefixRange.setEnd(range.startContainer, range.startOffset);
  const beforeText = prefixRange.toString().replace(/\u00a0/g, " ");
  const totalText = (element.textContent || "").replace(/\u00a0/g, " ");
  return {
    beforeLength: beforeText.length,
    totalLength: totalText.length
  };
}

function exitListItem(listItem, list) {
  const listContainer = list;
  const parent = listContainer.parentNode;
  listItem.remove();
  const paragraph = createEditorParagraph();
  if (parent) {
    if (listContainer.nextSibling) {
      parent.insertBefore(paragraph, listContainer.nextSibling);
    } else {
      parent.appendChild(paragraph);
    }
  }
  if (!listContainer.children.length) {
    listContainer.remove();
  }
  placeCursorAtEnd(paragraph);
  scheduleSave();
}

function insertTaskListItem() {
  const ul = document.createElement("ul");
  ul.className = "task-list";
  const li = createTaskListItem();
  ul.appendChild(li);
  const block = getCurrentBlock();
  if (block) {
    block.replaceWith(ul);
  } else {
    editor.appendChild(ul);
  }
  placeCursorAtEnd(li.querySelector("span"));
  scheduleSave();
}

function insertTable() {
  const table = document.createElement("table");
  table.innerHTML = [
    "<thead><tr><th>列 1</th><th>列 2</th></tr></thead>",
    "<tbody><tr><td>内容</td><td>内容</td></tr></tbody>"
  ].join("");
  insertNodeNearCurrentBlock(table);
  placeCursorAtEnd(table.querySelector("td"));
  scheduleSave();
}

function getActiveTableCell() {
  const node = getSelectionContainer();
  const activeCell = node ? findClosestTag(node, ["TD", "TH"]) : null;
  if (activeCell && editor.contains(activeCell)) {
    lastActiveTableCell = activeCell;
    return activeCell;
  }

  if (lastActiveTableCell && lastActiveTableCell.isConnected && editor.contains(lastActiveTableCell)) {
    return lastActiveTableCell;
  }

  return null;
}

function focusTableCell(cell) {
  if (!cell) {
    return;
  }
  lastActiveTableCell = cell;
  placeCursorAtEnd(cell);
}

function updateTableRowsForColumn(table, cellIndex, action) {
  Array.from(table.rows).forEach((row) => {
    const referenceCell = row.children[cellIndex] || row.lastElementChild;
    if (!referenceCell) {
      return;
    }

    if (action === "add") {
      const nextCell = document.createElement(referenceCell.tagName.toLowerCase());
      nextCell.textContent = referenceCell.tagName === "TH" ? `列 ${row.children.length + 1}` : "内容";
      referenceCell.insertAdjacentElement("afterend", nextCell);
      return;
    }

    referenceCell.remove();
  });
}

function removeTable(table) {
  const paragraph = createEditorParagraph();
  table.insertAdjacentElement("afterend", paragraph);
  table.remove();
  placeCursorAtEnd(paragraph);
  scheduleSave();
}

function handleTableAction(action) {
  const activeCell = getActiveTableCell();
  if (!activeCell) {
    return;
  }

  const table = activeCell.closest("table");
  if (!table) {
    return;
  }

  const row = activeCell.parentElement;
  const cellIndex = Array.from(row.children).indexOf(activeCell);

  switch (action) {
    case "add-row": {
      const targetSection = row.parentElement.tagName === "THEAD"
        ? (table.tBodies[0] || table.appendChild(document.createElement("tbody")))
        : row.parentElement;
      const newRow = document.createElement("tr");
      Array.from(row.children).forEach((cell) => {
        const nextCell = document.createElement(cell.tagName === "TH" ? "td" : cell.tagName.toLowerCase());
        nextCell.textContent = "内容";
        newRow.appendChild(nextCell);
      });

      if (row.parentElement.tagName === "THEAD") {
        targetSection.insertBefore(newRow, targetSection.firstChild);
      } else {
        row.insertAdjacentElement("afterend", newRow);
      }
      focusTableCell(newRow.children[Math.max(cellIndex, 0)]);
      scheduleSave();
      return;
    }
    case "add-column": {
      updateTableRowsForColumn(table, cellIndex, "add");
      focusTableCell(row.children[cellIndex + 1] || row.lastElementChild);
      scheduleSave();
      return;
    }
    case "delete-row": {
      const totalRows = table.rows.length;
      if (totalRows <= 1) {
        removeTable(table);
        return;
      }

      const sectionTag = row.parentElement.tagName;
      if (sectionTag === "THEAD") {
        const body = table.tBodies[0];
        const replacement = body?.rows[0];
        if (!replacement) {
          removeTable(table);
          return;
        }

        const nextHeaderRow = document.createElement("tr");
        Array.from(replacement.children).forEach((cell, index) => {
          const th = document.createElement("th");
          th.textContent = cell.textContent.trim() || `列 ${index + 1}`;
          nextHeaderRow.appendChild(th);
        });
        row.replaceWith(nextHeaderRow);
        replacement.remove();
        if (!body.rows.length) {
          body.remove();
        }
        focusTableCell(nextHeaderRow.children[Math.max(cellIndex, 0)]);
        scheduleSave();
        return;
      }

      const fallbackRow = row.nextElementSibling || row.previousElementSibling || table.querySelector("thead tr");
      row.remove();
      if (row.parentElement && row.parentElement.tagName === "TBODY" && !row.parentElement.rows.length) {
        row.parentElement.remove();
      }
      focusTableCell(fallbackRow?.children[Math.max(cellIndex, 0)] || fallbackRow?.lastElementChild);
      scheduleSave();
      return;
    }
    case "delete-column": {
      const totalColumns = row.children.length;
      if (totalColumns <= 1) {
        removeTable(table);
        return;
      }

      updateTableRowsForColumn(table, cellIndex, "delete");
      const nextFocusCell = row.children[Math.min(cellIndex, row.children.length - 1)] || row.lastElementChild;
      focusTableCell(nextFocusCell);
      scheduleSave();
      return;
    }
    default:
      return;
  }
}

function handleEditorListContinuation(event) {
  if (sourceMode || event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) {
    return;
  }

  const selection = window.getSelection();
  if (!selection || !selection.rangeCount || !selection.isCollapsed) {
    return;
  }

  const listItem = findClosestTag(selection.anchorNode, ["LI"]);
  if (!listItem) {
    return;
  }

  const list = listItem.parentElement;
  if (!list || !["UL", "OL"].includes(list.tagName)) {
    return;
  }

  event.preventDefault();
  const isTaskList = list.classList.contains("task-list");
  const editableTarget = isTaskList ? listItem.querySelector("span") : listItem;
  const text = editableTarget?.textContent?.replace(/\u00a0/g, " ").trim() || "";
  const caret = editableTarget ? getCaretMetrics(editableTarget) : null;

  if (text && caret && caret.beforeLength < caret.totalLength) {
    return;
  }

  if (text) {
    const nextItem = isTaskList ? createTaskListItem() : document.createElement("li");
    if (!isTaskList) {
      nextItem.appendChild(document.createElement("br"));
    }
    listItem.insertAdjacentElement("afterend", nextItem);
    placeCursorAtEnd(isTaskList ? nextItem.querySelector("span") : nextItem);
    scheduleSave();
    return;
  }

  exitListItem(listItem, list);
}

function handleEditorListBackspace(event) {
  if (sourceMode || event.key !== "Backspace" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) {
    return;
  }

  const selection = window.getSelection();
  if (!selection || !selection.rangeCount || !selection.isCollapsed) {
    return;
  }

  const listItem = findClosestTag(selection.anchorNode, ["LI"]);
  if (!listItem) {
    return;
  }

  const list = listItem.parentElement;
  if (!list || !["UL", "OL"].includes(list.tagName)) {
    return;
  }

  const isTaskList = list.classList.contains("task-list");
  const editableTarget = isTaskList ? listItem.querySelector("span") : listItem;
  const text = editableTarget?.textContent?.replace(/\u00a0/g, " ").trim() || "";
  const caret = editableTarget ? getCaretMetrics(editableTarget) : null;

  if (text || !caret || caret.beforeLength !== 0) {
    return;
  }

  event.preventDefault();
  exitListItem(listItem, list);
}

function insertBlock(type, level = 1) {
  if (type === "link") {
    promptForLink();
    return;
  }

  if (sourceMode) {
    const start = sourceEditor.selectionStart;
    const end = sourceEditor.selectionEnd;
    const selected = sourceEditor.value.slice(start, end) || "内容";
    let replacement = selected;

    switch (type) {
      case "heading":
        replacement = `${"#".repeat(level)} ${selected}`;
        break;
      case "bold":
        replacement = `**${selected}**`;
        break;
      case "italic":
        replacement = `*${selected}*`;
        break;
      case "quote":
        replacement = `> ${selected}`;
        break;
      case "ul":
        replacement = `- ${selected}`;
        break;
      case "task":
        replacement = `- [ ] ${selected}`;
        break;
      case "ol":
        replacement = `1. ${selected}`;
        break;
      case "table":
        replacement = "| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |";
        break;
      case "code":
        replacement = `\`\`\`\n${selected}\n\`\`\``;
        break;
      case "hr":
        replacement = "\n---\n";
        break;
      default:
        return;
    }

    sourceEditor.setRangeText(replacement, start, end, "end");
    sourceEditor.focus();
    scheduleSave();
    return;
  }

  editor.focus();
  switch (type) {
    case "heading":
      document.execCommand("formatBlock", false, `h${level}`);
      break;
    case "bold":
      document.execCommand("bold");
      break;
    case "italic":
      document.execCommand("italic");
      break;
    case "quote":
      document.execCommand("formatBlock", false, "blockquote");
      break;
    case "ul":
      document.execCommand("insertUnorderedList");
      break;
    case "task":
      insertTaskListItem();
      return;
    case "ol":
      document.execCommand("insertOrderedList");
      break;
    case "table":
      insertTable();
      return;
    case "code":
      document.execCommand("formatBlock", false, "pre");
      break;
    case "hr":
      document.execCommand("insertHorizontalRule");
      break;
    default:
      return;
  }

  scheduleSave();
}

function insertTextAtCursor(text) {
  if (sourceMode) {
    const start = sourceEditor.selectionStart;
    const end = sourceEditor.selectionEnd;
    sourceEditor.setRangeText(text, start, end, "end");
    sourceEditor.focus();
    scheduleSave();
    return;
  }

  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) {
    editor.focus();
    document.execCommand("insertText", false, text);
    scheduleSave();
    return;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();
  range.insertNode(document.createTextNode(text));
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
  scheduleSave();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function insertImageFile(file) {
  if (!file.type.startsWith("image/")) {
    return;
  }
  const dataUrl = await readFileAsDataUrl(file);
  const safeName = file.name && file.name !== "blob" ? file.name.replace(/\.[^.]+$/, "") : `image-${Date.now()}`;
  insertTextAtCursor(`![${safeName}](${dataUrl})`);
}

async function handleImageTransfer(files) {
  for (const file of files) {
    await insertImageFile(file);
  }
}

function getTransferFiles(dataTransfer) {
  return Array.from(dataTransfer?.files || []).filter((file) => file.type.startsWith("image/"));
}

function transformCurrentBlockIfNeeded() {
  if (sourceMode) {
    return;
  }

  const block = getCurrentBlock();
  if (!block) {
    return;
  }

  const text = block.textContent.trim();
  const patterns = [
    { regex: /^###\s+(.+)$/, tag: "h3" },
    { regex: /^##\s+(.+)$/, tag: "h2" },
    { regex: /^#\s+(.+)$/, tag: "h1" },
    { regex: /^>\s+(.+)$/, tag: "blockquote" },
    { regex: /^-\s+\[(?: |x|X)\]\s+(.+)$/, tag: "task" },
    { regex: /^-\s+(.+)$/, tag: "ul" },
    { regex: /^1\.\s+(.+)$/, tag: "ol" }
  ];

  const matched = patterns.find((item) => item.regex.test(text));
  if (!matched) {
    return;
  }

  const content = text.match(matched.regex)[1];

  if (matched.tag.startsWith("h")) {
    const heading = document.createElement(matched.tag);
    heading.textContent = content;
    block.replaceWith(heading);
    placeCursorAtEnd(heading);
  } else if (matched.tag === "blockquote") {
    const quote = document.createElement("blockquote");
    const p = document.createElement("p");
    p.textContent = content;
    quote.appendChild(p);
    block.replaceWith(quote);
    placeCursorAtEnd(p);
  } else if (matched.tag === "ul") {
    const ul = document.createElement("ul");
    const li = document.createElement("li");
    li.textContent = content;
    ul.appendChild(li);
    block.replaceWith(ul);
    placeCursorAtEnd(li);
  } else if (matched.tag === "ol") {
    const ol = document.createElement("ol");
    const li = document.createElement("li");
    li.textContent = content;
    ol.appendChild(li);
    block.replaceWith(ol);
    placeCursorAtEnd(li);
  } else if (matched.tag === "task") {
    const checked = /^-\s+\[(x|X)\]\s+/.test(text);
    const ul = document.createElement("ul");
    ul.className = "task-list";
    const li = createTaskListItem(content, checked);
    ul.appendChild(li);
    block.replaceWith(ul);
    placeCursorAtEnd(li.querySelector("span"));
  }

  scheduleSave();
}

async function openMarkdownFile() {
  if (desktopAPI) {
    const result = await desktopAPI.openMarkdown();
    if (!result) {
      return;
    }
    applyDocument({
      title: result.filePath.split(/[/\\]/).pop().replace(/\.(md|markdown|txt)$/i, ""),
      markdown: result.markdown,
      filePath: result.filePath,
      fileHandle: null,
      stateLabel: "已打开文件"
    });
    return;
  }

  if (supportsFileSystemAccess) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{
          description: "Markdown",
          accept: { "text/markdown": [".md", ".markdown"], "text/plain": [".txt"] }
        }],
        excludeAcceptAllOption: false,
        multiple: false
      });
      if (!handle) {
        return;
      }
      const file = await handle.getFile();
      const markdown = await file.text();
      applyDocument({
        title: file.name.replace(/\.(md|markdown|txt)$/i, "") || "未命名文档",
        markdown,
        filePath: handle.name,
        fileHandle: handle,
        stateLabel: "已打开文件"
      });
      return;
    } catch (error) {
      if (error?.name !== "AbortError") {
        console.error(error);
      }
      return;
    }
  }

  filePicker.click();
}

async function writeToBrowserHandle(handle, markdown) {
  const writable = await handle.createWritable();
  await writable.write(markdown);
  await writable.close();
}

async function saveMarkdownFile(forceSaveAs = false) {
  const rawTitle = documentTitle.value.trim() || "untitled";
  const payload = {
    title: rawTitle,
    markdown: getMarkdown(),
    filePath: forceSaveAs ? null : currentFilePath
  };

  if (desktopAPI) {
    try {
      const nextFilePath = !forceSaveAs && currentFilePath ? getRenamedFilePath(rawTitle) : null;
      const result = forceSaveAs || !currentFilePath
        ? await desktopAPI.saveMarkdownAs(payload)
        : await desktopAPI.saveMarkdown({ ...payload, nextFilePath });

      if (!result) {
        return;
      }

      if (result.error) {
        saveState.textContent = result.message || "保存失败";
        isDocumentDirty = true;
        refreshWindowTitle();
        return;
      }

      currentFilePath = result.filePath;
      currentFileHandle = null;
      persistDocumentState(result.renamed ? "已重命名并保存" : forceSaveAs ? "已另存为" : "已保存到文件");
      return;
    } catch (error) {
      console.error(error);
      saveState.textContent = "保存失败";
      isDocumentDirty = true;
      refreshWindowTitle();
      return;
    }
  }

  if (supportsFileSystemAccess) {
    try {
      const nextFilePath = !forceSaveAs && currentFilePath ? getRenamedFilePath(rawTitle) : null;
      if (!forceSaveAs && currentFileHandle && !nextFilePath) {
        await writeToBrowserHandle(currentFileHandle, payload.markdown);
        currentFilePath = currentFileHandle.name;
        persistDocumentState("已保存到文件");
        return;
      }

      const handle = await window.showSaveFilePicker({
        suggestedName: `${sanitizeFileName(rawTitle)}.md`,
        types: [{
          description: "Markdown",
          accept: { "text/markdown": [".md"] }
        }]
      });
      if (!handle) {
        return;
      }

      await writeToBrowserHandle(handle, payload.markdown);
      currentFileHandle = handle;
      currentFilePath = handle.name;
      persistDocumentState(forceSaveAs ? "已另存为" : nextFilePath ? "已重命名并保存" : "已保存到文件");
      return;
    } catch (error) {
      if (error?.name !== "AbortError") {
        console.error(error);
        saveState.textContent = "保存失败";
        isDocumentDirty = true;
        refreshWindowTitle();
      }
      return;
    }
  }

  const blob = new Blob([payload.markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeFileName(rawTitle)}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  saveState.textContent = forceSaveAs ? "已另存为" : "已导出";
}

async function exportDocument(kind) {
  setExportMenuOpen(false);
  const payload = getExportPayload();

  if (desktopAPI) {
    try {
      const result = kind === "pdf"
        ? await desktopAPI.exportPdf(payload)
        : await desktopAPI.exportWord(payload);
      if (!result) {
        return;
      }

      saveState.textContent = kind === "pdf" ? "已导出 PDF" : "已导出 Word";
      return;
    } catch (error) {
      console.error(error);
      saveState.textContent = kind === "pdf" ? "PDF 导出失败" : "Word 导出失败";
      return;
    }
  }

  if (kind === "pdf") {
    const printWindow = window.open("", "_blank", "noopener,noreferrer");
    if (!printWindow) {
      saveState.textContent = "PDF 导出失败";
      return;
    }
    printWindow.document.open();
    printWindow.document.write(payload.documentHtml);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    saveState.textContent = "请在打印窗口中另存为 PDF";
    return;
  }

  saveState.textContent = "浏览器模式暂不支持本地生成 .docx，请使用桌面版导出 Word。";
}

function resetDocument() {
  currentFilePath = null;
  currentFileHandle = null;
  documentTitle.value = "未命名文档";
  sourceEditor.value = "";
  setEditorHtml(emptyDocumentTemplate.innerHTML);
  if (sourceMode) {
    toggleMode(false);
    return;
  }
  scheduleSave();
}

async function handleAction(action) {
  if (action === "new") {
    resetDocument();
    return;
  }
  if (action === "import") {
    await openMarkdownFile();
    return;
  }
  if (action === "save") {
    await saveMarkdownFile(false);
    return;
  }
  if (action === "export-markdown") {
    await saveMarkdownFile(true);
    return;
  }
  if (action === "export-menu") {
    toggleExportMenu();
    return;
  }
  if (action === "toggle-mode") {
    toggleMode();
  }
}

document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("mousedown", (event) => {
    if (button === exportMenuButton) {
      return;
    }
    event.preventDefault();
  });
  button.addEventListener("click", async () => {
    await handleAction(button.dataset.action);
  });
});

exportMenuItems.forEach((button) => {
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  button.addEventListener("click", async () => {
    const kind = button.dataset.exportKind;
    setExportMenuOpen(false);
    if (kind === "markdown") {
      await handleAction("export-markdown");
      return;
    }
    await exportDocument(kind);
  });
});

leftRailToggleButton.addEventListener("click", () => {
  const state = readLayoutState();
  setLayoutState({ leftRailCollapsed: !Boolean(state.leftRailCollapsed) });
});

leftRailDockButton.addEventListener("click", () => {
  setLayoutState({ leftRailCollapsed: false });
});

document.querySelectorAll("[data-format]").forEach((button) => {
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  button.addEventListener("click", () => {
    insertBlock(button.dataset.format, Number(button.dataset.level || 1));
  });
});

tableActionButtons.forEach((button) => {
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  button.addEventListener("click", () => {
    handleTableAction(button.dataset.tableAction);
  });
});

editor.addEventListener("input", () => {
  editor.classList.toggle("is-empty", !editor.textContent.trim());
  scheduleSave();
});

editor.addEventListener("keydown", (event) => {
  handleEditorListContinuation(event);
  handleEditorListBackspace(event);
});

document.addEventListener("selectionchange", () => {
  const node = getSelectionContainer();
  if (!node) {
    return;
  }
  const cell = findClosestTag(node, ["TD", "TH"]);
  if (cell && editor.contains(cell)) {
    lastActiveTableCell = cell;
  }
});

editor.addEventListener("keyup", (event) => {
  if ([" ", "Enter"].includes(event.key)) {
    transformCurrentBlockIfNeeded();
  }
});

editor.addEventListener("change", (event) => {
  if (event.target.matches('[data-task-checkbox]')) {
    const item = event.target.closest("li");
    item?.classList.toggle("is-checked", event.target.checked);
    scheduleSave();
  }
});

sourceEditor.addEventListener("input", scheduleSave);
documentTitle.addEventListener("input", scheduleSave);

tipsToggleButton.addEventListener("click", () => {
  const state = readTipsState();
  setTipsState({ collapsed: !Boolean(state.collapsed) });
});

tipsCollapseButton.addEventListener("click", () => {
  const state = readTipsState();
  setTipsState({ collapsed: !Boolean(state.collapsed) });
});

const toolbarState = readToolbarState();
toolbarGroups.forEach((group, index) => {
  const toggle = group.querySelector("[data-toolbar-toggle]");
  if (!toggle) {
    return;
  }

  const groupName = toggle.querySelector(".toolbar-label")?.textContent || `group-${index}`;
  const shouldCollapse = Object.prototype.hasOwnProperty.call(toolbarState, groupName) ? Boolean(toolbarState[groupName]) : index > 0;
  group.classList.toggle("is-collapsed", shouldCollapse);
  toggle.setAttribute("aria-expanded", String(!shouldCollapse));
  const caret = toggle.querySelector(".toolbar-caret");
  if (caret) {
    caret.textContent = shouldCollapse ? "+" : "−";
  }

  toggle.addEventListener("click", () => {
    const collapsed = group.classList.toggle("is-collapsed");
    toggle.setAttribute("aria-expanded", String(!collapsed));
    if (caret) {
      caret.textContent = collapsed ? "+" : "−";
    }
    const nextState = readToolbarState();
    nextState[groupName] = collapsed;
    persistToolbarState(nextState);
  });
});

async function onKeyboardShortcut(event) {
  if (!(event.ctrlKey || event.metaKey)) {
    return;
  }

  const key = event.key.toLowerCase();
  if (event.shiftKey && key === "s") {
    event.preventDefault();
    await saveMarkdownFile(true);
    return;
  }
  if (event.shiftKey && key === "m") {
    event.preventDefault();
    toggleMode();
    return;
  }
  if (key === "s") {
    event.preventDefault();
    await saveMarkdownFile(false);
    return;
  }
  if (key === "b") {
    event.preventDefault();
    insertBlock("bold");
    return;
  }
  if (key === "i") {
    event.preventDefault();
    insertBlock("italic");
    return;
  }
  if (key === "k") {
    event.preventDefault();
    insertBlock("link");
  }
}

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && exportMenuOpen) {
    setExportMenuOpen(false);
    return;
  }
  void onKeyboardShortcut(event);
});

document.addEventListener("click", (event) => {
  if (!exportMenuOpen) {
    return;
  }
  const target = event.target;
  if (target instanceof Node && (exportMenu.contains(target) || exportMenuButton.contains(target))) {
    return;
  }
  setExportMenuOpen(false);
});

window.addEventListener("resize", applyLayoutState, { passive: true });
window.addEventListener("resize", updateExportMenuPosition, { passive: true });
window.addEventListener("scroll", updateExportMenuPosition, { passive: true });

sourceEditor.addEventListener("keydown", (event) => {
  if (event.key === "Tab") {
    event.preventDefault();
    indentSourceSelection(event.shiftKey);
    return;
  }

  handleSourceEnter(event);
});

editorFrame.addEventListener("dragenter", (event) => {
  if (!getTransferFiles(event.dataTransfer).length) {
    return;
  }
  dragDepth += 1;
  editorFrame.classList.add("is-dragging");
  dropOverlay.setAttribute("aria-hidden", "false");
});

editorFrame.addEventListener("dragover", (event) => {
  if (!getTransferFiles(event.dataTransfer).length) {
    return;
  }
  event.preventDefault();
});

editorFrame.addEventListener("dragleave", (event) => {
  if (!getTransferFiles(event.dataTransfer).length) {
    return;
  }
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) {
    editorFrame.classList.remove("is-dragging");
    dropOverlay.setAttribute("aria-hidden", "true");
  }
});

editorFrame.addEventListener("drop", async (event) => {
  const files = getTransferFiles(event.dataTransfer);
  if (!files.length) {
    return;
  }
  event.preventDefault();
  dragDepth = 0;
  editorFrame.classList.remove("is-dragging");
  dropOverlay.setAttribute("aria-hidden", "true");
  await handleImageTransfer(files);
});

async function handlePaste(event) {
  const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith("image/"));
  if (!files.length) {
    return;
  }
  event.preventDefault();
  await handleImageTransfer(files);
}

editor.addEventListener("paste", handlePaste);
sourceEditor.addEventListener("paste", handlePaste);
window.addEventListener("scroll", updateActiveOutline, { passive: true });

filePicker.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) {
    return;
  }
  const markdown = await file.text();
  currentFileHandle = null;
  applyDocument({
    title: file.name.replace(/\.(md|markdown|txt)$/i, "") || "未命名文档",
    markdown,
    filePath: file.name,
    fileHandle: null,
    stateLabel: supportsFileSystemAccess ? "已导入文件" : "已导入文件（浏览器模式需另存）"
  });
  filePicker.value = "";
});

if (desktopAPI) {
  desktopAPI.onMenuAction(async (action) => {
    if (action === "export-markdown") {
      await saveMarkdownFile(true);
      return;
    }
    if (action === "export-pdf") {
      await exportDocument("pdf");
      return;
    }
    if (action === "export-word") {
      await exportDocument("word");
      return;
    }
    await handleAction(action === "open" ? "import" : action);
  });
}

window.addEventListener("beforeunload", () => {
  persistDocumentState(currentFilePath ? "已同步草稿" : "本地草稿");
});

loadDocument();
applyTipsState();
applyLayoutState();
refreshWindowTitle();








