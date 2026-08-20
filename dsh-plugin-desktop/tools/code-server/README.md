# 右栏 IDE：内置轻量编辑器（CodeMirror）+ 可选 VS Code 联动

右栏「集成开发环境」面板以**内置轻量编辑器**为主：项目文件树（仅放行配置文件目录与
你允许的目录）+ CodeMirror 6 编辑器，全部在应用内完成——**无运行时依赖、无下载、无网络、
打包即用**。`外部 VS Code` 按钮保留为可选逃生通道（本机装有 VS Code 时出现）。

> 背景：早期方案是内嵌 openvscode-server（浏览器版 VS Code）。它 workbench 全本地打包，
> 但 **gitpod 官方从不发布 Windows 预编译包**（Linux/macOS 有），Windows 上要自己构建，
> 维护成本高。内置编辑器把同样的四件事——目录树、查看/编辑、AI 代写、框选→解释/修改——
> 全部放进应用本身，彻底摆脱外部运行时。

## 它是怎么工作的

1. **文件树**：面板左侧列出 workspace roots（当前 profile 目录 + 「目录」里允许的路径）。
   点击目录懒加载子项；点击文件在右侧打开。所有路径都经主进程校验
   （`resolveAllowedPath`：realpath 规范化 + 白名单前缀检查，符号链接逃逸会被拒绝），
   **只能访问允许的目录，不能浏览整个磁盘**。
2. **编辑器**：CodeMirror 6（无 web worker、单文件打包），按扩展名自动语法高亮
   （ts/tsx/js/jsx、python、json、html、css、markdown、c/c++、java 等）。
   `Ctrl+S` 或「保存」写回磁盘（`POST /_dsh/desktop/ide/file`）；有未保存修改时文件名旁
   显示 ●。二进制文件与 >1MiB 的文件只读拒绝。
3. **框选 → AI**：在编辑器里选中代码 → 「解释」/「修改」→ 复用现有
   `/_dsh/desktop/ide/ask` 桥接：解释进左侧对话；修改由 agent 写回文件后点「刷新」查看。
   未选中时默认发送整个文件（过长自动截断）。AI 写的文件与编辑器共享磁盘，刷新即可见。
4. **目录管理**：工具栏「目录」打开允许路径列表（新增/移除/系统选择器）；增删后文件树自动刷新。
5. **外部 VS Code（可选）**：工具栏「外部 VS Code」保留原联动：写出 `.code-workspace` 后
   以脱离进程方式启动本机 VS Code；桥接扩展同步到 `%USERPROFILE%\.vscode\extensions`，
   框选 `Ctrl+Alt+E/M` 走同一 ask 桥接。

## 内嵌 openvscode-server（可选，Linux/macOS 或自建 Windows 运行时）

面板默认不再启动 openvscode-server，但宿主代码与打包接缝仍在
（`resources/code-server/openvscode-server`），Linux/macOS 官方 release 直接可用：

```bash
yarn ide:fetch --version v5.7.0     # Linux/macOS：官方预编译包
```

Windows 无官方包，可用 `--archive <zip>`（本地压缩包）、`--from-dir <构建目录>`
（源码构建产物，自动补 node.exe）或 GitHub Actions 出包
（`tools/code-server/openvscode.windows-build.yml` + `DSH_OPENVSCODE_REPO`）三种方式
自建；详见 `scripts/fetch-openvscode-server.mjs` 头部注释。运行时约 300–400MB（解压后），
gitignore，不提交。

## 使用前提

- 内置编辑器：无任何前提，离线可用。
- 框选 → AI 前，先让左侧 AI 对话跑过至少一轮（创建会话），否则 ask 桥返回
  "请先发起一轮 AI 对话"。
- 外部 VS Code 回退：机器上已安装 VS Code。

## 开发模式：改了扩展源码怎么办

桥接扩展（仅外部 VS Code 联动使用）是独立小包，需先编译成 `out/extension.js` 才会被同步：

```bash
cd dsh-plugin-desktop
node node_modules/typescript/bin/tsc -p ide-extension/tsconfig.json
```

## 排障

| 现象 | 处理 |
|---|---|
| 文件树为空 | 点工具栏「目录」添加允许的目录；确认路径存在 |
| 打开文件报错/拒绝 | 二进制文件（415）、>1MiB（413）、路径不在白名单（403）都会被拒绝 |
| 点「解释/修改」提示先发起对话 | 在左侧跑一轮 AI 对话后再试 |
| 保存后文件树里看不到新文件 | 点工具栏「刷新」重载文件树 |
| 外部 VS Code 未检测到 | 安装 VS Code 或设置 `DSH_VSCODE_PATH` 指向 Code.exe 后重启 |
| 内嵌 openvscode-server 启动失败（仅自建运行时） | 面板会显示 stderr 尾部；确认 `out/server-main.js` 与 `node`/`node.exe` 存在；点「重新启动」重试 |
