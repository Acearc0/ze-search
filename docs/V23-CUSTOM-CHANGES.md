# ZError v2.3.0 定制分支交接文档

> 记录本分支相对官方 v2.3.0 的全部改动、设计取舍、踩过的坑与验证方式。
> 分支：`v23-custom-search`　仓库：`Acearc0/ze-search`（fork）
> 基线：官方 `Miaozeqiu/ZError` tag `v2.3.0`（commit `5a74092`）

---

## 一、这份代码是什么

官方 v2.3.0 的定制分支，新增两项能力并做了若干 UI/CI 调整：

| 能力 | 状态 |
| --- | --- |
| 免费引擎联网搜索（免 Key，模型 function call 按需触发） | 已实现，构建通过 |
| 从供应商 API 拉取模型（百炼 capabilities + 兼容回退） | 已实现，构建通过 |
| 多模态模型双标签、视觉开关可改 | 已实现 |
| 独立应用标识（ZError Search，不覆盖官方 ZError） | 已实现 |
| CI 仅构建 Windows | 已实现 |

**与官方 v2.3.0 的根本区别**：官方搜索是「答题前预搜 + 拼进 prompt」，本分支改为
「模型通过 `web_search` function call 按需搜索」，与后续 ZError Search（fork 2.2.7）
的行为一致。

---

## 二、提交历史

```
919e284d feat(models): 从阿里云分页拉全模型，答题上限 6→12
4e04a21d fix(ui): 模型标签统一靠右对齐，拉取对话框也显示文本+视觉双标签
eab06578 feat(models): 多模态模型可同时标为文本+视觉，视觉开关不再被远程锁定
e14ae6ee fix(models): 用 URL.origin 推导原生端点，修 /apps/anthropic 下的 404
a9be299f fix: 修正模型拉取 404，并允许删除默认自带模型
8893d14e feat(brand): 改为 ZError Search 独立应用，不覆盖官方 ZError
a9db21d6 ci: 精简构建流程，只出 Windows 安装包
7f061f9c ci: 只保留 Windows 构建，移除 macOS 与 Linux job
03dda4c7 ci: 让 v23-custom-search 分支自动构建 Windows 安装包
e00c831d ZError v2.3.0 + 免费引擎搜索 + 供应商模型拉取
```

**注意**：本分支是 **orphan 快照**（`e00c831d` 无父提交）。
原因见 §五「浅克隆推送失败」。因此 `git log` 看不到 v2.3.0 之前的官方历史，
需要一个完整历史时请从官方仓库重新 clone 后 `git apply` 本分支的 diff。

---

## 三、功能改动详解

### 3.1 免费引擎联网搜索

| 文件 | 作用 |
| --- | --- |
| `src/services/freeWebSearch.ts`（新增 523 行） | 六引擎（bing/ddg/ddg-lite/searxng/anysearch/tavily-keyless）、回退链、`WEB_SEARCH_TOOL` schema、结果格式化 |
| `src/services/questionServer/invoke.ts` | 注入工具、接上执行器、工具结果不入答案 |
| `src/services/questionServer/search.ts` | `provider='free'` 时跳过官方预搜，避免搜两遍 |
| `src/services/searchProviders.ts` | 新增 `free` provider（无 API Key） |

**关键设计**：
- 网络请求走官方的 `security/secureFetch`（不是 `@tauri-apps/plugin-http`），
  与 `searchService.ts` 同一通道，统一凭据与取消语义。
- 工具结果**只回传给模型**，不拼进 `fullResponse`——`fullResponse` 是最终答案，
  混入搜索原文会污染判分文本。
- 循环上限 4 轮，防模型反复调工具死循环。
- `provider='free'` 时 `runSearchForRequest` 直接返回 `null`，官方预搜不执行。

### 3.2 从供应商 API 拉取模型

| 文件 | 作用 |
| --- | --- |
| `src/services/model/fetchModels.ts`（新增 223 行） | 拉取逻辑：原生端点分页 + 兼容回退 + diff |
| `src/views/settings/ModelSettings/useFetchModels.ts`（新增） | 编排：读 Key → 拉取 → 算 diff → 写入平台 |
| `src/views/settings/ModelSettings/FetchModelsDialog.vue`（新增） | diff 对话框 |
| `src/views/settings/ModelSettings.vue` | 「拉取模型」按钮 + 对话框挂载 |

