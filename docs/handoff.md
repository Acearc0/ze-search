# ZError (ze-search fork) 交接文档

> 最后更新：2026-11-04
> 原项目：https://github.com/Miaozeqiu/ZError
> 本 fork 仓库：https://github.com/Acearc0/ze-search（私有）

## 一、项目概览

ZError 是一款基于 Tauri 2 架构的本地 AI 题库软件，专为 OCS 网课助手设计。本 fork 在原版基础上增加了**联网搜索**、**模型自动拉取**、**多模型懒投票**等功能，做了与原版**共存运行**的改造（独立进程名/数据目录/端口/互斥锁），并**移除了对原作者服务器的远程模型目录、版本检查与自动更新依赖**（详见 3.8 节）。

- **前端**：Vue 3 + TypeScript + Vite
- **后端**：Rust（Tauri 2），仅负责窗口、文件系统、HTTP 代理、数据库、本地 OCS 服务等
- **LLM 调用**：完全在前端完成，Rust 不碰协议细节

## 二、核心架构

### 2.1 前后端分工

| 层 | 职责 | 关键文件 |
|---|---|---|
| Rust 后端 | 窗口管理、OCS 本地服务、SQLite 题库、文件系统、HTTP 代理（`plugin-http`） | `src-tauri/src/*.rs` |
| 前端状态 | 模型配置、应用设置、主题 | `src/services/modelConfig.ts`、`src/services/settings.ts` |
| 前端 LLM | 模型调用、流式解析、工具循环、搜索 | `src/views/Home.vue`、`src/services/modelProtocol.ts`、`src/services/webSearch.ts` |
| 前端 UI | 首页答题、题库、设置 | `src/views/*.vue` |

### 2.2 LLM 调用机制（重点）

LLM 调用链全部在前端，核心是 `modelProtocol.ts`：

1. 每个模型有 `apiProtocol` 字段：`openai-chat` | `openai-responses` | `anthropic` | `custom`
2. `resolveExecutableModelJsCode(model)` 根据协议生成对应的 `processModel(input, config, fetch, abortSignal)` 函数源码（模板字符串拼接）
3. `Home.vue` 中用 `new Function(source)` 执行该源码，网络请求走 `@tauri-apps/plugin-http` 的 `fetch`
4. 流式响应通过 SSE 解析，支持工具调用（function calling）循环

**预设协议模板**（`buildCommonHelpers`）已做版本感知 URL 拼接：Base URL 已带 `/v1`、`/v1beta` 等版本段时直接拼端点路径，否则补 `/v1` 前缀——兼容两种 Base URL 写法。

### 2.3 联网搜索

- `src/services/webSearch.ts`：移植自 dsh-free-search 的 6 个免 key 引擎（bing/ddg/ddg-lite/searxng/anysearch/tavily keyless），带回退链、3 次重试、反爬检测
- 模型通过 `web_search` 工具主动调用搜索（复用现有工具循环），搜索结果注入 system prompt
- 配置项在 `src/services/settings.ts` 的 `webSearch` 字段，UI 在 `GeneralSettings.vue`
- 单元测试：`tests/webSearch.test.ts`（mock fetch，无真实网络）

## 三、本 fork 定制功能

### 3.1 联网搜索（已上线）
- 6 免费引擎 + 回退链，模型主动调用 `web_search` 工具
- 设置页有搜索测试按钮
- 流式 tool_calls 分片按 `index` 归并（首个分片带 id/name，其余只有参数分片）
- 当前日期注入 system prompt（解决搜索结果旧年份问题）

### 3.2 与原版共存
- 独立进程名/数据目录/端口/互斥锁，可与原版 ZError 同时运行

### 3.3 模型自动拉取
- 设置 → 模型管理 → 平台右键「拉取模型」，调用平台 `/models` 接口
- 拉取的模型默认 `openai-chat` 协议（能拉列表的端点必然是 OpenAI 兼容的）
- 按 `modelId` 去重，不会重复添加
- 每行可选「文本/视觉」分类，启发式预填（`/vision|-vl|vl-|-4v|4v-|image|omni/i`）
- 拉取弹窗支持搜索过滤

### 3.4 同一模型兼任文本与视觉
- `getSelectedVisionModel()` 不再限定 `category === 'vision'`
- 模型选择弹窗的文本/视觉页签互通，同一模型可同时在两处被选中
- 同一模型若同时被选为文本和视觉，去重后只调用一次

