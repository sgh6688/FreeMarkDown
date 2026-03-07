# FreeMarkDown

FreeMarkDown is a portable Markdown editor for Windows, built with Electron and designed around a focused, Typora-like writing flow.

## Portable Release

Current portable build:
- `dist/FreeMarkDown-0.1.1-Portable.exe`

How to use:
1. Double-click the portable exe.
2. Write in WYSIWYG mode or switch to source mode.
3. Use `File -> Open` / `File -> Save As` for local Markdown files.

## Features

- Typora-style single-document editing
- WYSIWYG and source mode switching
- Markdown import and export
- Local draft autosave
- Outline sidebar
- Table rendering
- Task list rendering and checkbox toggling
- Drag-and-drop or paste images directly into the document
- Portable Windows build with no installer

## Development

Run locally:

```powershell
npm install
npm start
```

Build portable exe:

```powershell
npm run build:portable
```
