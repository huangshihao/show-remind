# 秀动 Showstart wap 接口逆向记录（供对接）

> 日期：2026-07-12。全部结论均在真实网络上验证过（浏览器 + 本机 Python/curl 各跑通一遍）。
> 用途：替换 `scraper/app/showstart.py` 里失效的旧实现。**本文档只做记录，代码由你对接。**

## 0. 现状（为什么旧代码坏了）

- 旧实现打的 `wap.showstart.com/api/activity/list`、`/api/activity/detail` **已失效**，现在返回的是 SPA 的 HTML 外壳，不是 JSON。
- 现行接口在 `https://wap.showstart.com/v3/` 下，全部是 **POST/GET + JSON**，带一套自定义请求头和 `CRPSIGN` 签名。
- 匿名（游客）即可访问列表/详情，但必须先用设备号换一个**游客 accessToken**，且每个请求都要带 `CDEVICEINFO`（否则被 WAF 拦成 `sys001`）。

签名逻辑来自前端 `https://img05.showstart.com/static/js/index.69338885.js`（请求拦截器 `y.interceptor.request`）。

---

## 1. 签名算法 CRPSIGN（已用 Python 实测命中）

签名放在请求头 `CRPSIGN`，是一个 md5。body 里的 `sign` 字段是空的（占位，不用管）。

```
CRPSIGN = md5( accessToken + sign + idToken + userId
               + "wap" + deviceNo + bodyJSON + urlPath + "997" + CSAPPID + traceId )
```

各段含义（匿名场景）：

| 段 | 值（匿名） | 说明 |
|---|---|---|
| `accessToken` | 游客 token | 见 §3 bootstrap；= 请求头 `CUSAT`（空时头填 `nil`，签名里用 `""`）|
| `sign` | `""` | = `CUSUT`；未登录为空 |
| `idToken` | `""` | = `CUSIT`；未登录为空 |
| `userId` | `""` | = `CUSID`；未登录为空 |
| `"wap"` | 字面量 | 对应 `CTERMINAL` |
| `deviceNo` | 32 位小写 hex | 客户端生成一次并持久；= `CDEVICENO`/`CUUSERREF` |
| `bodyJSON` | 请求体 JSON 字符串 | GET 无 body 时为 `""`。**必须与实际发送的字节完全一致**（无空格：`separators=(",",":")`, `ensure_ascii=False`）|
| `urlPath` | 接口相对路径 | **不含 `/v3`**，例如 `/app/activity/search` |
| `"997"` | 字面量 | 对应 `CVERSION` |
| `CSAPPID` | `"wap"` | wap 端固定 `wap`（小程序/APP 会是别的值）|
| `traceId` | uuid32 + 毫秒时间戳 | = 请求头 `CRTRACEID`，每次新生成 |

> 关键坑：`urlPath` 用错（带 `/v3` 或少个前缀）签名就不对。列表是 `/app/activity/search`，详情是 `/wap/activity/details`，取 token 是 `/waf/gettoken`，城市是 `/app/common/city`。

---

## 2. 必需请求头

每个请求都带下面这些头。**`CDEVICEINFO` 必须有**（不参与签名，但缺了 WAF 直接 `sys001`）：

```
Content-Type: application/json        # POST 才需要
CUSAT:      <accessToken 或 nil>
CUSUT:      nil
CUSIT:      nil
CUSID:      nil
CUSNAME:    nil
CTERMINAL:  wap
CSAPPID:    wap
CDEVICENO:  <deviceNo>
CUUSERREF:  <deviceNo>
CVERSION:   997
CDEVICEINFO: <URL 编码后的设备信息 JSON，见下>
CRTRACEID:  <traceId = uuid32 + 毫秒时间戳>
st_flpv:    ""
CRPSIGN:    <签名>
```

`CDEVICEINFO` 的原始 JSON（然后整体 `encodeURIComponent` / `urllib.parse.quote(safe="")`）：

```json
{"vendorName":"","deviceMode":"PC","deviceName":"","systemName":"macos","systemVersion":"10.15.7","cpuMode":" ","cpuCores":"","cpuArch":"","memerySize":"","diskSize":"","network":"4G","resolution":"1920*1080","pixelResolution":""}
```

