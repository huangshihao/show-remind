# 多歌单导入 + 收敛到歌单驱动 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让一个订阅能在 manage 页陆续导入多个歌单（艺人自动合并去重），同时拆掉手动添加艺人的全部入口。

**Architecture:** 后端 `POST /api/manage/import` 已具备全部语义（解析 → `INSERT OR IGNORE` 合并 → 匹配已有演出），本计划只把前端入口接上，并删除手动添加相关的 UI、状态与死路由。schema 不动，来源歌单不记录。

**Tech Stack:** Hono (Cloudflare Workers) + React 19 + Vite；测试用 vitest（服务端跑 `@cloudflare/vitest-pool-workers`，前端跑 happy-dom）。

## Global Constraints

- **schema 一行不改**，不新增 `playlists` / `artist_sources` 表，不记录艺人来源歌单。
- **保留**单个艺人删除（`DELETE /api/manage/artists/:artistId` 与艺人磁贴上的 `×`）。
- 服务端两条测试命令都要过：`npx vitest run --config vitest.config.mts`（server/lib）与 `npx vitest run --config vitest.web.config.ts`（web）。`npm test` 依次跑两者。
- UI 文案用中文，跟现有文案风格一致。
- 前端 API 调用统一走 `web/src/api.ts` 的 `json<T>()` 帮手，以便服务端错误文案能展示出来。
- 参考 spec：`docs/superpowers/specs/2026-07-15-multi-playlist-import-design.md`

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `web/src/api.ts` | 前端 API 调用层 | 新增 `importPlaylist()` |
| `web/src/Manage.tsx` | 管理页：艺人墙、城市、演出 | 新增导入区块；删除手动添加；改空状态与「＋添加」磁贴 |
| `web/src/Wizard.tsx` | 首次订阅向导 | 删除「没有歌单？」入口与 `ManualAdd` 组件 |
| `web/src/wizard-state.ts` | 向导 reducer | 删除 `ADD_MANUAL` action |
| `src/routes/manage.ts` | manage 路由 | 删除死路由 `POST /artists` |
| `test/routes/manage.test.ts` | manage 路由测试 | 两个用例改用 db 帮手造数据；补多歌单合并用例 |
| `web/src/wizard-state.test.ts` | reducer 测试 | 删 `ADD_MANUAL` 断言 |

任务顺序刻意为：先补服务端覆盖（Task 1）→ 再接前端入口（Task 2、3）→ 最后拆手动添加（Task 4、5、6）。这样每一步结束时产品都是可用的，拆除动作发生在替代入口已经就位之后。

---

### Task 1: 补一个「导入第二个不同歌单」的服务端测试

现有 `test/routes/manage.test.ts:184` 只覆盖了**同一个**歌单导两次（`added: 0`）。用户的真实场景是导**不同**的歌单并合并，这条路径目前没有测试保护。本任务不改产品代码，只补覆盖。

**Files:**
- Test: `test/routes/manage.test.ts`

**Interfaces:**
- Consumes: `app`（`src/index.ts`）、`listArtists`（`src/db/subscription-artists.ts`）、测试内已有的 `activeSub()` 与 `j()` 帮手。
- Produces: 无（纯测试）。

- [ ] **Step 1: 写这个测试**

加在 `test/routes/manage.test.ts` 末尾。注意 `activeSub()` 造出的订阅已自带艺人「刺猬」，所以断言用相对量 `before`。`j()` 是文件里已有的 body 帮手。

