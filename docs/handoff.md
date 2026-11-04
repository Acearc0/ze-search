# ZError (ze-search fork) 交接文档

> 最后更新：2026-11-04（本版逐条对照代码复核。**本轮复核只改本文档，未改动任何代码**；复核发现的失真表述已就地更正，与安全相关的现状见 7.6，务必先读）
> 原项目：https://github.com/Miaozeqiu/ZError
> 本 fork 仓库：https://github.com/Acearc0/ze-search（私有）

## 一、项目概览

ZError 是一款基于 Tauri 2 架构的本地 AI 题库软件，专为 OCS 网课助手设计。本 fork 在原版基础上增加了**联网搜索**、**模型自动拉取**、**多模型懒投票**等功能，做了与原版**共存运行**的改造（独立进程名/数据目录/端口/互斥锁），并**移除了对原作者服务器的远程模型目录、版本检查与自动更新依赖**（详见 3.8 节；注意：`live/models.json` 本身并未断干净，剩余依赖与风险见 3.8.1 与 7.6）。

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
本 fork 已移除对原作者服务器 `zaizhexue.top` 的以下依赖：

| 移除项 | 原用途 | 现在的行为 |
|---|---|---|
| 远程模型目录 `live/models.json` | 启动下发预设平台/模型 | 不再自动出现预设平台，全部由用户手动添加或「拉取模型」 |
| 版本检查 `live/latest_version.json` | 检测新版本弹窗 | 已删除 `versionCheck.ts` / `useAppUpdate.ts` / `UpdateDialog.vue` |
| Tauri 自动更新 `live/update.json` | 在线下载安装包 | 已移除 `tauri-plugin-updater` 依赖与 `tauri.conf.json` updater 配置 |

- 升级方式改为：到 GitHub Actions 手动下载新安装包覆盖安装
- 关于页版本号通过 `@tauri-apps/api/app` 的 `getVersion()` 动态获取
- Rust 侧同步清理：`can_native_updater_install` 命令、macOS TMPDIR 对齐逻辑（`ensure_tmpdir_same_volume_as_exe`）均已删除
- 补充：`capabilities/default.json` 里残留的 `updater:default` 权限曾在移除插件后导致 CI 构建失败，已由 `f2a693f` 删除（若再报 `unknown permission updater:default`，就是同类残留）

**⚠ 上表只对 `live/models.json` 的消费路径之一成立，勿按字面理解为「已与原作者服务器脱钩」。**
`97f2d21` 断掉的是「启动下发预设平台/模型」（`performRemotePlatformsSync()` / `syncRemotePlatforms()` 已无任何调用方，成了死代码），**但没有断掉对 `webapi.zaizhexue.top/live/models.json` 的请求本身**。该 JSON 的另外三个字段仍在被消费，见下方 3.8.1 与 7.6。

### 3.8.1 仍保留的 `zaizhexue.top` 依赖（不止图标）

| 保留项 | 路径 | 位置 | 触发 |
|---|---|---|---|
| 平台图标 | `providers/*.png`、`models/*` | `src/services/iconCache.ts`、`ModelSettings.vue` | 设置页展示图标时（失败仅空白，不影响功能） |
| 平台图标列表 | `live/models.json` → `providers_list` | `ModelSettings/PlatformConfigDialog.vue` `loadAvailableIcons()` | 打开平台配置弹窗时 |
| 模型图标映射 | `live/models.json` → `model_icon_mappings` | `ModelSettings.vue` `loadRemoteModelIconMappings()` | 进入模型管理页时 |
| **题目图片识别算法源码** | `live/models.json` → `question_image_algorithm` | `src/utils/questionImage.ts` | **答题/题库渲染时自动触发**，见 7.6 |

后三项走同一个 `fetchRemoteModelsCatalog()`（`modelConfig.ts`，30 秒冷却）。所以原版的「不传输用户数据、加载失败不影响功能」这句只对**图标图片**成立：对后三项，加载失败会让平台图标选择列表为空、模型图标缺失（并弹出错误提示），而 `question_image_algorithm` 更是会在后台自动拉取并执行远程代码。**2026-11-04 复核后决定：本表所列依赖全部保持原样，不做改动。**