（内容不校验，随便填一个合理的 PC 设备信息即可，只要这个头存在。）

---

## 3. Bootstrap：获取游客 accessToken（已验证）

前端逻辑：任何请求返回 `token-clean-at` / `token-expire-*` 时，会 dispatch `fetchAccessToken` → 调 `GET /waf/gettoken` 拿新 token 再重试。全新客户端第一次也走这个。

```
GET https://wap.showstart.com/v3/waf/gettoken
```

- 请求：accessToken 传空（`CUSAT: nil`），deviceNo 用你新生成的，带全套头（含 CDEVICEINFO）+ 签名（`urlPath=/waf/gettoken`，body=`""`）。
- 响应：`{ state:"1", success:true, result:{ accessToken:{ access_token: "<32位>" }, idToken:{ id_token: ... } } }`
- 取 `result.accessToken.access_token` 存起来，后续请求用。

> accessToken 与 deviceNo **绑定**：换 deviceNo 旧 token 立刻失效（返回 `token-clean-at`）。所以固定一个 deviceNo，配一个 accessToken；token 失效时用同一 deviceNo 重新 gettoken。

---

## 4. 演出列表接口（已验证，含 livehouse）

```
POST https://wap.showstart.com/v3/app/activity/search
```

请求 body（`activityType:0` = 全部类型，含 livehouse；方案 B 按城市全量抓就用 0）：

```json
{"activityType":0,"pageNo":1,"isHome":1,"saleSituation":"","startTime":"","endTime":"","showStyle":"","sortType":"","service":"","price":"","cityType":0,"cityId":10,"st_flpv":"","sign":"","trackPath":""}
```

- `cityId`：**秀动内部城市 id**（不是行政区码！北京=10），见 §6。
- `pageNo`：从 1 开始翻页，每页 10 条，翻到 `activityInfo` 为空为止。

响应：`result.activityInfo` 是数组，每条：

```json
{
  "activityId": 299995,
  "title": "尹毓恪「春日海啸」2026巡演 北京站",
  "city": "北京",
  "cityId": "10",
  "siteName": "菇的LIVE·蘑菇洞",
  "showTime": "2026.07.12 本周日 20:00",
  "activityPrice": "¥150起",
  "styles": ["流行"],
  "showTypeTagId": 1379,
  "isEnd": 0,
  "avatar": "https://s2.showstart.com/img/..."
}
```

**映射到你的 ShowSummary（列表已经够用，含场馆/票价）：**

| 你的字段 | 秀动字段 |
|---|---|
| `showstartId` | `str(activityId)` |
| `title` | `title` |
| `cityCode` | `str(cityId)`（存秀动 cityId）|
| `showTime` | `showTime` 需解析，见 §7 |
| `url` | `https://wap.showstart.com/pages/activity/detail/detail?activityId={activityId}` |
| （场馆）| `siteName` |
| （票价）| `activityPrice`（`"¥150起"` 这种展示串）|

---

## 5. 演出详情接口 —— 拿 performers（已验证）

```
POST https://wap.showstart.com/v3/wap/activity/details
```

请求 body：

```json
{"activityId":299995,"st_flpv":"","sign":"","trackPath":""}
```

响应 `result` 字段很多（`activityName/title/showTime/price/site/host/sessionUserInfos/...`）。**演出艺人（阵容）在这里：**

```
performers = result.sessionUserInfos[*].userInfos[*]  中  activityRoleType == 2  的  name
```

- `sessionUserInfos[].userInfos[]` 里 `activityRoleType==2` 是**演出者/艺人**（例：`{"name":"尹毓恪","activityRoleType":2}`）。
- `result.host[]` 是**主办方**（例：`{"name":"WhyU传媒","activityRoleType":5}`），**要排除**。
- `result.userInfos`（顶层）这个演出里是空数组，别用它。

> 注意：不是所有演出都有结构化的 `sessionUserInfos` 艺人。拿不到时，你的匹配还有"标题包含艺人名"兜底（`matched_by=title`），所以列表的 `title` 依然重要。

