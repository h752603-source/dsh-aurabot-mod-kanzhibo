# AGENTS.md — 让 AI 代理（DSH / Claude Code / Codex）一次装对的说明书

> 这一页是写给**机器**看的：不需要先读别的文件，按顺序照做就行。
> 人看的介绍在 `README.md`，模块本身的文档在 `module/README.md`。

## 0. 一句话

这是一个 **Aurabot（大肥鱼 QQ 插件）的扩展模块**，id `kanzhibo`，版本 `0.3.0`，扩展接口 v1。
功能：用一台独立 Edge/Chrome 通过 CDP 挂进抖音直播间，进房、发一条定制评论、续粉丝团灯牌，
挂着的时候自动把 `douyin`（刷抖音）模块关掉，离开后放回来。

## 1. 装到哪里

| 平台 | 目标目录 |
|---|---|
| Windows | `%USERPROFILE%\.dsh\plugins-data\aurabot\modules\kanzhibo\` |
| macOS / Linux | `~/.dsh/plugins-data/aurabot/modules/kanzhibo/` |

**只碰这个目录。** 插件的本体代码（`plugins/dsh-aurabot-qq/`）一行都不要改；
`modules/` 下别的模块（`douyin`、`pet`、`meme-wiki`……）也不要动。
`modules-data/`、`.aurabot-cache/` 是运行时目录，不要提交、不要手写。

## 2. 装法

### A. 手动复制（最稳，推荐给代理）

把 `module/` 里的这些东西放进目标目录：

```
module/index.mjs        →  modules/kanzhibo/index.mjs          # 入口，必须
module/module.json      →  modules/kanzhibo/module.json        # 元数据，必须（模块市场/校验要用）
module/README.md        →  modules/kanzhibo/README.md          # 可选
module/verify/verify.mjs → modules/kanzhibo/verify/verify.mjs  # 可选，但装完请用它验证
```

Windows PowerShell 一把梭：

```powershell
$dst = "$env:USERPROFILE\.dsh\plugins-data\aurabot\modules\kanzhibo"
New-Item -ItemType Directory -Force "$dst\verify" | Out-Null
Copy-Item .\module\* -Destination $dst -Recurse -Force
```

macOS / Linux：

```bash
dst=~/.dsh/plugins-data/aurabot/modules/kanzhibo
mkdir -p "$dst/verify" && cp -R module/. "$dst"/
```

### B. 走「模块市场」（有索引时）

```bash
export AURABOT_REGISTRY_URL="https://raw.githubusercontent.com/OWNER/REPO/main/registry/index.json"
```

Windows：`setx AURABOT_REGISTRY_URL "…"`（要重启插件），然后面板「模块市场」刷新 → 安装 `kanzhibo`。
这条路径要求 `registry/index.json` 里的 `assetsBase` + `path` 能下到 zip，且 `sha256` 和 zip 对得上。

## 3. 装完必须验证（三步，全过才算成）

1. **等 3~5 秒**（插件会自动重载模块），看日志：
   `%USERPROFILE%\.dsh\plugins-data\aurabot\logs\aurabot-<日期>.log`
   - 出现 `模块「看直播」（自己写的）已启动` → OK
   - 出现 `模块「kanzhibo」加载失败：…` → 把原因读完再改，别猜
2. **跑离线自检**（在模块目录里）：
   ```bash
   node verify/verify.mjs
   ```
   期望最后一行：`结果：33 通过 / 0 失败`。加 `LIVE=1` 会多 3 项真浏览器测试（会短暂弹一个 Edge 窗口）。
3. **面板**：`http://127.0.0.1:<dsh-web-port>` → 已安装 → 「看直播」这一行应该是「跑着」、无红色报错。
   命令行等价物（QQ 里发）：`/看直播 自检`。

## 4. 设置项（写在 `config.json` 的 `ext.kanzhibo`）

| key | 类型 | 默认 | 说明 |
|---|---|---|---|
| `enabled` | bool | false | 挂直播总开关 |
| `target` | string | '' | 直播间 `https://live.douyin.com/<id>` 或主播主页 `https://www.douyin.com/user/<sec_uid>` |
| `checkSec` | number | 120 | 检查间隔秒（30–1800），热生效 |
| `schedule` | bool | false | 只在时间段内挂 |
| `startTime` / `endTime` | string | 20:00 / 23:30 | 支持跨午夜 |
| `liveCommentOn` | bool | false | 启用进房评论 |
| `liveComment` | string | '' | 评论内容（多行只发第一行） |
| `commentDelaySec` | number | 8 | 进房后等几秒发 |
| `renewBadge` | bool | false | 进房后送灯牌 |
| `badgeDelaySec` | number | 30 | 进房后等几秒送（5–600） |
| `minuteReport` | bool | false | 进房时在 QQ 里说一声 |

改完**不用重载模块**：`api.settings()` 每次读最新的；只有 `checkSec` 那条走的是定时器，模块已经做了热更新。
需要写配置时用插件自己的接口（`api.saveSettings`），不要直接改 `config.json`——插件会把内存里的配置写回去覆盖你。

