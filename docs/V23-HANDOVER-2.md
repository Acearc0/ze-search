# ZError v2.3.0 定制分支交接文档（第二轮）

> 承接 `docs/V23-CUSTOM-CHANGES.md`（第一轮：免费引擎搜索 + 供应商模型拉取）。
> 本文档记录 2026-11-24 ~ 11-26 的迭代：模型管理界面、拉取流程、首字速度、联网通道、窗口记忆、答题质量。
>
> 分支：`v23-custom-search`　仓库：`Acearc0/ze-search`（fork）
> 起点：`e9842e79`（第一轮文档提交）　本轮终点：`3f68f63a`

---

## 一、本轮概览

| 方向 | 解决的问题 | 状态 |
| --- | --- | --- |
| 界面 | 「拉取模型」按钮被 22px 定宽压扁，文字压到分类切换器和加号上 | 已修 |
| 拉取 | 只拉到第一页（服务端把 page_size 截断到 20），模型数量偏少、缺新模型 | 已修 |
| 拉取 | 对话框看不到哪些已添加、没有搜索、被过滤的模型无法核对 | 已做 |
| 首字 | 思考模式占总耗时 60%+，且没有预算上限 | 已修（预算随强度推导） |
| 联网 | bing 302 不跟随 / bing 返回降级垃圾结果 / 回退链空等 191 秒 | 已修 |
| 联网 | 新增百炼内置联网通道（`enable_search` / Responses `web_search`） | 已做 |
| 稳定性 | 工具失败把 `[工具执行失败: ...]` 写进最终答案（污染判分文本） | 已修 |
| 窗口 | 启动固定 `resolve_window_size + center()`，尺寸/位置从不保存 | 已做 |
| 答题 | 多选题漏选、判断题「正确/错误」与选项「对/错」对不上 | 已修 |
| 题库 | 通用题干（「下列说法正确的是」）只比题干就命中，捞出另一道题的答案 | 已修 |
| 界面 | 步骤条固定显示 6 步，没走的步骤也占位 | 已修 |

---

## 二、提交历史

```
3f68f63a feat(ui): 步骤条只显示实际经过的步骤
fcbe790b fix(match): 通用题干必须同时比对选项，避免捞出另一道题的答案
466596ca feat(answer): 判断题答案对齐选项写法（正确/错误 → 对/错）
092bb17a fix(window): 修复 E0382 —— on_window_event 闭包 move 走 app 后又 clone
6d1bfb32 feat(search): GLM/Kimi 选百炼联网时自动切 Responses 协议
71f1fe7b feat(answer): 补多选漏选提示，题型未知时也提醒输出全部正确项
a16d17b2 feat(search): 新增百炼内置联网通道，免费引擎提速，工具失败不再污染答案
7f1140ad perf(search): 失败引擎冷却 + 境外引擎短超时
5926a0d4 feat(window): 记住主窗口尺寸与位置
45e0ba3a fix(models): 思考预算改由思考强度推导
8181b30e perf: 限制思考预算加速首字，并修复免费搜索 302 不跟随
ca3f99c2 feat(models): 拉取结果标注已添加模型，支持搜索与全选
19b2d855 feat(models): 拉取对话框可查看被跳过的模型明细
1729aeb3 fix(models): 拉取模型翻页改用 output.total，修复只拿到第一页
b61ddbe3 fix(ui): 修复模型管理操作区「拉取模型」按钮与分类切换器重叠
```

共 15 个提交，20 个文件，+908 / −124。

---

## 三、逐项说明

### 3.1 模型管理按钮重叠（`b61ddbe3`）

**现象**：截图里「拉取模型」文字压在「答题/总结/Agent」胶囊与「+」按钮上。

**根因**：按钮同时挂了 `.icon-action-btn`（`width:33px`）和 `.icon-action-btn--sm`（`width:22px`），
而 `.fetch-models-btn` 只加了 padding、没覆盖 width。内容（14px 图标 + 5px gap + 4 个汉字 ≈ 67px）
塞进 22px 盒子里横向溢出。

**改动**（`src/views/settings/ModelSettings.css`）：
- `.fetch-models-btn`：`width:auto` + `height:22px` + `padding:0 8px` + `flex-shrink:0`
- `.header-actions`：`align-items:center` + `flex-wrap:wrap` + `justify-content:flex-end` + `min-width:0`
- `.section-header`：`gap:8px`
- `.subsection-title`：`flex-shrink:0; white-space:nowrap`（否则窄面板把「模型管理」挤成两行）