### 3.5 多模型懒投票
- 默认开启，可在 设置 → 通用设置 → 多模型答题 中开关
- 逻辑：先并发调用前两个模型 → 答案一致直接采用（其余模型显示「未调用本模型」）→ 不一致才调用其余模型
- 可选「第三模型（仲裁模型）」：不一致时只调用这一个模型参与投票
- 投票：`getMostFrequentSuccessfulAnswer` + `normalizeAnswerForComparison` 取多数票，平票取先答者
- 总结模型（可选）对最终答案做汇总

### 3.6 自定义问题
- 首页支持输入自定义问题直接问答，不走题库

### 3.7 模型管理增强
- 远程/默认模型可删除（右键菜单），删除后记入 `deletedRemoteModels`
- 加载时自动按 `modelId` 去重（优先保留远程模型）

### 3.8 去外部依赖化（重要）
本 fork 已**彻底移除**对原作者服务器 `zaizhexue.top` 的以下依赖：

| 移除项 | 原用途 | 现在的行为 |
|---|---|---|
| 远程模型目录 `live/models.json` | 启动下发预设平台/模型 | 不再自动出现预设平台，全部由用户手动添加或「拉取模型」 |
| 版本检查 `live/latest_version.json` | 检测新版本弹窗 | 已删除 `versionCheck.ts` / `useAppUpdate.ts` / `UpdateDialog.vue` |
| Tauri 自动更新 `live/update.json` | 在线下载安装包 | 已移除 `tauri-plugin-updater` 依赖与 `tauri.conf.json` updater 配置 |

- 升级方式改为：到 GitHub Actions 手动下载新安装包覆盖安装
- 关于页版本号通过 `@tauri-apps/api/app` 的 `getVersion()` 动态获取
- Rust 侧同步清理：`can_native_updater_install` 命令、macOS TMPDIR 对齐逻辑（`ensure_tmpdir_same_volume_as_exe`）均已删除
- **仍保留**的唯一 `zaizhexue.top` 请求：平台图标 `providers/*.png`（静态图片下载，不传输用户数据；加载失败仅显示空白，不影响功能）

### 3.9 当前对外网络接口一览
| 接口 | 地址来源 | 触发条件 |
|---|---|---|
| LLM 调用 | 用户配置的 Base URL | 答题/总结时 |
| 拉取模型列表 | 用户配置的 Base URL `/models` | 用户点击「拉取模型」 |
| 联网搜索 | bing/ddg/searxng 等 | 设置中开启且模型调用 `web_search` 工具 |
| 平台图标 | `zaizhexue.top/providers/` | 设置页展示平台图标时（唯一硬编码外部域名） |

除以上外无任何遥测/上报/后台请求。

## 四、关键文件速查

| 文件 | 作用 |
|---|---|
| `src/views/Home.vue` | 首页答题逻辑核心，含多模型调度、懒投票、工具循环 |
| `src/services/modelProtocol.ts` | LLM 协议模板生成、URL 拼接、thinking 负载 |
| `src/services/modelConfig.ts` | 模型/平台配置 store，远程同步，增删改查 |
| `src/services/settings.ts` | 应用设置（含 webSearch、answerLazyVote、arbitrationModelId） |
| `src/services/webSearch.ts` | 6 免费搜索引擎 + 工具 schema |
| `src/utils/answerFewShot.ts` | 答题提示词，引导模型调用搜索 |
| `src/views/settings/ModelSettings.vue` | 模型管理页（拉取、增删改） |
| `src/views/settings/ModelSettings/FetchModelsDialog.vue` | 拉取模型弹窗 |
| `src/views/home/ModelSelectorDialog.vue` | 首页模型选择弹窗 |
| `src/views/settings/GeneralSettings.vue` | 通用设置（搜索、懒投票、仲裁模型） |
| `.github/workflows/build-windows.yml` | CI 构建 Windows 安装包 |

## 五、构建与部署

### 5.1 本地开发
```bash
npm install
npm run dev          # 前端开发
npm run tauri:dev    # Tauri 开发（需 Rust 工具链）
```

### 5.2 云构建（推荐，本机无 Rust 工具链）
本仓库通过 GitHub Actions 在云端构建 Windows NSIS 安装包：