**URL 推导（踩坑重点）**：
```
base 可能是：
  .../compatible-mode           （OpenAI 兼容）
  .../compatible-mode/v1
  .../apps/anthropic            （Anthropic 兼容）← 用户实际使用的
原生端点固定取 new URL(base).origin：
  {origin}/api/v1/models?page_no=N&page_size=100
兼容端点相对 base：
  已含 /v1 → {base}/models
  否则     → {base}/v1/models, {base}/models
```
**不要**用「去掉尾部路径」的方式推导主机根——早期版本这样写，
遇到 `/apps/anthropic` 会拼成 `/apps/anthropic/api/v1/models`（404）。

**实测状态码**（假 Key 探测，401=路径在、404=路径不存在）：
```
{origin}/api/v1/models                → 401  ✓
{origin}/compatible-mode/v1/models    → 401  ✓
{origin}/compatible-mode/models       → 404  ✗
```

**分页**：百炼账号常有 300+ 模型，单页 100 且不翻页会「能拉但数量偏少」。
现按 `page_no` 翻页（每页 100，最多 10 页），按 id 去重。

**能力过滤**：只保留可对话模型（`TG`/`VU`/`Reasoning`/`Omni`），
排除 `IG`（文生图）、`TTS`、`ASR`、`TR`（向量/排序）。

### 3.3 模型数量与上限

- **远程目录只下发 25 个模型**（`open.zerrorai.com/v1/config/models`，百炼仅 8 个），
  这是「模型数量不够」的根源，不是 bug。其余需通过「拉取模型」自行获取。
- `MAX_ANSWER_MODELS` 6 → 12（`src/services/model/configTypes.ts`）。

### 3.4 多模态模型：双标签与视觉开关

| 问题 | 根因 | 修复 |
| --- | --- | --- |
| 视觉开关永远是灰的 | `ModelConfigDialog.vue` 有 `:disabled="isRemote"`，而同步下来的模型全是 `isRemote=true` | 取消禁用 |
| 改了开关下次同步又变回去 | `configRemoteSync.ts` 无条件用远程 `hasVision` 覆盖 | 本机已设置的优先保留（与 `enableThinking` 同策略） |
| 只显示一个标签 | 模板只有 `v-if="modelHasVision"` 的「视觉」 | 固定显示「文本」，有视觉能力追加「视觉」 |

**重要概念**：v2.3 **没有独立的视觉模型选择项**。
`getSelectedVisionModel()` 的实现是「从答题模型列表里挑第一个 `hasVision` 的模型」。
所以「既能答文本又能识图」= 勾上视觉能力 + 选进答题列表，不需要在两处分别选。

### 3.5 默认自带模型可删除

官方有双重拦截（`platform.ts` 的 `!isRemote` 判断、`ModelContextMenu.vue` 的条件渲染），
且 `deletedPredefinedModels` 字段**定义了却从未被使用**。现已接上：

- `removeModel` 删除 `isRemote` 模型时记入 `deletedPredefinedModels`
- `configRemoteSync` 下发前按该名单过滤 → 删了不会「回来」
- UI 取消 `isRemote` 删除拦截

### 3.6 品牌隔离

`src-tauri/tauri.conf.json`：

| 字段 | 官方 | 本分支 |
| --- | --- | --- |
| productName | ZError | **ZError Search** |
| identifier | com.zerror.app | **com.zerror.search** |

装上去是独立应用，不覆盖官方 ZError；identifier 与既有 fork（2.2.7）一致，
沿用原有模型配置与题库数据。

### 3.7 CI 精简

`.github/workflows/build-desktop.yml` 278 → 59 行：

- 删除 macOS / Linux job
- 删除 native regression / 实机安装 / 桌面功能回归（官方发布验证，最耗时）
- NSIS 压缩 lzma → zlib（默认 lzma 最慢档，代价是包大约 30-50%）
- `rust-cache` 加 `cache-on-failure`
- 触发分支加 `v23-custom-search` 并移除 `paths` 白名单

**实测耗时**：首次 15 分钟（其中 Rust 编译 13.2 分钟，无缓存）；
有缓存后应明显更快。产物 24.77 MB。

---

## 四、验证方式

### 4.1 类型检查（依赖装不上时的替代方案）

`npm ci` 在部分网络下会卡死（无输出、目录不增长）。此时可复用已有依赖：

```powershell
cd D:\ai-course\ZError-2.3.0
# 中断安装残留先清理
if (Test-Path node_modules) { cmd /c rmdir node_modules }
# 用另一份已装好的 node_modules（vue/ts/vite 版本需一致）
cmd /c mklink /J "D:\ai-course\ZError-2.3.0\node_modules" "D:\ai-course\ZError\node_modules"
npx vue-tsc --noEmit
```