```ts
it("importing a second, different playlist merges and dedupes across playlists", async () => {
  const sub = await activeSub();
  const before = (await listArtists(env.DB, sub.id)).length;

  function qqList(title: string, names: string[]) {
    return new Response(
      JSON.stringify({
        request: {
          code: 0,
          data: {
            dirinfo: { title },
            songlist_size: names.length,
            songlist: names.map((n, i) => ({ name: `s${i}`, singer: [{ name: n }] })),
          },
        },
      }),
    );
  }

  // 歌单 A：痛仰乐队 + 海龟先生
  vi.stubGlobal("fetch", vi.fn(async () => qqList("A", ["痛仰乐队", "海龟先生"])));
  const a = await app.request(
    `/api/manage/import?token=${sub.token}`,
    j({ link: "https://y.qq.com/n/ryqq/playlist/1" }),
    env,
  );
  expect(((await a.json()) as any).added).toBe(2);

  // 歌单 B：海龟先生（与 A 重叠）+ 达达乐队（新）
  vi.stubGlobal("fetch", vi.fn(async () => qqList("B", ["海龟先生", "达达乐队"])));
  const b = await app.request(
    `/api/manage/import?token=${sub.token}`,
    j({ link: "https://y.qq.com/n/ryqq/playlist/2" }),
    env,
  );
  // 只有达达乐队是新的；海龟先生已被 A 带进来了
  expect(((await b.json()) as any).added).toBe(1);

  const names = (await listArtists(env.DB, sub.id)).map((x) => x.name);
  expect(names).toContain("痛仰乐队");
  expect(names).toContain("海龟先生");
  expect(names).toContain("达达乐队");
  // 重叠的海龟先生只有一条，没有变成两行
  expect(names.filter((n) => n === "海龟先生").length).toBe(1);
  expect(names.length).toBe(before + 3);

  vi.unstubAllGlobals();
});
```

**⚠️ 末尾的 `vi.unstubAllGlobals()` 不能省。** 该文件的 `afterEach` 只做 `vi.restoreAllMocks()`（`manage.test.ts:18`），它**不撤销** `vi.stubGlobal`。既有用例都是在自己末尾手动清（见 `manage.test.ts:221`）。漏了会把 fetch stub 泄漏给后续用例，制造出难查的连带失败。

- [ ] **Step 2: 跑测试**

Run: `npx vitest run --config vitest.config.mts test/routes/manage.test.ts -t "second, different playlist"`

Expected: **PASS**。这条是特征确认测试（characterization test）——它验证后端本就支持的行为，本任务不改产品代码。若它 FAIL，说明 spec 对后端能力的判断有误，**停下来**，别改测试去迁就，先报告实际输出。

- [ ] **Step 3: 提交**

```bash
git add test/routes/manage.test.ts
git commit -m "test(manage): cover merging artists across two different playlists"
```

---

### Task 2: `api.ts` 加 `importPlaylist()`

**Files:**
- Modify: `web/src/api.ts`
- Test: `web/src/api.test.ts`（新建）

**Interfaces:**
- Consumes: `web/src/api.ts` 里已有的 `json<T>(res)` 私有帮手。
- Produces: `importPlaylist(link: string, token: string, turnstileToken?: string): Promise<{ added: number; artists: { id: string; name: string }[] }>` —— Task 3 会用它。

- [ ] **Step 1: 写失败测试**

新建 `web/src/api.test.ts`：

