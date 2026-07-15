# 多歌单导入 + 收敛到歌单驱动

日期：2026-07-15
状态：设计已确认，待实现

## 背景

用户反馈「歌单里的达达乐队和琥珀没被分析出来」。排查结论是另一个 bug（`MAX_ARTISTS` 静默截断，已单独修复），但顺带暴露了一个真实需求：一个订阅要能导入多个歌单。

调查发现**后端已经完整支持多歌单导入**：`POST /api/manage/import`（`src/routes/manage.ts`）解析链接后逐个 `INSERT OR IGNORE` 合并进现有列表，天然去重，然后拿新增艺人去匹配已抓到的演出。`test/routes/manage.test.ts:184` 证实同一歌单导两次的 `added` 为 0 且列表不变。

**唯一的缺口是前端没有入口**：`web/src/Manage.tsx` 和 `web/src/api.ts` 里没有任何调用 `/api/manage/import` 的代码。

## 目标

1. 前端接上已有的导入路由，让一个订阅可以陆续导入多个歌单。
2. 去掉手动添加艺人的全部入口，产品收敛为「只走歌单」。
3. 艺人管理保持现状：只支持单个艺人删除。

## 非目标（明确不做）

- **不记录艺人的来源歌单**，不加 `playlists` / `artist_sources` 表，schema 一行不动。
- **不做「按歌单批量删除艺人」**。
- 不做歌单重导时的差异同步（新增/删除）。

### 已知取舍

没有来源记录，导入即单向：歌单 A 带进来 50 位艺人后若要反悔，只能逐个删除，无法「退掉 A 带来的全部」。这是有意识的选择，不是遗漏。若将来要做按歌单删除，需要先补来源记录（当时讨论过的方案：`playlists` 引用表 + `artist_sources(subscription_id, artist_id, playlist_id)` 旁挂表，`subscription_artists` 保持不动）。

## 设计

### 后端

**零改动**，除删除一处死代码：

- `POST /api/manage/artists`（`src/routes/manage.ts:98`）是 manage 页手动添加的后端。UI 去掉后它无人调用，一并删除，连同其测试。
- `POST /api/subscribe` 保留现有的 `artists: string[]` 入参不变——向导提交的是歌单解析出的艺人，不是手动输入。

### 前端

1. **`web/src/api.ts`**：新增 `importPlaylist(link, token, turnstileToken?)`，POST 到 `/api/manage/import?token=...`。走文件里现有的 `json<T>()` 帮手，好让服务端的错误文案（如 502「歌单解析失败」）能抛出来展示。
2. **`web/src/Manage.tsx`**：
   - 新增导入区块：粘歌单链接 → 导入 → 回显「新增 N 位音乐人」→ 用响应里的 `artists` 刷新列表。`/import` 返回 `{ added, artists }`，无需二次请求。
   - **Turnstile**：`/api/manage/import` 在 `PUBLIC_MODE=1` 下要求 `turnstileToken`，而 Manage 页目前**没有**任何 Turnstile（它靠 magic-link token 认证）。导入区块需按 `config.publicMode` 条件渲染 `<Turnstile siteKey={config.turnstileSiteKey} onToken={...} />`，照 `Wizard.tsx:286` 的写法。Manage 已在 `Manage.tsx:69` 取到 `config`，无需新增请求。不补这个，公开模式下导入会稳定 400。
   - 失败按现有错误提示惯例处理：502「歌单解析失败，请稍后重试」直接展示，不静默。
   - 删除「＋ 添加音乐人」按钮及其输入框（`Manage.tsx:290` 一带），保留每个艺人的删除按钮。
   - **空状态与「＋ 添加」磁贴要改，不能只删**：`Manage.tsx:282` 的空状态（「还没有关注的音乐人」）唯一的 CTA 是「＋ 添加音乐人」，艺人墙末尾（`Manage.tsx:326`）还有个「＋ 添加」磁贴。手动添加拆掉后这两处若只删不换会变成死胡同，均改为指向导入歌单。
3. **`web/src/Wizard.tsx`**：
   - 删除第一步的「没有歌单？手动输入音乐人」入口（`Wizard.tsx:107`）。
   - 删除第二步勾选页的 `ManualAdd` 组件定义（`Wizard.tsx:292`）及其用法（`Wizard.tsx:148`）。
4. **`web/src/wizard-state.ts`**：删除 `ADD_MANUAL` action 及其 reducer 分支和相关测试。

## 数据流

```
Manage 页粘链接
  → POST /api/manage/import { link }
  → resolvePlaylist(link)                    // 已有
  → 逐个 upsertArtist + INSERT OR IGNORE     // 已有，天然去重
  → matchArtistsToExistingShows(新增的)      // 已有
  → { added, artists } → 刷新列表
```

多个歌单的艺人去重发生在 `subscription_artists` 的 `(subscription_id, artist_id)` 联合主键 + `artists.normalized_name` 全局唯一这两层，已经是对的，无需新增逻辑。

## 影响与迁移

- **老数据**：现有手动添加的艺人照常留在库里、照常收提醒。去掉的只是「再手动添加」的能力，不清理存量。
- **没歌单的用户进不来**：这是「只走歌单」的直接后果，已确认接受。

## 测试

- `test/routes/manage.test.ts`：
  - 注意 `POST /artists` 目前被当作**测试脚手架**在用，不能直接删了事：`manage.test.ts:148`「add and remove artists」和 `manage.test.ts:158`「adding an artist links it to already-crawled upcoming shows」都靠它造数据，而**单个艺人删除要保留**、必须继续有覆盖。这两个用例改用 `setArtists`/`addArtistToSubscription`（`src/db/subscription-artists.ts`，测试文件已 import 过 `setArtists`）直接建数据，断言不变。
  - 补一个「导入第二个不同歌单 → 两个歌单的艺人合并且去重」的用例（现有 `manage.test.ts:184` 只覆盖了同一歌单导两次）。
- `web/src/wizard-state.test.ts`：删掉 `ADD_MANUAL` 相关用例。
- Manage 页导入交互按 `vitest.web.config.ts`（happy-dom）现有惯例补组件测试。
