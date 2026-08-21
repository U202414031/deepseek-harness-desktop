# PR #429 集成关系说明（Integration Map）

> 用途：随 PR #429 提供给上游维护者审阅，解释「把 dsh-plugin-desktop 拆分为独立桌面包 + 完善外部机器人」改动的集成边界。也可作为本 fork 长期留档。
> 基线：upstream master（8eaefb3149，v2.0.1）+ dsh runtime 0.1.0-rc.7。

## 一、背景

原 `dsh-plugin-desktop` 是单体桌面包：Electron 壳 + 皮肤 + 插件市场 + API 计量 + 外部机器人（IM 网关）+ 工作流 + IDE 桥全部挤在一个包里。本 PR 按功能域将其拆分为 7 个独立 workspace 包，每个包通过标准 Cordis bundle 机制挂载，并完成 external-robots（IM 网关）的 QQ/微信/飞书双向对话。

## 二、拆分包一览

| 包 | 功能域 | 挂载点（slot / service / 路由） | 关键文件 |
|---|---|---|---|
| `dsh-desktop-im-bridge` | IM 网关（Host 服务） | Host service `ImGateway`；`/desktop/im-gateway/{status,config,qr,reload}` 路由；经 `ctx.webServer` 注册 | `src/gateway.ts`、`src/channels/{qq,feishu,weixin}.ts` |
| `dsh-desktop-external-robots` | 外部机器人（客户端面板） | `sidebar.robots` 插槽（`slots.inject`） | `src/client/features/robots/*` |
| `dsh-desktop-whale-skins` | 鲸鱼皮肤 / 换肤 | `sidebar.skins` 插槽（`slots.inject`） | `src/client/features/skins/*` |
| `dsh-desktop-github-market` | GitHub 插件市场 | `sidebar.marketplace` 插槽（`slots.inject`） | `src/client/features/marketplace/*` |
| `dsh-desktop-api-meter` | API 设置 / 用量计量 | `sidebar.api` 插槽 + service `desktop.model-monitor` | `src/client/features/{api,usage}/*` |
| `dsh-desktop-workflow-canvas` | 工作流画布 | `sidebar.workflow` + `workflow.canvas` 插槽 | `src/client/features/workflow/*` |
| `dsh-desktop-ide-bridge` | IDE 桥（VS Code 联动 / 内嵌编辑器） | `ide` 插槽；`/desktop/ide/{info,config,open,ask}` 路由 | `src/ide-server.ts`、`src/client/features/ide/*` |

各包均为 `private: true`、版本 `0.1.0-dev.0`，仅在本地 workspace 组合，不发布 npm。Host 侧入口保持最小（renderer-only 包仅暴露空 plugin 对象，客户端半身经 `dsh.client` + `exports["./client"]` 声明单独装载）。

## 三、壳（dsh-plugin-desktop）保留与迁出

**迁出**：`src/im-gateway/*`（→ im-bridge）、`src/ide-server.ts` 与 `src/client/features/ide/*`（→ ide-bridge）、`src/electron-runtime.ts` 中与皮肤/市场/API/工作流/机器人相关的客户端功能（→ 对应包）。

**保留**：Electron 壳职责——启动与生命周期（`main.ts`、`electron-runtime.ts`）、profile 管理（`profile.ts`、`profile-manager.ts`）、托盘/窗口/更新、`ctx.desktopProfiles` / `ctx.desktopPnpm` service、数据目录重定向（`data-root.ts`、`data-routes.ts`）、技能目录 junction（`skills-junction.ts`）。

**壳注入关系**：`profile.ts` 的 `REQUIRED_BUNDLES` 在每次 profile 启动时注入上述 7 个包，保证桌面 profile 开箱即包含全部桌面包。

## 四、客户端插槽注册与竞态修复

拆分前，客户端功能直接 `slots.register` 进外壳声明的座位；拆分后多包并行进入 Loader 时，存在「seat 尚未声明、注册先行」的竞态，报 `slot "sidebar.*" is not declared`。

