const STORAGE_KEY = "inkdown-document";
const TIPS_STORAGE_KEY = "freemarkdown-tips-state";
const TOOLBAR_STORAGE_KEY = "freemarkdown-toolbar-state";
const desktopAPI = window.electronAPI || null;
const supportsFileSystemAccess = typeof window.showOpenFilePicker === "function" && typeof window.showSaveFilePicker === "function";

const editor = document.getElementById("editor");
const sourceEditor = document.getElementById("sourceEditor");
const filePicker = document.getElementById("filePicker");
const documentTitle = document.getElementById("documentTitle");
const wordCount = document.getElementById("wordCount");
const lineCount = document.getElementById("lineCount");
const imageCount = document.getElementById("imageCount");
const saveState = document.getElementById("saveState");
const emptyDocumentTemplate = document.getElementById("emptyDocumentTemplate");
const editorFrame = document.getElementById("editorFrame");
const toggleModeButton = document.querySelector('[data-action="toggle-mode"]');
const outline = document.getElementById("outline");
const outlineCount = document.getElementById("outlineCount");
const dropOverlay = document.getElementById("dropOverlay");
const tipsPanel = document.getElementById("tipsPanel");
const tipsToggleButton = document.getElementById("tipsToggleButton");
const tipsCollapseButton = document.getElementById("tipsCollapseButton");
const toolbarGroups = document.querySelectorAll("[data-toolbar-group]");

let sourceMode = false;
let saveTimer = null;
let dragDepth = 0;
let headingId = 0;
let currentFilePath = null;
let currentFileHandle = null;

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

function getWindowTitle() {
  const title = documentTitle.value.trim() || "未命名文档";
  const suffix = currentFilePath ? ` - ${currentFilePath}` : "";
  return `FreeMarkDown - ${title}${suffix}`;
}

function refreshWindowTitle() {
  if (desktopAPI) {
    desktopAPI.setWindowTitle(getWindowTitle());
  } else {
    document.title = getWindowTitle();
  }
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
  saveState.textContent = label || `已保存 ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  updateStats(markdown);
  refreshWindowTitle();
}

function scheduleSave() {
  saveState.textContent = currentFilePath ? "未保存修改" : "本地草稿";
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => persistDocumentState(currentFilePath ? "已更新草稿" : "本地草稿"), 220);
  refreshDerivedState();
}

function applyDocument({ title, markdown, filePath = null, stateLabel = "已打开" }) {
  currentFilePath = filePath;
  documentTitle.value = title || "未命名文档";
  sourceEditor.value = markdown || "";
  setEditorHtml(markdownToHtml(markdown || ""));
  persistDocumentState(stateLabel);
}

function loadDocument() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    currentFilePath = null;
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

function placeCursorAtEnd(element) {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
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
      currentFileHandle = handle;
      applyDocument({
        title: file.name.replace(/\.(md|markdown|txt)$/i, "") || "未命名文档",
        markdown,
        filePath: handle.name,
        stateLabel: "已打开文件"
      });
      currentFileHandle = handle;
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
  const payload = {
    title: documentTitle.value.trim() || "untitled",
    markdown: getMarkdown(),
    filePath: forceSaveAs ? null : currentFilePath
  };

  if (desktopAPI) {
    const result = forceSaveAs || !currentFilePath
      ? await desktopAPI.saveMarkdownAs(payload)
      : await desktopAPI.saveMarkdown(payload);

    if (!result) {
      return;
    }

    currentFilePath = result.filePath;
    persistDocumentState(forceSaveAs ? "已另存为" : "已保存到文件");
    return;
  }

  if (supportsFileSystemAccess) {
    try {
      if (!forceSaveAs && currentFileHandle) {
        await writeToBrowserHandle(currentFileHandle, payload.markdown);
        currentFilePath = currentFileHandle.name;
        persistDocumentState("已保存到文件");
        return;
      }

      const handle = await window.showSaveFilePicker({
        suggestedName: `${payload.title.replace(/[\\/:*?"<>|]/g, "-")}.md`,
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
      persistDocumentState(forceSaveAs ? "已另存为" : "已保存到文件");
      return;
    } catch (error) {
      if (error?.name !== "AbortError") {
        console.error(error);
      }
      return;
    }
  }

  const blob = new Blob([payload.markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${payload.title.replace(/[\\/:*?"<>|]/g, "-")}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  saveState.textContent = forceSaveAs ? "已另存为" : "已导出";
}

function resetDocument() {
  currentFilePath = null;
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
  if (action === "export") {
    await saveMarkdownFile(true);
    return;
  }
  if (action === "toggle-mode") {
    toggleMode();
  }
}

document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", async () => {
    await handleAction(button.dataset.action);
  });
});

document.querySelectorAll("[data-format]").forEach((button) => {
  button.addEventListener("click", () => {
    insertBlock(button.dataset.format, Number(button.dataset.level || 1));
  });
});

editor.addEventListener("input", () => {
  editor.classList.toggle("is-empty", !editor.textContent.trim());
  scheduleSave();
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

async function onSaveShortcut(event) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    await saveMarkdownFile(false);
  }
}

function onFormatShortcut(event) {
  if (!(event.ctrlKey || event.metaKey)) {
    return;
  }
  const key = event.key.toLowerCase();
  if (key === "b") {
    event.preventDefault();
    insertBlock("bold");
  }
  if (key === "i") {
    event.preventDefault();
    insertBlock("italic");
  }
  if (key === "k") {
    event.preventDefault();
    insertBlock("link");
  }
}

window.addEventListener("keydown", (event) => {
  onFormatShortcut(event);
  void onSaveShortcut(event);
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
    stateLabel: supportsFileSystemAccess ? "已导入文件" : "已导入文件（浏览器模式需另存）"
  });
  filePicker.value = "";
});

if (desktopAPI) {
  desktopAPI.onMenuAction(async (action) => {
    if (action === "save-as") {
      await saveMarkdownFile(true);
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
refreshWindowTitle();








