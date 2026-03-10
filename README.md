# FreeMarkDown

FreeMarkDown 是一个面向 Windows 的 Markdown 编辑器，基于 Electron，提供接近 Typora 的单文档写作流，支持所见即所得和源码模式双向切换。

## 直接使用

如果你只是想使用软件，不需要安装 Node.js、npm 或 Electron。

当前便携版产物：

- `dist/FreeMarkDown-0.1.3-Portable.exe`

使用方式：

1. 进入仓库的 `dist` 目录。
2. 双击 `FreeMarkDown-0.1.3-Portable.exe`。
3. 应用会直接运行，不需要安装额外运行时或开发依赖。

说明：

- 这是绿色便携版，Electron 运行时已经被打进 exe。
- 可以直接复制到 U 盘或任意 Windows 机器运行。
- 首次启动如果被系统拦截，请在 Windows 安全提示中选择继续运行。

## 功能

- Typora 风格单文档编辑
- 所见即所得 / 源码模式切换
- Markdown 导入与导出
- 本地草稿自动保存
- 标题大纲导航
- 表格插入与增删行列
- 任务列表勾选
- 图片拖拽和粘贴
- 列表续写、源码模式缩进
- 导出 PDF（保留原生文档大纲）
- 导出 Word 文档（`.docx`，保留 Heading 大纲）

## 开发环境要求

如果你要从源码运行或自己打包，请先准备这些基础依赖：

- Windows 10 / 11 x64
- [Node.js 22 LTS](https://nodejs.org/)
- npm 10 或更高
- Git

检查本机环境：

```powershell
node -v
npm -v
git --version
```

期望结果：

- `node -v` 显示 `v22.x`
- `npm -v` 显示 `10.x` 或更高

## 获取源码

```powershell
git clone <your-repo-url>
cd FreeMarkDown
```

## 安装依赖

```powershell
npm install
```

安装完成后，仓库会自动下载 Electron 和构建所需依赖。

## 本地检查

先做语法检查：

```powershell
npm run check
```

如果你在 Windows 桌面会话里开发，建议再跑一次桌面冒烟测试：

```powershell
npm run test:smoke
```

说明：

- `test:smoke` 会实际拉起 Electron 窗口做基础交互验证。
- 需要本机能打开桌面窗口；纯 headless 服务器不适合跑这个脚本。

## 从源码运行

```powershell
npm start
```

运行后你会得到一个本地开发版 FreeMarkDown 窗口。

## 构建 Windows 绿色版

执行：

```powershell
npm run build:portable
```

或：

```powershell
npm run release:win
```

构建成功后，产物会出现在：

- `dist/FreeMarkDown-0.1.3-Portable.exe`

这个 exe 已经包含应用运行所需内容，目标机器不需要再安装 Node.js、npm 或 Electron。

## 推荐发布流程

1. `npm install`
2. `npm run check`
3. `npm run test:smoke`
4. `npm run build:portable`
5. 检查 `dist/FreeMarkDown-0.1.3-Portable.exe` 是否生成
6. 双击 exe 做一次人工验证

## 常见问题

### 1. `npm install` 失败

优先确认：

- Node.js 是否为 22.x
- npm 是否可用
- 网络是否能访问 npm registry

然后删除 `node_modules` 后重试：

```powershell
Remove-Item -Recurse -Force .\node_modules
npm install
```

### 2. `npm run test:smoke` 失败

检查是否在可交互的 Windows 桌面环境中运行。这个脚本会真的打开应用窗口。

### 3. 便携版无法启动

优先确认：

- 目标系统为 Windows x64
- 安全软件没有拦截 exe
- exe 文件没有在下载过程中损坏

## 发布文档

更详细的发布说明见：

- `RELEASE.md`
