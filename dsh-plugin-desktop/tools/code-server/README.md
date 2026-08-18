# 右栏 IDE：VS Code 联动说明

右栏「集成开发环境」面板采用 **VS Code 联动**方案：不下载/内嵌网页版 IDE，而是
检测并复用你机器上**已经安装的 VS Code**（Windows 原生，免 WSL、免额外下载）。

> 背景：code-server（网页版 VS Code）官方**没有 Windows 版**；VS Code 自带 `serve-web`
> 的服务端组件又依赖微软 CDN（部分网络不通）。因此 Windows 上最稳的做法就是直接联动
> 本机已装的 VS Code 本体。

## 它是怎么工作的

1. **检测**：应用启动时按顺序查找 `Code.exe`——
   `DSH_VSCODE_PATH` 环境变量 → `%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe`
   → `%ProgramFiles%\Microsoft VS Code\Code.exe` → `%USERPROFILE%\AppData\Local\Programs\Microsoft VS Code\Code.exe`
   → `D:\Microsoft VS Code\Code.exe`。
2. **扩展自动同步**：启动时把 `ide-extension/`（选区→AI 桥接扩展）同步到
   VS Code 的扩展目录 `%USERPROFILE%\.vscode\extensions\dsh-ide-bridge`（已存在且不旧则跳过）。
3. **打开项目**：面板里点「在本机 VS Code 打开项目」→ 主进程以**脱离进程**方式执行
   `Code.exe --reuse-window <工作区文件>`（工作区 = 配置文件目录 + 面板里允许的目录）。
   VS Code 是独立窗口，应用退出不影响它。
4. **框选 → AI**：在 VS Code 里框选代码 → `Ctrl+Alt+E`（解释，回复进左侧对话）/
   `Ctrl+Alt+M`（修改，写回文件并打开内联 diff）。扩展把选区 POST 到本机回环
   `/_dsh/desktop/ide/ask`，主进程注入本地 agent；agent 与 VS Code 共享磁盘，
   修改即刻可见。编译/运行用 VS Code 自带终端。

## 使用前提

- 机器上已安装 VS Code（否则面板会提示安装，或设置 `DSH_VSCODE_PATH` 指向 Code.exe 后重启）。
- 首次同步扩展后，**重启一次 VS Code 窗口**让扩展生效。
- 先让左侧 AI 对话跑过至少一轮（创建会话），否则选区桥返回"请先发起一轮 AI 对话"。

## 开发模式：改了扩展源码怎么办

扩展是独立小包，需先编译成 `out/extension.js` 才会被同步（产物不入库）：

```bash
cd dsh-plugin-desktop
node node_modules/typescript/bin/tsc -p ide-extension/tsconfig.json
```

之后重启应用（或重开 IDE 面板）即可重新同步。打包安装版之前也要先跑一次该命令。

## 排障

| 现象 | 处理 |
|---|---|
| 面板提示"未检测到 VS Code" | 安装 VS Code，或设 `DSH_VSCODE_PATH` 指向 Code.exe 后重启应用 |
| 打开了 VS Code 但选区快捷键无效 | 确认扩展目录 `%USERPROFILE%\.vscode\extensions\dsh-ide-bridge` 存在（含 `out/extension.js`），重启 VS Code 窗口 |
| 快捷键报"未找到桥接配置" | 确认 `%USERPROFILE%\.dsh-desktop\ide-bridge.json` 存在（应用启动时会写），且桌面应用正在运行 |
| 扩展存在但代码没被 AI 改 | 先让左侧对话跑过一轮；修改模式依赖 agent 的文件编辑工具，若对话未启用该工具，agent 会改为纯文本回答 |
