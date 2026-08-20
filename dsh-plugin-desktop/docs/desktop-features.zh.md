# 桌面端新增功能（贡献特性）

本目录为 `dsh-plugin-desktop` 增加了三块社区贡献功能，均在 **advanced** 模式下生效：

1. **右侧「产物与代码」面板** —— 会话级面板，自动从当前会话提取代码块与工具产物。
2. **左侧导航栏 + 插件市场** —— 在左侧栏新增应用导航，可在「对话 / 市场 / 皮肤」之间切换；插件市场会从 GitHub 收集 `deepseek-harness` / `dsh` 相关插件，支持浏览、安装、更新、卸载。
3. **左侧栏皮肤功能** —— 内置多套 UI 皮肤，切换即写 `:root` 的 CSS 变量并持久化到本地。

## 布局模型

`DesktopLayoutState`（`src/client/layout-state.ts`）新增两个维度：

- `leftPanel: 'chat' | 'marketplace' | 'skins'` —— 控制左侧栏渲染哪一块桌面自有界面。
- `artifacts: number` —— 右侧「产物与代码」面板的宽度，0 表示关闭。

`computeDesktopColumns` 现在返回 4 列：`sidebar | conversation | details | artifacts`。当 `details` 或 `artifacts` 为 0 时，对应列折叠，布局行为与旧版完全一致（已有单测覆盖）。

## 右侧产物与代码面板

- 注册为会话级插槽 `artifacts`（见 `src/client/contracts.ts` 与 `src/client/advanced-shell.ts`）。
- 组件 `src/client/features/artifacts/ArtifactsPanel.tsx` 通过标准 `useSession` 读取会话快照，
  遍历 `nodes`：从 assistant 文本 / reasoning 块与 tool-result 中使用正则提取 ``` 围栏代码块；
  将 tool-result 节点收集为「产物」卡片（含工具名与错误标记）。
- 顶部 Tab 在「代码 / 产物」间切换，可一键复制代码。

## 插件市场

### 客户端（`src/client/features/marketplace/`）

- `curated-registry.ts`：内置兜底目录 `CURATED_PLUGINS`，并提供 `fetchGithubPlugins()`
  通过 `api.github.com/search/repositories` 以 `topic:deepseek-harness`、`topic:dsh-plugin`、
  `deepseek harness plugin` 三个查询收集真实插件。
- `MarketplacePanel.tsx`：渲染卡片（名称、描述、标签、星标、仓库链接），
  安装状态持久化在 `localStorage`（`dsh-desktop-installed-plugins`）。
  安装/更新/卸载按钮向 Host 路由发起 `POST /desktop/marketplace/<mode>`。

### Host 端（`src/marketplace-host.ts`）

- 由 `src/index.ts`（desktop-shell）通过 `ctx.inject(['desktopPnpm','desktopProfiles'], ...)`
  在两项能力可用时安装三个 loopback 路由：
  - `POST /desktop/marketplace/install`
  - `POST /desktop/marketplace/uninstall`
  - `POST /desktop/marketplace/update`
- 每个请求先经 `validateSpec` 做严格白名单校验（仅允许 npm 包名、`github:` 与 `file:` 形式），
  随后调用 `ctx.desktopPnpm.runPlugin(['add'|'remove'|'update', spec], ctx.desktopProfiles.current.dir, signal)`，
  复用与上游 `dsh plugin` CLI 相同的 profile reconcile 权威路径。
- 路由附带 CORS 头，便于渲染进程同源调用。

> 维护 `CURATED_PLUGINS`：当前为示例条目，建议贡献者替换为社区真实插件清单，或完全依赖 GitHub topic 搜索。

## 皮肤功能

- 皮肤目录 `src/client/features/skins/skins.ts`：内置 `default / 午夜蓝 / 日落橙 / 极地 Nord / 终端绿 / 薰衣草紫`。
- `skin-service.ts`：以外部 store 形式暴露 `getSkin / setSkin / subscribeSkin / applySkin`，
  `applySkin` 把皮肤变量写入 `document.documentElement`（既覆盖桌面自有 `--dsh-desktop-*` 令牌，
  也覆盖上游 `--dsw-alias-*` 令牌以影响整体 chrome），并在 `default` 时清除覆盖。
  选择持久化到 `localStorage`（`dsh-desktop-skin`），并在 `advanced-shell` 启动时恢复。
- `SkinsPanel.tsx`：渲染皮肤卡片，点击即切换。

## 统一数据根目录（所有桌面端数据不固定在系统盘）

桌面端的全部数据默认散落在系统盘用户目录（DSH home `~/.dsh`、公共技能 `~/.agents`、
上传中转 `~/.dsh-dropbox`、Electron 运行数据 `%APPDATA%\DSH Desktop`、辅助配置
`~/.dsh-desktop`）。桌面端支持把这些**全部**重定向到一个用户自选的数据根目录：

```yaml
# 方式一：DSH home 的 settings.yaml
dsh-desktop:
  dataDir: D:/MyData/desktop-data
```

```text
# 方式二：环境变量（优先级更高，新开的终端/重启后生效）
setx DSH_DESKTOP_DATA_DIR "D:\MyData\desktop-data"
```

启动时按优先级解析（环境变量 > 设置文件 > 未配置），并从数据根派生所有子目录：

| 子目录 | 用途 | 注入方式 |
|---|---|---|
| `<root>/dsh` | DSH 主目录（profiles/sessions/storages/settings） | `DSH_HOME` |
| `<root>/agents` | 公共 Agent 技能 | `DSH_AGENTS_HOME` |
| `<root>/dropbox` | 文件上传中转目录 | `DSH_DROPBOX_DIR` |
| `<root>/desktop` | Electron 运行数据（日志、更新、崩溃记录） | `app.setPath('userData')` |
| `<root>/aux` | 辅助配置（IM 网关、IDE 桥） | `~/.dsh-desktop` 目录链接 |

设置入口：官方「设置」面板里的「数据目录」页（显示当前数据根与各子目录，输入新路径
保存后重启生效）。`DSH_DESKTOP_DATA_DIR` 环境变量存在时优先于设置文件中的值。

### 技能目录细粒度覆盖（可选）

数据根已把技能目录一并搬走（`<root>/dsh/skills` 与 `<root>/agents/skills`）。若只想
单独指定技能位置（覆盖数据根派生值），仍可用：

```yaml
dsh-desktop:
  skills:
    dshDir: D:/MySkills/dsh      # 覆盖 DSH 技能根（默认 $DSH_HOME/skills）
    agentsDir: D:/MySkills/agents  # 覆盖公共 Agent 技能根（默认 $DSH_AGENTS_HOME/skills）
```

`agentsDir` 注入 `DSH_AGENTS_HOME`；`dshDir` 把 `$DSH_HOME/skills` 目录链接到指定目录。
已存在的真实技能目录不会被覆盖。

## 接入 / 构建

- 无需修改 `cordis.patch.yml`：Host 路由复用已有 `desktop-shell` 插件生命周期。
- 客户端通过已有 `applyAdvancedShell` 注入，无需改动 `package.json` 的 `dsh.client` 注入列表。
- 本地校验：`yarn workspace dsh-plugin-desktop typecheck && yarn workspace dsh-plugin-desktop test`
  （需在包含 `deepseek-harness` 子模块的完整开发环境中运行）。
