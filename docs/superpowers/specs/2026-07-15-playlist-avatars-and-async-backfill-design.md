# 歌单头像提取 + manage 后台回填

日期：2026-07-15
状态：已批准（用户在会话中确认「按完整方案做」）

## 问题

1. `GET /api/manage` 首屏 TTFB 实测 1.7–2.4s。响应体只有 ~35KB（283 位艺人），传输 ~30ms——瓶颈不在数据量，而在服务端返回前同步 `await backfillAvatars()`：最多 15 次秀动搜索（单次超时 4s）。只要还有未回填头像的艺人，每次加载都付这笔钱；若秀动限流导致搜索持续失败，接口会长期卡在超时上。
2. 头像来源单一且有损：秀动搜不到的艺人永远没头像（线上 283 位中 164 位无头像）。而歌单侧其实都有头像：
   - QQ：`CgiGetDiss` 的 `singer[].mid` 可直接拼 `https://y.qq.com/music/photo_new/T001R300x300M000{mid}.jpg`（实测 200 image/jpeg），零额外请求。
   - 网易：歌曲接口 `ar` 只有 `{id, name}`，但 `POST /api/artist/head/info/get?id={id}` 按 ID 精确返回 `avatar`（实测成功；返回的是 `http://` URL，需重写为 `https://` 避免混合内容）。
3. 现有流程重复劳动：wizard 预览时已按名字搜过一遍秀动头像（上限 30 次），订阅时只传名字、头像丢弃；manage 页再搜一遍回填。

## 方案

### 数据流

```
QQ:     singer[].mid ──拼URL──▶ song.artists[].avatar ─┐
                                                        ├─▶ tally ─▶ resolve 响应（wizard 预览）
netease: ar[].id ──▶ song.artists[].sourceId ─┐         │
                        （resolve 时按 ID 查头像，上限 30，4s 超时）
                                                        └─▶ /api/manage/import ─▶ upsertArtist(name, avatar)
                                                             （新行带头像；旧行 avatar 为 null/"" 时补上 → 重导入即修复存量）
manage GET: 响应立即返回 DB 现状；秀动回填移入 ctx.waitUntil（兜底：老数据 / 歌单侧拿不到头像的艺人）
```

### 改动点

- `lib/sources/qq.ts`：`QqSong.artists` 由 `string[]` 改为 `{ name, avatar? }[]`；`transformQqDetail` 从 `singer[].mid` 拼头像 URL（无 mid 则 avatar 缺省）。
- `lib/adapters/types.ts`：`ResolvedSong.artists` 改为 `{ name, avatar?, sourceId? }[]`；`ArtistTally` 增加 `sourceId?`。
- `lib/adapters/netease`：`parseSongDetail` 捕获 `ar[].id` 为 `sourceId`；client 新增 `fetchArtistHeadRaw(id)`；新增解析函数取 `data.artist.avatar || cover`，`http://` → `https://`。
- `lib/adapters/tally.ts`：按归一化名聚合时，首个非空 `avatar` / `sourceId` 胜出。
- `src/services/resolve.ts`：删除秀动搜索。QQ 天然带头像；网易对缺头像的前 `AVATAR_LOOKUP_LIMIT=30` 个 tally 按 `sourceId` 查头像，单个 4s 超时兜底 null（请求预算与原秀动搜索一致，仍在 50 subrequest 限制内）。
- `src/db/artists.ts`：`upsertArtist(db, name, avatar?)`——插入时写入 avatar；行已存在且 `avatar IS NULL OR avatar=''` 且新头像非空时 UPDATE。`addArtistReturningInserted` 透传 avatar。
- `src/routes/manage.ts`
  - `POST /import`：把 `resolved.artists[].avatar` 传入落库（修复存量：重导入同一歌单时 dupe 路径也会走 upsert 补头像）。
  - `GET /`：先对响应用的 artists 做原始值快照，再 `c.executionCtx.waitUntil(backfillAvatars(...))`，立即返回。秀动回填语义不变（null=未搜索，""=搜过无果，URL=命中），只是不再阻塞响应。
- `src/routes/subscribe.ts`：**不改**。artists 表按归一化名全局共享，若接受浏览器端上传的头像 URL，恶意订阅者可以篡改任意公共艺人的头像；wizard 路径的艺人靠 manage 后台兜底回填或后续任意导入补齐。

### 测试

- 单元：qq transform 出头像；netease 捕获 sourceId、head-info 解析与 https 重写；tally 聚合优先级；upsertArtist 落库/修复语义。
- 路由：resolve 不再触碰秀动、QQ 头像直出、网易按 ID 查；import 落库与重导入修复；manage GET 用 `createExecutionContext`/`waitOnExecutionContext`（`cloudflare:test`）断言「响应先回、回填后至」，超时/出错仍保持 null 不缓存为 ""。

### 不做

- artists 分页/滚动加载：35KB 响应与 283 个瓦片渲染均非瓶颈。
- 前端改动：`ArtistAvatar` 已有占位与 `loading="lazy"`；wizard 已渲染 `avatar` 字段。