**验证**：用 headless Edge 渲染真实 `<style scoped>` + 组件结构，对比 340px / 240px 两个宽度。

---

### 3.2 拉取模型只拿到第一页（`1729aeb3`）

**现象**：拉取后模型数量明显偏少，缺 Qwen4-Max 等新模型。

**根因**：翻页终止条件是 `if (raw.length < 100) break`。百炼文档写明 `page_size` **默认 20**、
要求用 `output.total` 判断是否读完。服务端把 100 截断成 20 后，第一页就满足 `< 100` → 直接停。

**改动**（`src/services/model/fetchModels.ts`）：
- 终止条件改为 `pageNo * perPage >= total`（`perPage` 取响应里的 `output.page_size`）
- `page_size=100` 被 400/413/422 拒绝时，自动降到 20 重试本页（`MIN_PAGE_SIZE`）
- 服务端忽略 `page_no`（每页同一批）时检测无新增并停止
- 翻页上限 10 → 50

**验证**：假服务端两种行为（截断 20 / 严格 400），旧逻辑 1 页 20 个，新逻辑 19 页拉全 373 个并含 `qwen4-max`。

---

### 3.3 拉取对话框（`19b2d855`、`ca3f99c2`）

- **被跳过的模型明细**：`FetchModelsResult.skipped` 记录 `{id, capabilities}`，对话框折叠展示，
  用于区分「服务端没返回」与「被能力标签过滤」。
- **已添加标记**：`FetchedModelRow.existing`，列表展示全部拉取结果，已添加的显示绿色实心 `✓` +
  「已添加」且不可重复勾选（原生 disabled checkbox 在部分主题下发灰，看不出勾）。
- **搜索 + 计数 + 全选**：标题行 `已添加 X · 新增 Y`，右侧搜索框，全选只作用于当前搜索结果里的新增项。
- **修掉一个既有 bug**：原来只在 `visible` 变 true 时初始化勾选，而拉取是异步的 —— 那一刻数据还是空，
  导致新增模型默认全不勾。现在加了 `fetched` 的 watch。

`normalizeKey`（去 `cmaas-` 前缀 + 小写）从 `fetchModels.ts` 导出，供 diff 与对话框共用。

---

### 3.4 首字慢 → 思考预算（`8181b30e`、`45e0ba3a`）

**依据**：百炼文档明确「思考模式实测约占总耗时 60%+，关闭可降 60~75%」；Qwen3.8/Qwen4 默认开启思考。

**实现**：
- 新增 `AIModel.thinkingBudget`（`configTypes.ts`）
- `normalizeThinkingOptions` 输出 `budget`；`providers.ts` 与 `protocol.ts` 两条构包路径在
  `ENABLE_THINKING` 时注入 `payload.thinking_budget`
- **只对 qwen3.5+ / qwen4 注入**（其余模型传了会 400）

**关键设计（第二版修正）**：第一版把预算写死 1024，等于架空 `reasoning_effort`（预算是硬上限、优先级更高，
选 high/max 也会被截断）。现改为**强度驱动预算**：

| 思考强度 | thinking_budget |
| --- | --- |
| low | 512 |
| medium（默认） | 1024 |
| high | 4096 |
| max | 不传（不限） |

`thinkingBudget` 降级为显式覆盖项（`0` = 强制不限）。

**验证**：8 个用例实测请求体（含 max+2048 覆盖、qwen3-max/deepseek 不注入）。

---

### 3.5 免费搜索（`8181b30e`、`7f1140ad`、`a16d17b2`）

三个独立问题叠在一起：

1. **302 不跟随**：`secureFetch` 走 Rust 通道，而 Rust 侧是 `redirect::Policy::none()`
   （`secret_http.rs:127`）。bing 在国内基本先 302 到 `cn.bing.com`，前端 `redirect:'follow'` 被忽略 →
   `response.ok=false` → 引擎判失败。改为前端手动跟随 301/302/303/307/308，最多 3 跳。
2. **bing 返回降级垃圾**：实测三种参数都返回「人工（汉语词汇）_百度百科」这类词典页。
   原来的相关性判定只要求命中任意 1-2 字 token，「人工」就能过 → 垃圾会喂给模型。
   改为 `queryCoreToken`：取查询第一个中文片段（「人工智能」）要求**整词命中**。
