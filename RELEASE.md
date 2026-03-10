# Release Guide

本文档用于生成可直接在 Windows 上使用的 FreeMarkDown 绿色版。

## 目标产物

- `dist/FreeMarkDown-0.1.2-Portable.exe`

这是一个便携 exe，已经内置 Electron 运行时。最终用户不需要安装：

- Node.js
- npm
- Electron

## 发布前环境

请先确认：

```powershell
node -v
npm -v
git --version
```

建议环境：

- Node.js 22.x
- npm 10.x 或更高
- Windows 10 / 11 x64

## 发布步骤

### 1. 安装依赖

```powershell
npm install
```

### 2. 静态检查

```powershell
npm run check
```

### 3. 冒烟验证

```powershell
npm run test:smoke
```

这个脚本会实际启动 Electron 窗口，验证基础交互是否正常。

### 4. 构建绿色版

```powershell
npm run build:portable
```

或：

```powershell
npm run release:win
```

### 5. 检查产物

构建成功后检查：

```powershell
Get-ChildItem .\dist
```

应看到：

- `FreeMarkDown-0.1.2-Portable.exe`

### 6. 人工回归

建议至少检查一次：

1. 双击 exe 可以启动
2. 新建文档正常
3. 所见即所得 / 源码模式切换正常
4. 保存和另存为正常
5. 表格、任务列表、图片粘贴正常

## 发布说明模板

可以直接参考下面这段：

```text
FreeMarkDown 0.1.2 已发布。

- Windows x64 绿色便携版
- 无需安装 Node.js、npm 或 Electron
- 下载后直接运行 FreeMarkDown-0.1.2-Portable.exe
```

## 故障处理

### 构建失败

可以先清理依赖后重装：

```powershell
Remove-Item -Recurse -Force .\node_modules
npm install
```

### 产物启动失败

优先检查：

- 是否为 Windows x64
- 是否被 Defender 或其他安全软件拦截
- 构建机器和目标机器上的文件是否完整