## 5. 运行时前提

- 装有 Edge 或 Chrome。查找顺序：`Program Files (x86)\Microsoft\Edge\…` → `Program Files\Microsoft\Edge\…` → Chrome 两个路径。
  别的路径要自己改 `index.mjs` 顶部的 `BROWSERS`。
- Node 22+（要全局 `WebSocket`；插件的运行时满足）。
- 插件 >= 1.2.0（扩展接口 v1）。
- 能访问 `live.douyin.com`。
- **首次要手动登录**：专用 profile 在 `plugins-data/aurabot/modules-data/kanzhibo/live-profile/`，
  是空账号。第一次进房后在那个窗口里扫码登录，之后一直有效。没登录也能进房看，但发评论/送灯牌/送礼会失败。

## 6. 声明了什么权限（`module.json` 的 `capabilities`）

`network`（fetch/CDP）、`filesystem`（`api.dataDir()` 下写 profile 和 state.json）、
`process`（spawn 浏览器）、`plugin-config`（读写 `douyin.enabled`）、`plugin-internals`（`api.core.hub.turnHasOwner`）。
不是沙箱声明，是给面板提示用户用的。

## 7. 代码地图（要改功能先看这张表）

| 位置（`index.mjs`） | 作用 |
|---|---|
| `BROWSERS` / `findBrowser()` | 浏览器路径候选 |
| `class Cdp` | 极简 CDP 客户端：`connect` / `send` / `close`，20 秒超时 |
| `launch()` / `attach()` / `closeBrowser()` | 起浏览器（独立 profile + `--remote-debugging-port`）、连上、真关掉 |
| `ensureInRoom()` | 判定目标类型（直播间 / 主播主页 / 任意 URL），已在同一直播间就不刷新 |
| `waitRoomReady()` | 等评论框出现，最多 30 秒 |
| `sendComment()` | 点框 → `Input.insertText` → 点发送/回车 → 回读验证 |
| `badgeSent()` / `renewBadge()` | 灯牌「今天送过没」的判定 / 真去点 |
| `openGiftPanel()` / `sendGift()` / `verifyGiftSent()` | 送礼链路，含余额与成功提示的确认 |
| `clickBy()` | 用真实鼠标事件点元素（直播间的面板按坐标判定，`el.click()` 常无效） |
| `pauseDouyin()` / `resumeDouyin()` | 和刷抖音互斥，暂停状态落 `state.json` |
| `tick()` | 定时主循环：关浏览器 / 进房 / 暂停刷抖音 / 评论 / 灯牌 |
| `stopNow()` / `selfCheck()` / `statusLine()` | 收工、体检单、一句话状态 |
| `api.tool(...)` | 5 个给模型用的工具 |
| `api.command({ name: '看直播' })` | `/看直播 开|关|状态|进|收工|自检` |
| `api.route('/status' \| '/selfcheck')` | `GET /aurabot/api/ext/kanzhibo/...` |

改代码时守住三条：
1. **不要**在 `setup()` 里读一次配置存着——用 `api.settings()` 现读。
2. 新增定时器必须能停：`onDispose` 里清掉（模块停了之后 `api.setConfig` 会抛错）。
3. 判定「页面元素」一律给长度上限 + 区域限制 + 面积排序，否则会点到导航栏（0.3.0 修的就是这个）。

## 8. 别做的事

- 不要改 `douyin` 模块本体；暂停刷抖音只改那一个布尔值 `config.douyin.enabled`。
- 不要在 `verify/verify.mjs` 里发真消息、不要连真直播间（它只用假 api + 临时目录）。
- 不要把 `modules-data/`、`.aurabot-cache/`、`live-profile/` 提交进 git。
- 不要在没有主人明确说的句子里调用 `kanzhibo_gift`（送礼是真花钱，且无法撤回）。

## 9. 出问题先看这三个地方

1. `logs/aurabot-<日期>.log` 里 `[kanzhibo]` 开头的那几行（模块自己的日志，按 id 分类）。
2. `plugins-data/aurabot/modules-data/kanzhibo/state.json`（`pausedDouyin` / `commentedDay` / `badgeDay` 的真相）。
3. `/看直播 自检` 的体检单：CDP 通不通、时段在不在内、刷抖音是不是被暂停着。

## 10. 贴给代理的一段话（懒人版）

```
这是 Aurabot 的扩展模块 kanzhibo 0.3.0。请读仓库里的 AGENTS.md，然后：
1) 把 module/ 拷到 ~/.dsh/plugins-data/aurabot/modules/kanzhibo/（只碰这个目录）；
2) 等 5 秒，看 logs/aurabot-<日期>.log 有没有「模块「看直播」（自己写的）已启动」；
3) 在模块目录跑 node verify/verify.mjs，要 33 通过 / 0 失败；
4) 告诉我面板「已安装」页的报错，和 QQ 里 /看直播 自检 的输出。
不要改插件本体，不要改别的模块。
```
