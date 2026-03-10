const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");

async function waitForText(window, selector, expected) {
  await window.waitForFunction(
    ({ targetSelector, targetText }) => {
      const node = document.querySelector(targetSelector);
      return node && node.textContent.trim() === targetText;
    },
    { targetSelector: selector, targetText: expected }
  );
}

async function main() {
  const projectRoot = path.resolve(__dirname, "..");
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "freemarkdown-smoke-"));
  const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "freemarkdown-save-"));
  const originalFilePath = path.join(fixtureDir, "rename-me.md");
  const renamedFilePath = path.join(fixtureDir, "renamed-file.md");
  await fs.writeFile(originalFilePath, "# Rename Fixture\n", "utf8");
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${userDataDir}`],
    cwd: projectRoot
  });

  try {
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await window.bringToFront();

    await waitForText(window, "#modeState", "所见即所得");
    const initialFileMeta = await window.locator("#filePathMeta").textContent();
    assert.equal(initialFileMeta.trim(), "未关联文件");

    await window.keyboard.press("Control+Shift+M");
    await waitForText(window, "#modeState", "源码模式");

    const sourceEditor = window.locator("#sourceEditor");
    await sourceEditor.click();
    await sourceEditor.fill("# Smoke Title\n- alpha\n- beta");
    await sourceEditor.press("Enter");
    await sourceEditor.type("gamma");
    await window.waitForTimeout(300);

    const outlineCount = await window.locator("#outlineCount").textContent();
    assert.equal(outlineCount.trim(), "1");

    let sourceValue = await sourceEditor.inputValue();
    assert.match(sourceValue, /^# Smoke Title\r?\n- alpha\r?\n- beta\r?\n- gamma$/);

    await window.evaluate(() => {
      const source = document.getElementById("sourceEditor");
      source.focus();
      source.setSelectionRange(0, source.value.length);
    });
    await window.keyboard.press("Tab");
    sourceValue = await sourceEditor.inputValue();
    assert.match(sourceValue, /^  # Smoke Title\r?\n  - alpha\r?\n  - beta\r?\n  - gamma$/);

    await window.keyboard.press("Shift+Tab");
    sourceValue = await sourceEditor.inputValue();
    assert.match(sourceValue, /^# Smoke Title\r?\n- alpha\r?\n- beta\r?\n- gamma$/);

    await window.keyboard.press("Control+Shift+M");
    await waitForText(window, "#modeState", "所见即所得");
    await window.waitForFunction(() => document.querySelector("#editor h1")?.textContent.trim() === "Smoke Title");

    const headingText = await window.locator("#editor h1").textContent();
    assert.equal(headingText.trim(), "Smoke Title");

    await window.evaluate(() => {
      const target = document.querySelector("#editor ul li:last-child");
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await window.keyboard.press("Enter");
    await window.keyboard.type("delta");
    await window.waitForFunction(() => {
      const items = Array.from(document.querySelectorAll("#editor ul li"));
      return items.at(-1)?.textContent.trim() === "delta";
    });

    const lastListItem = await window.locator("#editor ul li").last().textContent();
    assert.equal(lastListItem.trim(), "delta");

    await window.keyboard.press("Enter");
    await window.waitForFunction(() => document.querySelectorAll("#editor ul li").length === 5);
    await window.keyboard.press("Backspace");
    await window.waitForFunction(() => {
      const items = Array.from(document.querySelectorAll("#editor ul li"));
      return items.length === 4 && items.at(-1)?.textContent.trim() === "delta" && Boolean(document.querySelector("#editor ul + p"));
    });

    await window.locator('[data-toolbar-group]:has([data-table-action="add-row"]) [data-toolbar-toggle]').click();
    await window.locator('button[data-format="table"]').click();
    await window.waitForFunction(() => document.querySelectorAll("#editor table").length > 0);
    let tableCell = await window.locator("#editor table td").first().textContent();
    assert.equal(tableCell.trim(), "内容");

    await window.locator('[data-table-action="add-row"]').click();
    await window.waitForFunction(() => document.querySelectorAll("#editor table tbody tr").length === 2);

    await window.locator('[data-table-action="add-column"]').click();
    await window.waitForFunction(() => document.querySelectorAll("#editor table thead tr > *").length === 3);

    await window.locator('[data-table-action="delete-row"]').click();
    await window.waitForFunction(() => document.querySelectorAll("#editor table tbody tr").length === 1);

    await window.locator('[data-table-action="delete-column"]').click();
    await window.waitForFunction(() => document.querySelectorAll("#editor table thead tr > *").length === 2);
    tableCell = await window.locator("#editor table td").first().textContent();
    assert.equal(tableCell.trim(), "内容");

    await window.addInitScript((filePath) => {
      localStorage.setItem("inkdown-document", JSON.stringify({
        title: "rename-me",
        markdown: "# Rename Fixture\n",
        filePath
      }));
    }, originalFilePath);
    await Promise.all([
      window.waitForLoadState("domcontentloaded"),
      window.evaluate(() => location.reload())
    ]);
    await window.waitForFunction(() => document.getElementById("documentTitle")?.value === "rename-me");
    await window.locator("#documentTitle").fill("renamed-file");
    await window.locator('[data-action="save"]').click();
    await window.waitForFunction((expectedName) => {
      const fileMeta = document.querySelector("#filePathMeta")?.textContent || "";
      const saveState = document.querySelector("#saveState")?.textContent || "";
      return fileMeta.includes(expectedName) && saveState.includes("重命名");
    }, "renamed-file.md");

    const renamedFileContent = await fs.readFile(renamedFilePath, "utf8");
    assert.equal(renamedFileContent, "# Rename Fixture");
    await assert.rejects(fs.access(originalFilePath));

    const stats = {
      mode: (await window.locator("#modeState").textContent()).trim(),
      file: (await window.locator("#filePathMeta").textContent()).trim(),
      status: (await window.locator("#saveState").textContent()).trim(),
      words: (await window.locator("#wordCount").textContent()).trim(),
      lines: (await window.locator("#lineCount").textContent()).trim()
    };

    console.log("Smoke test passed:", JSON.stringify(stats, null, 2));
  } finally {
    await app.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
    await fs.rm(fixtureDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