1. 提交代码到 `master` 分支（push 触发）
2. Actions 自动运行 `build-windows.yml`
3. 构建完成后在 Artifacts 下载 `.exe` 安装包
4. 构建产物路径：`src-tauri/target/release/bundle/nsis/*.exe`

CI 配置：`.github/workflows/build-windows.yml`，使用 npm cache + rust cache 加速。

### 5.3 类型检查与测试
```bash
npx vue-tsc --noEmit              # 类型检查，目标 0 错误
node --test tests/webSearch.test.ts  # 搜索单测，9/9 通过
```

## 六、Git 协作规则

1. **本仓库无 git 身份配置**，提交时需内联：
   ```bash
   git -c user.name="Miaozeqiu" -c user.email="miaozeqiu@users.noreply.github.com" commit -m "..."
   ```
2. **推送规则**：所有改动先提交到本地，等用户明确说「上传」才 `git push`
3. 沙箱环境下 git 内部文件（`.git/index`、锁文件等）替换可能被误报为回收站事件，属正常现象，`git status`/`git log` 验证即可
4. 推送 GitHub 时需禁用沙箱（`dangerouslyDisableSandbox: true`），连接不稳定时重试即可

## 七、已知坑点与排查指南

### 7.1 拉取的模型不可用（404）
- **症状**：拉取的模型调用时报 HTTP 404
- **常见原因**：
  1. Base URL 以 `/v1` 结尾，旧版模板重复拼接 `/v1/v1/...` → 已修复（版本感知 URL）
  2. 拉取的模型继承了错误的协议（如 anthropic）→ 已修复（默认 openai-chat）
- **排查**：确认模型的 `apiProtocol` 为 `openai-chat`，Base URL 带不带 `/v1` 都行
- **修复**：删掉旧的拉取模型，重新拉取

### 7.2 模型重复
- 已修复：`addModelToPlatform` 按 `modelId` 去重；加载时 `dedupeByRuntimeModelId` 自动清理
- 旧数据会在下次启动时自动合并

### 7.3 流式 tool_calls 参数错误
- 流式 tool_calls 分片只有第一个带 `id`/`name`，按 `id` 归并会失败
- 已修复：按 `index` 归并 + 兜底正则提取 query

### 7.4 阿里云兼容模式
- 新端点格式：`https://{app}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`
- Base URL 带不带末尾 `/v1` 都兼容（版本感知 URL）
- 拉取的模型默认 openai-chat，调用 `/chat/completions`

### 7.5 Edit 工具大块匹配失败
- 含 `${...}` 模板字面量的大块 `old_string` 容易匹配失败
- 改用 node 脚本按行号删除，或拆成小片段编辑

## 八、后续维护建议

1. **联网搜索质量**：引擎可能因反爬失效，关注 `webSearch.ts` 的回退链
2. **平台图标**：`iconCache.ts` 仍硬编码 `zaizhexue.top/providers/`，如需彻底断链可改为本地图标或按平台名首字母渲染占位图标
3. **多模型调度**：`Home.vue` 是最复杂的文件，改动时务必跑 `vue-tsc`
4. **CI 构建时间**：可通过优化 cache 或拆分步骤缩短
5. **共存**：若需进一步隔离，检查 `tauri.conf.json` 的 identifier、数据目录、端口配置
6. **升级发布**：无自动更新，发新版需在 Actions 下载产物并通知用户手动覆盖安装

## 九、提交历史要点（master）

| 提交 | 内容 |
|---|---|
| `2584ec0` | 移除答案二次自检；拉取模型支持文本/视觉分类 |
| `47967a6` | 拉取弹窗搜索框、字体统一、同模型兼任文本+视觉、懒投票 |
| `963e67c` | 懒投票开关与第三模型（仲裁）移入通用设置 |
| `d0eb2b5` | 版本感知 URL 拼接修复 404；拉取模型跟随平台协议 |
| `f96254a` | 拉取模型按 modelId 去重；远程/默认模型可删除 |
| `f15d5ab` | 拉取模型一律默认 openai-chat 协议 |
| `97f2d21` | 移除远程模型目录、自动更新与版本检查（去外部依赖） |

> 注：`97f2d21` 已提交本地，尚未推送（截至本文档撰写时）。