### 3.9 当前对外网络接口一览
| 接口 | 地址来源 | 触发条件 |
|---|---|---|
| LLM 调用 | 用户配置的 Base URL | 答题/总结时 |
| 拉取模型列表 | 用户配置的 Base URL `/models` | 用户点击「拉取模型」 |
| 联网搜索 | bing/ddg/searxng 等 | 设置中开启且模型调用 `web_search` 工具 |
| 平台/模型图标 | `webapi.zaizhexue.top/providers/`、`/models/` | 设置页展示图标时（用户可见页面，非后台） |
| **远程模型目录 JSON** | `webapi.zaizhexue.top/live/models.json` | 图标列表/图标映射加载时；**以及答题、题库渲染时自动拉取并执行远程算法代码**（见 7.6，风险最高项） |
| 帮助文档 / 题库站外链 | `docs.zerror.cc`、`tiku.zerror.cc`、`app.zerror.cc` | 仅用户点击时打开，非自动请求 |

- 除以上外无遥测/上报类请求（不收集使用数据、不上报答题记录）。
- 域名之外的补充：`src-tauri/capabilities/default.json` 与 `url-content.json` 的 `opener` 仍放行 `https://webapi.zaizhexue.top/**`；`http:default` 为支持用户自定义 Base URL 放行 `https://**` / `http://**`，无法收窄。安全含义见 7.6。
- 也就是说：本 fork 尚未与原作者服务器完全脱钩，只要 `live/models.json` 还在被自动拉取，客户端行为就仍由上游服务端内容决定。

## 四、关键文件速查

| 文件 | 作用 |
|---|---|
| `src/views/Home.vue` | 首页答题逻辑核心，含多模型调度、懒投票、工具循环 |
| `src/services/modelProtocol.ts` | LLM 协议模板生成、URL 拼接、thinking 负载 |
| `src/services/modelConfig.ts` | 模型/平台配置 store，远程同步，增删改查 |
| `src/services/settings.ts` | 应用设置（含 webSearch、answerLazyVote、arbitrationModelId） |
| `src/services/webSearch.ts` | 6 免费搜索引擎 + 工具 schema |
| `src/utils/answerFewShot.ts` | 答题提示词，引导模型调用搜索 |
| `src/utils/questionImage.ts` | 题目图片链接识别与图文分段（答题/题库渲染均依赖）；含远程算法拉取与 `new Function` 编译，见 7.6 |
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
npx vue-tsc --noEmit                 # 类型检查，目标 0 错误（2026-11-04 复核：0 错误）
node tests/webSearch.test.ts         # 搜索单测 9/9 通过（推荐写法：直接把测试文件当入口执行）
node --test tests/webSearch.test.ts  # 常规写法，本地完整权限下同样通过
```
> **受限环境请用第一种写法**：`node --test` 需要 node 再 spawn 一个子进程跑测试文件，在沙箱/受限权限下会直接失败并报 `errno -4048, code EPERM, syscall spawn`（与六、3 提到的 git 误报是两类问题）。直跑单个测试文件可绕开，Node 24 会原生剥离 TS 类型。
> 另：其中两个 `executeWebSearchToolCall` 用例各耗时约 9 秒，是引擎重试退避计时，不是真实网络请求。

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

### 7.6 【高危·未处理】远程下发 JS 源码被 `new Function` 执行

> 2026-11-04 复核发现，**当次决定保持原样、未作改动**。接手前先读这条。

- **现象**：`src/utils/questionImage.ts` 的 `ensureRemoteQuestionImageAlgorithm()` 会调用 `fetchRemoteModelsCatalog()` 拉取 `live/models.json` 的 `question_image_algorithm` 字段（一段完整 JS 源码字符串），交给 `compileQuestionImageAlgorithm()` 用 `new Function('module', 'exports', 'runtime', ...)` 编译，成功后覆盖本地算法（`activeQuestionImageAlgorithm`，且 `remoteQuestionImageAlgorithmLoaded` 置位后本次运行不再更新）。
- **这是原版的"云控热更新"**：改这道逻辑不发版。它解决的问题很实际——OCS/超星题干里的图片 URL 识别有一堆脏规则（URL 相邻需负向前瞻、`.png/.jpg/.jpeg/.gif/.webp/.svg` 后缀截断、中英文标点剥离、不成对 `)]}` 剥离、`mooc*.chaoxing.com/ananas/latex/p/<id>` 深度截断、纯域名无路径过滤）。线上版本明显比仓库里的本地兜底算法（一条正则）成熟。
- **为什么危险**：
  1. 注入的 `runtime` 不是沙箱。`new Function` 作用域内照样能拿 `window` / `fetch` / `import()`，`await import('@tauri-apps/api/core').then(m => m.invoke(...))` 可调用全部 Rust 命令。
  2. 校验只看输出形状。`normalizeCompiledQuestionImageAlgorithm()` 仅检查是否存在 `findQuestionImageMatches` 函数并用一句 preview 试跑要求匹配到内容；**代码在编译那一刻已经执行过了**，校验发生在之后。
  3. 权限面很宽：`capabilities/default.json` 的 `http:default` 放行 `https://**` 与 `http://**`（为 LLM 自定义 Base URL 服务，无法收窄），`fs:allow-write-file` 里含一条 `{"path": "**"}`（读同样覆盖 `$HOME/**` 等）。
  → 结论：`zaizhexue.top` 一旦被接管/入侵，或上游意图变化，所有仍连它的客户端即获得任意代码执行，可读取配置文件中的各家 `apiKey` 并外传、写文件。这条信任链目前握在原作者手里。