**结果判读**：本分支已确认存在 47 个错误，全部是
`Cannot find module`（官方特有的 `markstream-vue`、`katex`、`@iconify`、
`@blobatar/vue` 等 fork 没有的包）。**排除这些后应为 0 错误**。

### 4.2 快速语法验证

```powershell
# 单文件打包（能发现语法与内部导入错误，但外部依赖需 stub）
node -e "require('esbuild').build({entryPoints:['src/services/model/fetchModels.ts'],bundle:true,write:false,format:'esm',platform:'node'})"
```

注意：esbuild 会 stub 掉外部模块，**路径写错不会暴露**（例如
`'../security/secureFetch'` 与 `'./security/secureFetch'` 的区别）。
所以 esbuild 通过 ≠ 类型正确，务必再跑 `vue-tsc`。

### 4.3 构建产物

推送到 `v23-custom-search` 自动触发构建：
`https://github.com/Acearc0/ze-search/actions`

产物名：`ZError-windows-x64-<run_id>` → 内含 NSIS `.exe`。

---

## 五、踩坑记录

### 5.1 浅克隆推不上去

v2.3.0 是 `--depth 1` 克隆的，根提交仍记录父提交 `9917b36b`。
推送到新远端时服务端会校验父对象存在性：

```
remote: fatal: did not receive expected object 9917b36b...
error: remote unpack failed: index-pack failed
```

`git fetch --unshallow` 可解，但网络不稳时反复失败。
最终用 **orphan 分支**绕过：`git checkout --orphan v23-custom-search`
（新提交无父提交，不依赖任何历史对象），几十秒推完。

### 5.2 误提交 node_modules

中间备份中断安装目录为 `node_modules_partial`，而 `.gitignore` 只忽略
`node_modules`，导致一次提交带上 20646 个文件。已移除并在 `.gitignore` 补上。

### 5.3 路径层级错误（两个）

`ModelSettings/` 子目录下的文件到 `src/services/` 需要 **三层** `../`：
```
src/views/settings/ModelSettings/xxx.ts  →  '../../../services/...'
src/services/xxx.ts                      →  './security/secureFetch'
```
这两处最初都写少了一层，`vue-tsc` 才暴露。

### 5.4 修改前先确认是否死代码

曾计划删除「登录」与「校园题库」，`grep` 显示 `LoginDialog` / `AgentLoginForm`
零引用，于是误判 `auth.ts` / `chatLogin.ts` 也是死代码并删除。
实际它们被 Agent 的网站登录、用户态显示深度使用（8 处），删完全库报错。
**结论**：删除前必须查完整引用链，且 `vue-tsc` 是唯一可靠验证。

---

## 六、已知限制与待验证项

| 项目 | 状态 |
| --- | --- |
| 真实 Key 拉取模型 | **未验证**。本机 `model_config.json` 已丢失，只能用假 Key 探测路径存在性。实际能拉到多少个待实测 |
| 免费引擎搜索 | 已端到端验证（bing 返回 5 条真实结果），但仅在 Node 环境，Tauri 内未跑 |
| NSIS zlib 压缩 | 未验证包体积与安装是否正常 |
| 官方测试套件 | **未运行**。`npm test` 需要完整依赖 |
| Rust 编译 | CI 已验证通过（构建成功） |

### 装包后建议验证

1. 设置 → 模型服务 → 阿里云百炼 → 「拉取模型」→ 应列出上百个模型（非 404）
2. 右键自带模型 → 删除 → 重启后不应复活
3. 多模态模型（如 Qwen3.8 Max）→ 编辑 → 打开视觉能力 → 列表应同时显示「文本」「视觉」
4. 设置 → 联网搜索 → 选「免费引擎（免 Key）」→ 答一道时效题 → 看结果卡片有无回退提示

---

## 七、如何构建

```bash
cd D:\ai-course\ZError-2.3.0
npm ci                                    # 必须先装依赖
npm run build                             # vue-tsc + vite build
node scripts/tauri-cli.mjs build --ci --target x86_64-pc-windows-msvc --bundles nsis -- --locked
```

产物：`src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*.exe`

---

## 八、相关文档

官方 `docs/` 目录下的这些与本分支改动相关：

- `remote-models-has-vision.md` — 远程模型的视觉能力下发规则（本分支已改为本地优先）
- `build-compatibility.md` — 构建环境要求
- `release-testing.md` — 官方发布回归流程（本分支 CI 已移除这些步骤）