```ts
import { afterEach, expect, it, vi } from "vitest";
import { importPlaylist } from "./api";

afterEach(() => vi.unstubAllGlobals());

it("posts the link to the manage import route with the token in the query", async () => {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ added: 2, artists: [{ id: "a1", name: "刺猬" }] }), {
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const res = await importPlaylist("https://music.163.com/playlist?id=1", "tok-123");

  expect(res.added).toBe(2);
  expect(res.artists).toEqual([{ id: "a1", name: "刺猬" }]);
  const [url, init] = fetchMock.mock.calls[0] as any;
  expect(url).toBe("/api/manage/import?token=tok-123");
  expect(init.method).toBe("POST");
  expect(JSON.parse(init.body)).toEqual({ link: "https://music.163.com/playlist?id=1" });
});

it("surfaces the server error message instead of a generic failure", async () => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({ error: "歌单解析失败，请稍后重试或手动添加" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    }),
  ));

  await expect(importPlaylist("https://x/1", "tok")).rejects.toThrow("歌单解析失败，请稍后重试或手动添加");
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `npx vitest run --config vitest.web.config.ts web/src/api.test.ts`

Expected: FAIL —— 报错类似 `No "importPlaylist" export is defined on the "./api" mock` 或 `importPlaylist is not a function`。

- [ ] **Step 3: 实现**

追加到 `web/src/api.ts` 末尾（`turnstileToken` 为 undefined 时 `JSON.stringify` 会自动省略该键，与 `resolveLink` 的做法一致）：

```ts
export const importPlaylist = (link: string, token: string, turnstileToken?: string) =>
  fetch(`/api/manage/import?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ link, turnstileToken }),
  }).then((r) => json<{ added: number; artists: { id: string; name: string }[] }>(r));
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run --config vitest.web.config.ts web/src/api.test.ts`

Expected: PASS（2 passed）

- [ ] **Step 5: 提交**

```bash
git add web/src/api.ts web/src/api.test.ts
git commit -m "feat(web): add importPlaylist api call"
```

---

### Task 3: Manage 页加导入区块

这是替代入口，必须在拆掉手动添加（Task 4）之前落地，否则中间会出现「艺人一个都加不进去」的状态。

**Files:**
- Modify: `web/src/Manage.tsx`
- Test: `web/src/Manage.test.tsx`（新建）

**Interfaces:**
- Consumes: `importPlaylist`（Task 2）、`Turnstile`（`web/src/Turnstile.tsx`）、`Manage.tsx:65` 已有的 `config` state（`Config` 含 `publicMode: boolean`、`turnstileSiteKey: string`）。
- Produces: `ImportPlaylist` 组件（`Manage.tsx` 内部），props：`{ token: string; config: Config | null; onImported: (artists: { id: string; name: string }[]) => void }`。

- [ ] **Step 1: 写失败测试**

**这会是本仓库第一个 React 组件测试**，别照着别的测试找先例——`web/src/` 现有三个测试（`ArtistAvatar.test.ts`、`session.test.ts`、`wizard-state.test.ts`）全是纯函数测试，没有一个 render 组件。基建是齐的、无需配置：`@testing-library/react` 已在 devDependencies，`vitest.web.config.ts` 的 include 已含 `web/**/*.test.tsx`，environment 是 happy-dom，`tsconfig.json` 的 `jsx` 是 `react-jsx`（自动 runtime，JSX 里不用 import React）。

新建 `web/src/Manage.test.tsx`。只测导入区块本身（不挂载整个 Manage，避免依赖 token/网络）：

```tsx
import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ImportPlaylist } from "./Manage";

afterEach(() => vi.unstubAllGlobals());

const cfg = { cities: [], publicMode: false, turnstileSiteKey: "" };

it("imports a playlist and reports how many artists were added", async () => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({ added: 3, artists: [{ id: "a1", name: "刺猬" }] }), {
      headers: { "content-type": "application/json" },
    }),
  ));
  const onImported = vi.fn();
  render(<ImportPlaylist token="tok" config={cfg} onImported={onImported} />);

  fireEvent.change(screen.getByPlaceholderText(/粘贴另一个歌单链接/), {
    target: { value: "https://music.163.com/playlist?id=1" },
  });
  fireEvent.click(screen.getByText("导入"));

  await waitFor(() => expect(screen.getByText(/新增 3 位音乐人/)).toBeTruthy());
  expect(onImported).toHaveBeenCalledWith([{ id: "a1", name: "刺猬" }]);
});

it("shows the server's error message when the import fails", async () => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({ error: "歌单解析失败，请稍后重试或手动添加" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    }),
  ));
  render(<ImportPlaylist token="tok" config={cfg} onImported={vi.fn()} />);

  fireEvent.change(screen.getByPlaceholderText(/粘贴另一个歌单链接/), {
    target: { value: "https://music.163.com/playlist?id=1" },
  });
  fireEvent.click(screen.getByText("导入"));

  await waitFor(() => expect(screen.getByText(/歌单解析失败/)).toBeTruthy());
});
```

用 `fireEvent.change` 驱动 React 受控 input（testing-library 会正确触发 React 的 onChange）。`getByPlaceholderText` 的正则必须与 Step 3 组件里的 placeholder 文案对得上。

- [ ] **Step 2: 跑测试确认它失败**

Run: `npx vitest run --config vitest.web.config.ts web/src/Manage.test.tsx`

Expected: FAIL —— `ImportPlaylist` 未从 `./Manage` 导出。

- [ ] **Step 3: 实现 `ImportPlaylist` 组件**

加到 `web/src/Manage.tsx`（放在 `ArtistsTab` 定义之前）。必须 `export`，测试要用：

```tsx
export function ImportPlaylist({
  token,
  config,
  onImported,
}: {
  token: string;
  config: Config | null;
  onImported: (artists: { id: string; name: string }[]) => void;
}) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");
  const [tsToken, setTsToken] = useState("");

  async function submit() {
    const v = link.trim();
    if (!v || busy) return;
    setBusy(true);
    setErr("");
    setDone("");
    try {
      const res = await importPlaylist(v, token, tsToken || undefined);
      setDone(`新增 ${res.added} 位音乐人`);
      setLink("");
      onImported(res.artists);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <div className="inline-add">
        <input
          className="input"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="粘贴另一个歌单链接，继续添加音乐人"
        />
        <button className="btn accent" onClick={submit} disabled={!link.trim() || busy}>
          {busy ? "导入中…" : "导入"}
        </button>
      </div>
      {config?.publicMode && (
        <div style={{ marginTop: 12 }}>
          <Turnstile siteKey={config.turnstileSiteKey} onToken={setTsToken} />
        </div>
      )}
      {done && <p className="hint">{done}</p>}
      {err && <p className="error">{err}</p>}
    </div>
  );
}
```

**样式说明（已核对 `web/src/styles.css`，照抄即可，无需新增 CSS）：**
- `.inline-add`（`styles.css:256`）是 `display: flex; gap: 8px` 的**横向行**，只能包 input + 按钮。Turnstile 和提示文案必须放在它**外面**，否则会被排进同一行。外层 `div` 就是干这个的。
- `.error`（`styles.css:260`）自带 `::before` 的 ✕ 图标，是本文件既有的错误提示写法（见 `Manage.tsx:252` 的 `<p className="error">{err}</p>`）。不要写成 `hint error`。
- `.hint`（`styles.css:274`）是弱化文案，用于成功回显。
```

同时在 `Manage.tsx` 顶部补 import：

```tsx
import { getConfig, importPlaylist, setManageCities, type Config } from "./api";
import { Turnstile } from "./Turnstile";
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run --config vitest.web.config.ts web/src/Manage.test.tsx`

Expected: PASS（2 passed）

- [ ] **Step 5: 挂进 `ArtistsTab`**

在 `Manage.tsx:169` 把 `config` 和导入回调传下去：

```tsx
<ArtistsTab
  artists={view.artists}
  token={token}
  config={config}
  onImported={reload}
  onAdd={addArtist}
  onRemove={removeArtist}
/>
```

`ArtistsTab` 的 props 类型相应加上 `token: string; config: Config | null; onImported: () => void;`，并在 `artist-wall` 上方渲染：

```tsx
<ImportPlaylist token={token} config={config} onImported={onImported} />
```

`onImported={reload}` 直接复用现有的 `reload()`：它会重新拉整个 view，比手动合并 artists 更不容易出错，代价是多一次请求。（`onImported` 的入参在此忽略，`reload` 不接收参数。）

- [ ] **Step 6: 跑全部 web 测试**

Run: `npx vitest run --config vitest.web.config.ts`

Expected: 全部 PASS

- [ ] **Step 7: 提交**

```bash
git add web/src/Manage.tsx web/src/Manage.test.tsx
git commit -m "feat(web): let manage import additional playlists"
```

---

### Task 4: 拆掉 Manage 页的手动添加

替代入口（Task 3）已就位，现在拆。

**Files:**
- Modify: `web/src/Manage.tsx`

**Interfaces:**
- Consumes: Task 3 的 `ImportPlaylist`。
- Produces: `ArtistsTab` props 收敛为 `{ artists; token; config; onImported; onRemove }`（`onAdd` 移除）。

- [ ] **Step 1: 删除 `addArtist` 与 `onAdd` 链路**

在 `web/src/Manage.tsx`：
1. 删掉 `addArtist` 函数（`Manage.tsx:100-107`）。
2. 从 `<ArtistsTab .../>` 的用法里删掉 `onAdd={addArtist}`，从其 props 类型里删掉 `onAdd`。
3. 删掉 `ArtistsTab` 内的 `adding` / `v` state 和 `submit()` 函数，以及 `{adding && (...)}` 那段内联输入框。

- [ ] **Step 2: 空状态改为导入入口**

`Manage.tsx:282` 的空状态原本 CTA 是「＋ 添加音乐人」，改为渲染导入组件（`artists.length === 0 && !adding` 里的 `adding` 已不存在，条件简化为 `artists.length === 0`）：

```tsx
if (artists.length === 0)
  return (
    <section className="rise">
      <div className="empty">
        <span className="glyph">🎸</span>
        <h3>还没有关注的音乐人</h3>
        <p>导入一个歌单，我们会从里面认出音乐人，他们开演出时提醒你。</p>
        <div style={{ marginTop: 16 }}>
          <ImportPlaylist token={token} config={config} onImported={onImported} />
        </div>
      </div>
    </section>
  );
```

- [ ] **Step 3: 删掉艺人墙末尾的「＋ 添加」磁贴**

删除 `Manage.tsx:326` 一带的整段：

```tsx
{!adding && (
  <button className="add-tile" onClick={() => setAdding(true)}>
    <span className="plus">＋</span>
    添加
  </button>
)}
```

导入入口已在艺人墙上方常驻，磁贴无替代必要。

- [ ] **Step 3b: 删掉随之变成死代码的 CSS**

`.add-tile` 和它的 `.plus`（`web/src/styles.css:504-512`）在磁贴删除后已无引用。先确认无其它引用再删：

```bash
grep -rn "add-tile" web/src
```

预期只剩 `styles.css` 里的定义。删掉 `styles.css:504-512` 这三条规则。（`.inline-add` **不要动**，Task 3 的导入框还在用。）

- [ ] **Step 4: 跑 web 测试 + 类型检查**

Run: `npx vitest run --config vitest.web.config.ts && npx tsc --noEmit`

Expected: 测试全 PASS，tsc 无输出（exit 0）。tsc 会抓出漏删的 `onAdd` 引用。

- [ ] **Step 5: 提交**

```bash
git add web/src/Manage.tsx web/src/styles.css
git commit -m "refactor(web): drop manual artist add from manage page"
```

---

### Task 5: 拆掉向导的手动添加

**Files:**
- Modify: `web/src/Wizard.tsx`
- Modify: `web/src/wizard-state.ts`
- Test: `web/src/wizard-state.test.ts`

**Interfaces:**
- Produces: `WizardAction` 不再有 `ADD_MANUAL` 成员。

- [ ] **Step 1: 改测试（先改测试，让它红）**

`web/src/wizard-state.test.ts:30` 的用例「toggles and adds manual artists without duplicates」同时测了 toggle 和 manual add。保留 toggle 部分，删掉 manual 部分，并改名：

```ts
it("toggles artists off and on", () => {
  let s = wizardReducer(initialWizard(), {
    type: "LOADED_PLAYLIST", title: "x", artists: [{ name: "刺猬", songCount: 1 }],
  });
  s = wizardReducer(s, { type: "TOGGLE_ARTIST", name: "刺猬" });
  expect(selectedArtistNames(s)).toEqual([]);
  s = wizardReducer(s, { type: "TOGGLE_ARTIST", name: "刺猬" });
  expect(selectedArtistNames(s)).toEqual(["刺猬"]);
});
```

若该文件其它用例也引用了 `ADD_MANUAL`，一并按同样思路处理（用 `LOADED_PLAYLIST` 造数据代替手动添加）。

- [ ] **Step 2: 跑测试**

Run: `npx vitest run --config vitest.web.config.ts web/src/wizard-state.test.ts`

Expected: PASS（此步只是缩小测试面，`ADD_MANUAL` 还在，不会红）。

- [ ] **Step 3: 从 reducer 删掉 `ADD_MANUAL`**

在 `web/src/wizard-state.ts`：
1. 从 `WizardAction` 联合类型里删掉 `| { type: "ADD_MANUAL"; name: string }`（`wizard-state.ts:19`）。
2. 删掉 reducer 里整个 `case "ADD_MANUAL": { ... }` 分支（`wizard-state.ts:47-57`）。

- [ ] **Step 4: 从 Wizard 删掉两个入口**

在 `web/src/Wizard.tsx`：
1. 删掉第一步的「没有歌单？手动输入音乐人」整段（`Wizard.tsx:107-111` 的 `<p className="or-skip">…</p>`）。
2. 删掉第二步的 `<ManualAdd onAdd={...} />` 用法（`Wizard.tsx:148`）。
3. 删掉 `ManualAdd` 组件定义（`Wizard.tsx:292` 起整个函数）。

- [ ] **Step 5: 跑 web 测试 + 类型检查**

Run: `npx vitest run --config vitest.web.config.ts && npx tsc --noEmit`

Expected: 测试全 PASS，tsc exit 0。reducer 的 switch 是穷尽匹配的，删 action 后若有漏网引用 tsc 会报出来。

- [ ] **Step 6: 提交**

```bash
git add web/src/Wizard.tsx web/src/wizard-state.ts web/src/wizard-state.test.ts
git commit -m "refactor(web): drop manual artist entry from the wizard"
```

---

### Task 6: 删掉死路由 `POST /api/manage/artists`

前端两个调用方都没了，此路由已无人调用。

**⚠️ 关键：它现在被当作测试脚手架在用。** `test/routes/manage.test.ts:148` 和 `:158` 靠它造数据，而其中「add and remove artists」测的正是**要保留**的单个艺人删除。必须先把这两个用例改用 db 帮手造数据，否则删路由会连带把删除功能的覆盖弄没。

**Files:**
- Modify: `test/routes/manage.test.ts`
- Modify: `src/routes/manage.ts`

**Interfaces:**
- Consumes: `addArtistToSubscription(db, subscriptionId, artistName): Promise<string>`（`src/db/subscription-artists.ts`，返回 artistId）。

- [ ] **Step 1: 两个用例改用 db 帮手造数据**

在 `test/routes/manage.test.ts` 顶部的 import 里补上 `addArtistToSubscription`（该文件已从同一模块 import 了 `setArtists, listArtists`）：

```ts
import { setArtists, listArtists, addArtistToSubscription } from "../../src/db/subscription-artists";
```

把 `manage.test.ts:148` 的用例改为（断言完全不变，只换造数据的方式，删除仍走 HTTP 路由）：

```ts
it("remove artists", async () => {
  const sub = await activeSub();
  const id = await addArtistToSubscription(env.DB, sub.id, "海龟先生");
  expect((await listArtists(env.DB, sub.id)).length).toBe(2);
  const del = await app.request(`/api/manage/artists/${id}?token=${sub.token}`, { method: "DELETE" }, env);
  expect(del.status).toBe(200);
  expect((await listArtists(env.DB, sub.id)).map((a) => a.name)).toEqual(["刺猬"]);
});
```

把 `manage.test.ts:158`「adding an artist links it to already-crawled upcoming shows」里的这行：

```ts
await app.request(`/api/manage/artists?token=${sub.token}`, j({ name: "海龟先生" }), env);
```

替换为（该用例本意是测「新增艺人会挂上已抓到的演出」，改走 `/import` 才能继续覆盖这个行为——它是唯一剩下的新增入口）：

```ts
vi.stubGlobal("fetch", vi.fn(async () =>
  new Response(
    JSON.stringify({
      request: {
        code: 0,
        data: {
          dirinfo: { title: "L" },
          songlist_size: 1,
          songlist: [{ name: "s1", singer: [{ name: "海龟先生" }] }],
        },
      },
    }),
  ),
));
await app.request(`/api/manage/import?token=${sub.token}`, j({ link: "https://y.qq.com/n/ryqq/playlist/9" }), env);
```

**同样别忘了在该用例末尾加 `vi.unstubAllGlobals()`**（理由见 Task 1：`afterEach` 里的 `vi.restoreAllMocks()` 不撤销 stubGlobal）。

- [ ] **Step 2: 跑测试确认改造后仍然通过**

Run: `npx vitest run --config vitest.config.mts test/routes/manage.test.ts`

Expected: 全 PASS。此时路由还在，测试只是不再用它造数据。

- [ ] **Step 3: 删掉路由**

删除 `src/routes/manage.ts:98-110` 整个 `manageRouter.post("/artists", ...)` 块。

删完后检查 `src/routes/manage.ts` 顶部的 import：`MAX_ARTISTS` 和 `countArtists` 是否还有别的用处？`/import` 里仍在用两者（`manage.ts:139` 一带的 cap 计算），**应当保留**。以 tsc 的结果为准，别凭印象删。

- [ ] **Step 4: 跑服务端全量 + 类型检查**

Run: `npx vitest run --config vitest.config.mts && npx tsc --noEmit`

Expected: 测试全 PASS，tsc exit 0。若 tsc 报某个 import 未使用，删掉那个 import。

- [ ] **Step 5: 提交**

```bash
git add src/routes/manage.ts test/routes/manage.test.ts
git commit -m "refactor(api): drop the now-unused manual add-artist route"
```

---

### Task 7: 端到端验证

**Files:** 无改动（纯验证）

- [ ] **Step 1: 跑全量测试**

Run: `npm test`

Expected: 两个 vitest 配置都全绿。

- [ ] **Step 2: 类型检查 + 构建**

Run: `npx tsc --noEmit && npm run web:build`

Expected: 均成功。构建能抓出测试碰不到的 JSX/import 残留。

- [ ] **Step 3: 真实驱动一遍**

REQUIRED SUB-SKILL: 用 `verify` skill 驱动真实流程，不要只靠测试。

wrangler 需要 Node 22（仓库 `.nvmrc` 钉的是 20）：

```bash
mise x node@22 -- npx wrangler d1 migrations apply show-remind --local
mise x node@22 -- npx wrangler dev --port 8799
```

要看到的：
1. 首页向导**不再**出现「没有歌单？手动输入音乐人」，第二步没有手动输入框。
2. manage 页艺人墙上方有导入框；粘一个歌单链接能导入并回显「新增 N 位音乐人」，列表随之刷新。
3. 再粘**另一个**歌单，艺人合并进来，重叠的不重复。
4. manage 页没有「＋ 添加音乐人」和「＋ 添加」磁贴；艺人磁贴上的 `×` 删除**仍然可用**。

**⚠️ 注意：走完订阅流程会真的发确认邮件**（`.env` 里配了 SMTP/Resend 凭据）。验证 manage 页请复用已存在的订阅 token，不要为了验证而跑一遍注册。

- [ ] **Step 4: 报告结果**

REQUIRED SUB-SKILL: 用 `superpowers:verification-before-completion`，先有证据再下结论。

---

## 完成后

REQUIRED SUB-SKILL: 用 `superpowers:finishing-a-development-branch` 决定如何收尾（合并 / PR / 清理）。

注意工作区里还有一处**未提交**的相关改动：`MAX_ARTISTS` 静默截断的修复（`src/routes/subscribe.ts`、`src/routes/manage.ts`、`test/routes/subscribe.test.ts`）。它与本计划相互独立，应作为**单独的提交**，别混进本计划的任何一次提交里。