3. **回退链空等 191 秒**：ddg/ddg-lite 国内完全连不上（实测 10s 超时）。单个测试连接实测 191s 后
   才由 anysearch 成功。改动：
   - 回退链顺序 `bing → anysearch → ddg → ddg-lite → searxng → tavily`（anysearch 实测 1.8s 且结果质量好）
   - 境外引擎超时压到 6s
   - 失败引擎冷却：境外 10 分钟、bing 60 秒（0 结果不冷却）
   - 单次搜索总预算 15s
   - 设置里的「测试连接」传 `ignoreCooldown`，保证是真实探测

**实测**：`人工智能 最新进展 中文` → 1945ms 走 anysearch；`电容 单位` → 215ms 走 bing。

---

### 3.6 工具失败污染答案（`a16d17b2`）

**现象**：答案里出现 `[工具执行失败: Error: signal is aborted without reason]`。

**根因**：`invoke.ts` 的工具 catch 分支把错误文本拼进 `fullResponse` —— 而 `fullResponse` 就是最终答案、
也是判分文本。这跟同段代码上方「不把工具结果拼进 fullResponse」的注释直接矛盾。

**改动**：
- 工具失败/超时**只回传给模型**（`role:'tool'` 消息），不再写进答案
- 只有「整个请求被取消/超时」才向上抛（`isRequestCancelled || abortController.signal.aborted`）
- **工具执行前重置模型超时**（`armTimeout()`）：搜索耗时不挤占模型那 40 秒预算
- `shouldSkipModelRetry` 对 abort/超时返回 true —— 超时后不再重试一轮
- `fetchRaw` 的 abort 带 reason，错误信息从「signal is aborted without reason」变成「请求超时（15 秒）」

---

### 3.7 百炼内置联网通道（`a16d17b2`、`6d1bfb32`）