- **触发面比想象的大**：`findQuestionImageMatches` / `extractQuestionImageUrls` / `splitQuestionImageParts` 三个导出函数在答题（`Home.vue` 图文 HTML、多模态内容组装）和题库列表/详情渲染（`QuestionList.vue`、`QuestionDetail.vue`）中被常规调用，正常使用必然走到，不是边缘路径。
- **与 fork 立意冲突**：3.8 想做"去外部依赖化"，但 `97f2d21` 只删掉了同一份 JSON 里 `platforms` 字段的消费方，`question_image_algorithm`、`providers_list`、`model_icon_mappings` 三个字段原样保留。
- **附带证据**（说明上游内容质量无人校验）：线上算法里的「关键点：处理粘连字符」分支判断 `match.text`，而本项目 `QuestionImageMatch` 只有 `rawUrl / normalizedUrl / start / end / trailingText`，**没有 `text` 字段**，该分支恒为假、从未生效（结果仍正确，是因为 `trailingText` 已由 `createMatchesFromRegex` 自行算好）。同一份 JSON 的 `platforms` 里连百炼、DeepSeek 都被标成 `apiProtocol: "anthropic"`，正是 7.1 那个坑的源头。
- **若要处理，推荐方案（本次未做）**：把线上那份规则当作**需求规格**，用 TS 按 `QuestionImageMatch` 类型重写进 `questionImage.ts`，然后删除 `new Function` 编译路径、`ensureRemoteQuestionImageAlgorithm()` 及 `fetchRemoteModelsCatalog()` 的引用。三个导出函数签名不变，消费方零改动。
  - 不建议「原样把那段 JS 内联成字符串继续 `new Function`」——机制留着，只是换了数据来源，且把上面那个字段不一致的 bug 永久固化。
  - 不建议 QuickJS-wasm / iframe 沙箱化并保留热更新——本 fork 不需要上游热更，代价大于收益。
  - 落地时注意两点：把模块级 `g` 正则使用前重置 `lastIndex`（异常会残留游标导致漏匹配）；重写后用真实题库文本做新旧算法逐条输出 diff，用"没变差"的实测代替口头保证。

## 八、后续维护建议

1. **联网搜索质量**：引擎可能因反爬失效，关注 `webSearch.ts` 的回退链
2. **外部依赖残留**：平台图标 `providers/*.png` 仍硬编码在 `iconCache.ts` / `ModelSettings.vue`（2026-11-04 决定保留，维持原路径）；`live/models.json` 的其余消费点及处理方案见 7.6。若将来要彻底断链，7.6 末尾已列好做法与验证步骤
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
| `5812be2` | 更新交接文档：补充去外部依赖化、对外接口一览与提交历史 |
| `f2a693f` | 删除 capabilities 残留的 `updater:default` 权限（修复 CI 构建失败） |

> 推送状态：以 `git status` / `git log origin/master..master` 为准（本仓库按六、2 的规则先本地提交，说「上传」才 push）。2026-11-04 复核时 `97f2d21` 之后尚无未推送提交；原「`97f2d21` 已提交本地、尚未推送」一句已过时，故删除。
>
> 另注：`docs/auto-update.md` 讲述 Tauri Updater 发布流程，而本 fork 已在 `97f2d21` 移除 `plugins.updater` 配置与 `tauri-plugin-updater` 依赖，该文只对**原版**适用，勿按其中地址改 `tauri.conf.json`。
