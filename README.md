# Parkit / 临泊站

Parkit / 临泊站 是一个本地优先的 Chrome 扩展，用来在电脑工作时临时停放复制的文本、链接、截图和文件信息。

它适合这些场景：

- 在多个软件之间中转文本、链接和截图
- 使用 `Ctrl+C` 复制内容后，稍后回到剪贴板里查找
- 使用 `Win+Shift+S` 截图后，在剪贴板页面直接看到图片预览
- 下班前集中清理：删除、暂存或保存到本地

## 功能

- Chrome 扩展入口，不接管 Chrome 新建标签页
- 支持手动粘贴、拖拽文件、读取剪贴板
- 支持 Windows 全局剪贴板监听
- 支持 `Ctrl+C` 文本捕获
- 支持 `Win+Shift+S` 截图捕获
- 图片内容直接显示预览
- 自动补充来源窗口、URL 类型、文件路径类型和处理建议
- 删除时有确认弹窗、轻量音效和票据碎片动效
- 支持搜索、标签、暂存、删除和导出 JSON
- 数据保存在本机浏览器 IndexedDB，不上传到服务器

## 安装

### 1. 下载项目

下载本仓库，解压到本地目录。

### 2. 加载 Chrome 扩展

1. 打开 Chrome
2. 进入 `chrome://extensions`
3. 打开右上角“开发者模式”
4. 点击“加载已解压的扩展程序”
5. 选择本项目目录

### 3. 启动 Windows 剪贴板监听

双击运行：

```text
install-and-start.cmd
```

它会启动本地监听程序，并加入 Windows 开机自启动。

## 日常使用

1. 点击 Chrome 右上角的 Parkit 扩展图标
2. 在任意软件里按 `Ctrl+C` 复制文本
3. 使用 `Win+Shift+S` 截图
4. 回到临泊站页面查看、搜索、复制、保存或删除

## 常用脚本

- `install-and-start.cmd`：安装并启动本地监听
- `open-work-clipboard.cmd`：打开剪贴板页面，并尝试启动监听
- `check-clipboard-watch.cmd`：检查本地监听和系统剪贴板状态
- `stop-clipboard-watch.cmd`：停止本地监听
- `package-extension.cmd`：打包扩展为 zip

## 隐私

Parkit / 临泊站 默认只在本机工作：

- 扩展数据保存在 Chrome 本地 IndexedDB
- 本地监听服务只监听 `127.0.0.1:18765`
- 本地监听会记录复制发生时的前台应用名和窗口标题，用于帮助回忆内容来源
- 不包含远程服务器
- 不主动上传剪贴板内容

更多说明见 [PRIVACY.md](PRIVACY.md)。

## 注意

Windows 全局剪贴板监听依赖 PowerShell 和 Windows Forms。首次运行时，Windows 可能会显示安全提示。

Chrome 扩展无法单独监听整个 Windows 系统剪贴板，所以本项目包含一个本地伴随脚本 `clipboard-watch.ps1`。