**依据**：[百炼联网搜索文档](https://help.aliyun.com/zh/model-studio/web-search)
- Chat Completions：body 顶层 `enable_search: true`
- Responses：`tools: [{type:"web_search"}]`

**实现**：
- `searchProviders.ts` 新增 `bailian`（免 Key，复用模型平台 Key；右键菜单不显示「配置 API Key」）
- 选中后：**跳过预搜**（`search.ts`）、**不注入 free 搜索工具**、请求带联网参数
- 白名单**分协议**：

| 协议 | 支持的模型 |
| --- | --- |
| Chat（`enable_search`） | qwen-max/plus/flash、qwen3.5~3.8、qwen4、deepseek-v4 系列 |
| Responses（`web_search`） | 上述全部 + glm-5.2、kimi-k3、kimi-k3.1-pro、Omni 系列 |

GLM 5.2 / Kimi 在 Chat 协议下不认 `enable_search`，只在 Responses 下能挂 `web_search`。

- **自动切换协议**：`resolveEffectiveSearchProtocol` —— 仅当「Chat 不支持 + Responses 支持 + 当前是 chat」时，
  临时构造 model/platform 副本按 Responses 发请求，**不改用户保存的配置**；anthropic/custom 不动。

**踩坑**：项目里协议枚举是 `'openai-response'`（单数），第一版写成 `'openai-responses'`，
导致 Responses 白名单永不命中 —— 正是「手动改成 responses 也不生效」的原因。

**验证**：9 项 payload 测试（URL、`enable_search`、`web_search` 工具、流式解析、未开联网不注入、消息格式）。

---

### 3.8 窗口尺寸记忆（`5926a0d4`、`092bb17a`）

**为什么不用官方插件**：`tauri-plugin-window-state` 是标准解，但
1. 本机没有 cargo，加依赖无法更新 `Cargo.lock`；
2. CI 用 `-- --locked` 构建，lock 不匹配会直接失败。

所以自研（零新依赖，`window_size.rs` ~170 行）：
- 存储：`%APPDATA%\com.zerror.search\window-state.json`，字段 `{width,height,x,y,maximized}`（逻辑像素）
- 写入：`Resized`/`Moved` 打脏标记，后台线程 900ms 节流落盘；`CloseRequested` 立即写一次
- 恢复：有记录用记录尺寸+位置（不居中）；尺寸裁进当前屏幕工作区；位置不在任何显示器内则回退居中
- 最大化时不覆盖保存的正常尺寸；上次最大化则启动后 `maximize()`
- 删掉该 json 即恢复出厂布局（也是重置手段）

**E0382 踩坑**：`on_window_event(move |..|)` 把 `app` move 进闭包后，后面给写盘线程的
`app.clone()` 就成了 use of moved value。修法：先克隆 `event_app` 给闭包，`app` 留给线程。

---

### 3.9 多选题漏选（`71f1fe7b`）

**数据**：本机 41 道多选题，40 道答案用了 `###` 连接多个，只有 1 道答单（nmap 题，标准答案可能就是单个）。
所以不是系统性问题，但确实存在漏选风险。

**代码问题**：题型是**条件拼接**的 —— 客户端没传 `type` 字段时，prompt 里完全不提题型，
模型只能靠题干猜。而规则第 4 条只写了「选择题必须与选项文字一致」，没有一条说多选要输出多个。
前端 `GENERAL_SHOTS` 也只有单选 + 判断两个示例。

**改动**：
- Rust 通用规则加第 6 条：多选必须用 `###` 连接全部正确项，题干出现「包括/有哪些/下列…的有」时检查漏选
- 前端 `SYSTEM_RULES` 加同义规则
- `GENERAL_SHOTS` 补一个多选示例
- `detectAnswerFewShotKind` 增加题干强信号兜底（多选/多项选择/选出所有/以下哪些/全部正确）

---

### 3.10 判断题答案对不上（`466596ca`）

**数据**：251 条记录里 20 条答案与选项不匹配，**全部是判断题**：

```
answer: "正确"
options: ["对", "错"]
```

模型按规则答「正确/错误」，题库选项写「对/错」，字面不一致 → 判分失败。

**改动**：
- `answerNormalize.ts` 新增 `mapJudgeAnswerToOptions`：答案属判断词时映射成选项原文
  （正确处理 `A. 对 / B. 错` 这种带前缀的选项）
- 选项本来就是「正确/错误」时不动
- Rust prompt 与前端 few-shot 改为「必须与【选项】里的判断词一致」

**验证**：12 个用例（含 JSON 包装 `{"answer":"正确"} → {"answer":"对"}`）。

---

### 3.11 通用题干误匹配（`fcbe790b`）

**现象**：题干「下列说法正确的是：」匹配到一道 CSRF 题，返回的却是另一道 XSS 题的答案
（题库客户端提示「给出的答案和选项不匹配」）。

**根因**：`score_question_row` 的判定是

```rust
if !is_exact_title_match && (require_option_match || has_query_options) && option_similarity.is_none() {
    return None;
}
```

**题干精确匹配时选项检查被整个跳过**。「下列说法正确的是」这类通用句式在题库里常有多道
同题干不同选项的题，于是命中了错误的那道。

**改动**（`database/questions.rs`）：通用题干（`is_generic_choice_title`）强制要求选项相似度 ≥ 0.5，
即使题干完全一致；对不上就按未命中处理、交给 AI。

**行为变更**：这类题现在宁愿走 AI 也不复用可疑缓存（慢一点，但答案对得上选项）。
阈值在 `score_question_row` 里的 `MIN_GENERIC_OPTION_SIMILARITY`，可按需调整。

---

### 3.12 步骤条（`3f68f63a`）

**现象**：没配总结模型也显示「总结」，点进去是「暂无总结模型记录」。

**改动**（`HomeRequestDetails.vue`）：
- `processSteps` 末尾 `.filter(step => step.state !== 'skipped')`
- 本地搜索在请求结束后无记录时按 `skipped` 处理（原来残留 `idle`）
- 选中步骤被过滤时自动回退到第一个可用步骤

进行中的请求仍显示灰色 `idle` 后续步骤（让人知道流程没走完）。

---

## 四、关键设计决策

| 决策 | 原因 |
| --- | --- |
| 窗口记忆自研而非官方插件 | 本机无 cargo + CI `--locked`，加依赖会让构建失败 |
| 思考预算由强度推导 | 预算优先级高于 `reasoning_effort`，写死会架空强度设置 |
| 百炼联网白名单分协议 | GLM/Kimi 在 Chat 下不支持 `enable_search`，传了无效或 400 |
| 自动切换协议而非要求用户改配置 | 用户体验；且只在一侧不支持时临时切换，不改保存值 |
| 工具失败不写进答案 | `fullResponse` 就是判分文本，混入错误文本会直接导致判分失败 |
| 通用题干要求选项相似度 | 题库存在同题干不同选项的题，只比题干必然误命中 |

---

## 五、可复用的验证手段

### 5.1 前端行为验证（无需真实 API）

项目依赖里有 esbuild，可以在 `.tmp-verify/` 下打包单个模块 + 用假 fetch 捕获请求体：

```js
// build.mjs
import { build } from 'esbuild'
await build({
  entryPoints: ['../src/services/model/providers.ts'],
  bundle: true, platform: 'node', format: 'esm',
  outfile: './providers.bundle.mjs', logLevel: 'warning'
})
```

对需要 Tauri 的模块（`secureFetch`），用 esbuild plugin 把它换成从 `globalThis` 读的桩：

```js
const mockSecureFetch = {
  name: 'mock-secure-fetch',
  setup(b) {
    b.onResolve({ filter: /[\\/]security[\\/]secureFetch$/ }, () => ({ path: 'mock', namespace: 'mock' }))
    b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
      contents: 'export const secureFetch = (...args) => globalThis.__mockFetch(...args)',
      loader: 'js'
    }))
  }
}
```

注意：`vi.mock`/vitest 在本仓库**没有安装**，只能走 esbuild。

### 5.2 真实网络探测

```powershell
# bing 在无 cookie 时会降级返回词典页；ddg 在国内直接超时
node -e "fetch('https://www.bing.com/search?q=test',{redirect:'manual'}).then(r=>console.log(r.status,r.headers.get('location')))"
```

### 5.3 本地题库数据分析

数据在 `%LOCALAPPDATA%\ZErrorSearch\airesponses.db`（SQLite，表 `AIResponses`）：

```python
import sqlite3
con = sqlite3.connect(r"C:\Users\e\AppData\Local\ZErrorSearch\airesponses.db")
# QuestionType 分布 / 答案与选项是否匹配 / 选项是否带 A. 前缀
```

本轮据此确认了两件事：**选项 251/251 都没有字母前缀**、**判断题选项写「对/错」**。

### 5.4 类型检查基线

`vue-tsc --noEmit` 在本机（`node_modules` 是指向 `D:\ai-course\ZError` 的 junction）
有 **47 个既有缺包错误**（`@iconify/vue/offline`、`highlight.js/lib/*`、`markstream-vue` 等）。
判断标准是「改动文件是否新增错误」，不是错误总数。

```powershell
cd D:\ai-course\ZError-2.3.0
node .\node_modules\vue-tsc\bin\vue-tsc.js --noEmit
```

### 5.5 无法本地验证的部分

- **Rust 编译**：本机没有 cargo，所有 `.rs` 改动只能靠 CI（本轮已因 E0382 失败过一次）
- **真实 API**：没有 API Key，`enable_search` / `web_search` 实际返回只能装机验证
- **打包体积**：NSIS 压缩方式改动未验证

---

## 六、已知问题与待验证

| 项目 | 状态 |
| --- | --- |
| 真实 Key 验证 `enable_search` | **未验证**（qwen4-max 是否接受该参数需实测） |
| GLM 5.2 / Kimi 自动切 Responses | **未验证**（文档说支持，实际未打接口） |
| 窗口记忆实际效果 | **未验证**（需装机：改大小→关闭→重开） |
| 通用题干选项阈值 0.5 | 可能误伤「选项只是写法差异」的题，需按实际调整 |
| 历史数据里的判断题答案 | 那 20 条已存成「正确」，本次修复只对新答题生效 |
| 多显示器拔插 | 位置回退逻辑已写，未实测 |
| Rust 侧判断题映射 | 只在前端做了归一化；若某条链路绕过前端，可能仍是「正确」 |

---

## 七、构建与推送

```bash
cd D:\ai-course\ZError-2.3.0
npm run build          # vue-tsc --noEmit && vite build（本机因缺包会失败，以 CI 为准）
node scripts/tauri-cli.mjs build --ci --target x86_64-pc-windows-msvc --bundles nsis -- --locked
```

推送只推 fork，**不要碰 origin（Miaozeqiu/ZError）**：

```bash
git push fork HEAD:refs/heads/v23-custom-search
```

CI 产物：`https://github.com/Acearc0/ze-search/actions`（本机 `github.com` 解析被拦，查不了状态）。

---

## 八、下一步建议

1. **把 `enable_search` 实测一遍**：拿真实 Key 打一次 qwen4-max，确认参数被接受；若 400，
   在 `resolveBailianSearchEnabled` 里收紧白名单或改走 Responses。
2. **通用题干阈值**：收集被误伤的样本（原本能命中但现在走 AI 的），必要时下调 0.5。
3. **历史判断题答案批修**：写脚本把 `Answer in ('正确','错误')` 且 `Options` 含「对/错」的记录改成「对/错」。
4. **多模型等最慢的那个**：`Promise.allSettled` 会等全部答题模型，可考虑「多数票确定后提前收尾」。
5. **流式渲染节流**：每个 SSE chunk 都直接写响应式数据，12 路并发时 UI 会卡，可加 80~100ms 合并。