其余字段（venue/price/showTime）列表里已经有；如果只想用详情补 performers，crawler 可以用「列表 summary + 详情 performers」合并，避免依赖详情里没完全确认的 venue/price 字段路径。

---

## 6. 城市列表接口（name → 秀动 cityId）

```
GET https://wap.showstart.com/v3/app/common/city
```

响应 `result` 是 377 个城市的数组，每条：

```json
{"code":"110000","name":"北京","pinYin":"beijing","id":10,"hotFlag":1,"spellFirst":"B","letter":"B"}
```

- `id` = 搜索/详情要用的**秀动 cityId**（北京=10）。
- `code` = 行政区码（110000），可用它和你现有的 `lib/cities.ts` 行政区码对上，建一张 `行政区码 → 秀动id` 或 `城市名 → 秀动id` 的映射表。
- 建议：启动时拉一次 `/app/common/city` 缓存成映射，用户选城市时转成 `cityId` 传给 search。

---

## 7. showTime 解析

列表/详情的 `showTime` 是中文展示串，需要解析成 ISO：

- `"2026.07.12 本周日 20:00"` → `2026-07-12T20:00:00`
- `"2026.07.13 周一 19:30"` → `2026-07-13T19:30:00`

正则参考：`(\d{4})\.(\d{1,2})\.(\d{1,2}).*?(\d{1,2}):(\d{2})`，取 1-5 组拼 ISO。

---

## 8. Token 刷新 / 错误处理

- 响应 `state` 为 `token-clean-at` / `token-expire-at` / `token-expire-ut` / `token-clean-ut` / `login.other.terminal` → accessToken 失效，用**同一 deviceNo** 重新 `GET /waf/gettoken`，然后**重试原请求一次**。
- 响应 `state == "sys001"` → WAF 拦截，基本都是**漏了 `CDEVICEINFO` 头**（偶发 `o-sysJava01` 是服务端抖动，重试即可）。
- 成功判定：`state == "1"` 且 `success == true`，数据在 `result`。
- 限速：保持克制（每城市请求间隔 1–2 秒 + 随机 UA/抖动），秀动有风控。

---

## 9. 验证过的 Python 参考实现

下面这段在本机跑通过（`bootstrap → search` 返回真实北京演出）。`ShowstartClient` 的骨架可以照这个改。
> 注：本机走 SOCKS 代理，用了 `curl` 发请求；生产国内直连可直接用 `httpx.AsyncClient`。