修复：客户端一律改为 `slots.inject('<slot>', () => slots.register(...))` —— 延迟到外壳声明座位后再注册，与上游惰性槽（`settings.section` 等）的既有约定一致。这是本次唯一触及 Loader 组合机制的点，改动集中在各包的 `src/client/index.ts`。

## 五、profile 兼容性

- 旧 bundle 名 `dsh-desktop-external-tools`（外部工具面板改名「外部机器人」）与 `@deepseek-ai/dsh-desktop-app` 加入 `OBSOLETE_DESKTOP_BUNDLE_SET`（`dsh-plugin-desktop/src/profile.ts`），boot 时自动从持久化 profile 中修剪，避免用户升级后残留幽灵 bundle。
- 数据目录 / 技能目录重定向不影响既有 sessions 与 settings（沿用统一数据根机制，env 可覆盖）。

## 六、验证

- 单元测试：`dsh-desktop-im-bridge/tests/{channels,im-gateway}.spec.ts`、`dsh-desktop-ide-bridge/tests/{ide-editor-routes,ide-embedded}.spec.ts`、`dsh-plugin-desktop/tests/{data-root,skills-junction,profile}.spec.ts` 等。
- 手工验证：`yarn dev` 启动桌面，确认左栏各入口（机器人/皮肤/市场/API/工作流/IDE）可打开、IM 网关三通道（QQ/飞书/微信）可配置连接、升级旧 profile 后无残留 bundle。

## 七、与上游边界 / 待对齐事项

- 本 PR 未改动上游官方 bundle 与 harness 子模块代码（`deepseek-harness` 固定在 `dsh-v0.1.0-rc.7`）。
- **运行时版本**：上游仓库代码目前仍在 rc.7，而 npm 已发布 `@deepseek-ai/dsh@0.1.0-rc.8`。本 PR 基于 rc.7 构建，可在审查阶段配合 rc.8 运行时验证；如需，可单独提交「升级 rc.8」的 PR，或由维护者确认后并入。
- **插件归属**：7 个功能包在 DSH 生态中属于插件层。若维护者期望插件走独立仓库（如 `dsh-mcp-manager` 模式），本 PR 可只保留「壳层必要的组合改动」，功能包迁出为独立插件仓库，通过 `dsh plugin install` 分发，并可争取社区市场（`dsh-community-market`）收录。

## 附：PR 提交清单（43 commits，按主题分组，从新到旧）

| 主题 | 提交 |
|---|---|
| 合并上游 / 对齐 | 8412f36873, 9248311e43, ffc103e69d, 0de09e9a63, 3a76c60edc |
| **拆分重构（本 PR 核心）** | **3a29338b8e** |
| external-robots / IM 网关 | 879067c0cc, 8cea55c826, 072b9c4cf2, e0474dfacd, 323fff4ffe, bfb32a2857, 0fca98668d |
| API 设置 / 用量 | 5420b3993a, 3c92812a29, 7a609028f0, 068a38034d |
| 插件市场（GitHub） | 5580822da5, a8217d9a74, 7041609e69, 0fdaada417, a1b2859756, 4150b8892e, d48f043ef5 |
| 工作流画布 | 528b9907aa, 17d9c8cff1 |
| IDE 桥 | b4aacc7117 |
| UI / 右栏 / 皮肤（fork 历史背景） | 5fffcdcbd4, 49ec1240a3, 28294e45c4, 80b0970029, a869deb824, e04e06e584, d007d7df74, 260f4e9f2d, 826b410c0d, 9ed3516143, 79f2a93599, 6f2265d2fc, 53a5cd8d13, d12b5b1379, 75b3f84560, 0e30b7f29a |

> 如需聚焦拆分：可将「合并上游」之外的内容重组为 3 个 PR —— ① 纯拆分重构（3a29338b8e，可能需连带前置功能基线）；② external-robots / IM 网关功能（上表第 3 组）；③ Loader 竞态修复与 profile 兼容（第 4、5 组的修复类提交 + 壳改动）。