```python
import hashlib, json, time, secrets, urllib.parse
import httpx  # 生产直连用它；调试走代理时可换成 subprocess curl

BASE = "https://wap.showstart.com/v3"
DEVICE_INFO = urllib.parse.quote(json.dumps({
    "vendorName":"","deviceMode":"PC","deviceName":"","systemName":"macos",
    "systemVersion":"10.15.7","cpuMode":" ","cpuCores":"","cpuArch":"","memerySize":"",
    "diskSize":"","network":"4G","resolution":"1920*1080","pixelResolution":""
}, separators=(",",":")), safe="")

def _md5(s: str) -> str:
    return hashlib.md5(s.encode("utf-8")).hexdigest()

class Showstart:
    def __init__(self):
        self.device_no = secrets.token_hex(16)   # 32 hex, 固定一个
        self.access_token = ""

    def _sign(self, body: str, url_path: str, trace: str) -> str:
        # accessToken + sign + idToken + userId + "wap" + deviceNo + body + urlPath + "997" + CSAPPID + traceId
        return _md5(self.access_token + "" + "" + "" + "wap" + self.device_no
                    + body + url_path + "997" + "wap" + trace)

    def _headers(self, body: str, url_path: str) -> dict:
        trace = secrets.token_hex(16) + str(int(time.time() * 1000))
        return {
            "Content-Type": "application/json",
            "CUSAT": self.access_token or "nil", "CUSUT": "nil", "CUSIT": "nil",
            "CUSID": "nil", "CUSNAME": "nil", "CTERMINAL": "wap", "CSAPPID": "wap",
            "CDEVICENO": self.device_no, "CUUSERREF": self.device_no, "CVERSION": "997",
            "CDEVICEINFO": DEVICE_INFO, "CRTRACEID": trace, "st_flpv": "",
            "CRPSIGN": self._sign(body, url_path, trace),
        }

    async def _call(self, client, method, url_path, body=""):
        headers = self._headers(body, url_path)
        if method == "GET":
            r = await client.get(BASE + url_path, headers=headers)
        else:
            r = await client.post(BASE + url_path, headers=headers, content=body.encode("utf-8"))
        return r.json()

    async def _request(self, client, method, url_path, body=""):
        d = await self._call(client, method, url_path, body)
        state = str(d.get("state", "")).lower()
        if state in ("token-clean-at","token-expire-at","token-expire-ut","token-clean-ut","login.other.terminal"):
            await self.fetch_token(client)                 # 同一 deviceNo 换新 token
            d = await self._call(client, method, url_path, body)   # 重试一次
        return d

    async def fetch_token(self, client):
        d = await self._call(client, "GET", "/waf/gettoken", "")
        self.access_token = d["result"]["accessToken"]["access_token"]

    async def city_shows(self, city_id: int, page: int = 1):
        body = json.dumps({
            "activityType":0,"pageNo":page,"isHome":1,"saleSituation":"","startTime":"",
            "endTime":"","showStyle":"","sortType":"","service":"","price":"","cityType":0,
            "cityId":int(city_id),"st_flpv":"","sign":"","trackPath":""
        }, separators=(",",":"), ensure_ascii=False)
        if not self.access_token:
            await self.fetch_token(client=...)  # 首次先 bootstrap
        return await self._request(..., "POST", "/app/activity/search", body)

    async def show_detail(self, activity_id: int):
        body = json.dumps({"activityId":int(activity_id),"st_flpv":"","sign":"","trackPath":""},
                           separators=(",",":"), ensure_ascii=False)
        return await self._request(..., "POST", "/wap/activity/details", body)

    async def cities(self, client):
        return await self._request(client, "GET", "/app/common/city", "")
```

签名自测（把 accessToken/deviceNo/body/urlPath/trace 换成一次真实抓包值，应等于该请求的 `CRPSIGN`）：

```python
# 已验证：md5(accessToken + "wap" + deviceNo + body + "/app/activity/search" + "997" + "wap" + traceId) == CRPSIGN
```

解析 performers：

```python
def performers(detail_result: dict) -> list[str]:
    out, seen = [], set()
    for sess in (detail_result.get("sessionUserInfos") or []):
        for u in (sess.get("userInfos") or []):
            if u.get("activityRoleType") == 2:
                name = u.get("name")
                if name and name not in seen:
                    seen.add(name); out.append(name)
    return out  # host[] (roleType 5) 是主办方，不进 performers
```

---

## 10. 一句话总结对接步骤

1. 生成并固定一个 `deviceNo`（32 hex）。
2. `GET /v3/waf/gettoken` 拿 `accessToken`（带 CDEVICEINFO + 签名）。
3. `GET /v3/app/common/city` 建 `城市名/行政区码 → 秀动cityId` 映射。
4. 按城市 `POST /v3/app/activity/search`（翻页）拿演出列表 → 存 showstartId/title/cityCode/showTime/url/场馆/票价。
5. 新演出 `POST /v3/wap/activity/details` 补 performers（`sessionUserInfos[].userInfos[roleType==2].name`）。
6. `state` 是 token-* 就用同 deviceNo 重新 gettoken 重试；`sys001` 检查 CDEVICEINFO。

---

## 附：QQ 音乐（已改代码并提交，非本文档待办）

QQ 那条线已经在分支 `fix/live-integrations` 修好并提交（commit `353fb55`），供参考：

- `qqmusic-api-python` 0.6.x 改成了**类接口**：`Client().songlist.get_detail(songlist_id, num=100, page=n)`，不再有模块级 `songlist.get_detail`。
- 真实返回是 `{info:{title}, songs:[{name, singer:[{name}]}]}`（旧代码读的 `dirinfo`/`songlist` 是错的）。
- `num` 默认 10，大歌单要按 `hasmore`/`total` **翻页**。
- 已实测：真实公开歌单 99 首全量拿到，标题/歌手/多歌手数组都正确。
