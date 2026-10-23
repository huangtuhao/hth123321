# 本地自动化桥（Local Automation Bridge）

本地自动化桥是一个运行在当前 Windows 用户电脑上的轻量服务。它让受限的浏览器脚本在明确授权后，读写少量登记过的本地资源，也让 Codex、WorkBuddy 或普通本地脚本通过预先登记的任务能力，请求已打开的浏览器实时刷新数据。

它不属于某一个网站，也不属于某一个油猴插件。领星 FBA 导出只是第一个接入它的客户端。

## 它解决什么问题

- 浏览器脚本无法直接访问 `C:\数据`，可以通过桥读取配置、提交结构化数据或回传文件。
- 本地 AI 和脚本可以直接读取沉淀后的文件，不必理解浏览器、登录态或领星接口。
- 本地 AI 需要最新数据时，可以创建一个固定语义的浏览器任务；对应油猴插件领取任务、使用当前页面登录态执行，再把结果和业务数据交回桥。
- 每个浏览器客户端只获得登记过的资源权限，不能浏览整个硬盘。
- 老的领星 FBA 导出插件可继续使用 v1 接口，新功能统一使用 v2。

桥同时提供数据通道和受控的任务通道：

```text
沉淀数据：浏览器油猴插件 ──写入 Dataset / Artifact──> 本地业务数据目录 ──> AI

实时刷新：AI ──创建已登记任务──> 本地桥任务队列 ──领取──> 已打开的油猴插件
             <──任务状态/结果── 本地桥 <──提交数据并完成任务── 浏览器中的网站请求
```

本地工具本来就能安全访问文件时，不必为了“统一”而绕经 HTTP；桥主要服务于浏览器等无法直接访问本地文件的客户端。

任务通道也不是远程桌面：桥不能启动浏览器、打开页面或绕过登录。对应网站页面和油猴插件必须已经运行，任务才能被领取。

## v2 的资源模型

桥只暴露注册表中预先登记的资源，不接受任意磁盘路径。

| 资源 | 用途 | 典型操作 |
| --- | --- | --- |
| `dataset` | 浏览器采集后形成的结构化数据 | 写入 |
| `config` | 本地工具整理、浏览器读取的业务配置 | 读取；获得权限时可发布 |
| `artifact` | PDF、Excel、箱唛等文件 | 上传到指定文件桶 |
| `job capability` | 预先登记、固定语义的浏览器动作 | AI 创建/查询；指定浏览器客户端领取/完成 |
| `runtime presence` | 已登记浏览器功能的短期在线/运行状态 | 业务插件上报；公共状态中心只读汇总 |

`job capability` 不是任意远程调用。它必须在注册表中定义能力 ID、执行客户端、只读/写入风险、输入和结果大小、超时及权限。任务队列只保存短期的控制状态；可长期复用的业务结果仍应写入对应 Dataset、Config 或 Artifact。

当前首个 FBA capability 是单账号能力：同一桥实例和 `C:\数据\领星` 数据根只应对应一个领星账号。不同账号的多个浏览器 Profile 同时运行 worker 时，任务没有足够信息选择目标 Profile；账号绑定会防止覆盖已有数据，但可能使任务失败。多账号支持必须先设计目标账号路由和数据目录隔离。

接口探针只负责记录和保存脱敏请求证据，不领取任何 job。只有经过验证、在注册表中获得 `job:execute:<capability>` 权限的正式业务插件可以成为 worker。

客户端按 `clientId` 配置权限。例如，一个客户端可以只拥有 `fba_shipments` 的写权限和 `freight_channels` 的读权限。客户端名称本身不是密钥；真正的访问凭据由一次性配对码换取，并保存在当前用户的运行状态目录中。

当前建议的新油猴客户端 ID 为：

```text
userscript.lingxing.automation.v2
```

## 安全边界

服务有意保持“小而窄”：

- 仅监听 `127.0.0.1`，不向局域网或互联网开放。
- 每个 v2 客户端使用独立令牌和独立 ACL。
- v2 首次连接使用短时、一次性配对码；不要把配对码或令牌写进 Git。
- 文件名会经过校验，资源目标目录由注册表决定。
- 不提供“读取任意路径”“写入任意路径”或“执行任意 JavaScript/命令”的接口。
- 不接受由 AI 临时指定的领星 endpoint、HTTP payload 或网页 JavaScript；AI 只能创建注册表中已经存在的 capability。
- 新的 v2 令牌、配对码等运行状态与业务数据目录分离，不写进 `C:\数据`。
- 对用户账号有写入影响的网页动作仍由具体油猴插件控制，不会因为接入桥而自动获得授权。
- 只读刷新能力可以按登记策略自动领取；会改动网站状态的能力必须声明风险并要求显式确认，不能伪装成只读任务。

这套边界也意味着：新增网站或业务时，应新增具体客户端、资源和权限，而不是把现有客户端改成“什么都能做”。

## 默认目录

当前约定保留原有 FBA 数据位置：

```text
C:\数据\领星\FBA数据
```

通用共享配置和文件默认放在：

```text
C:\数据\业务自动化
```

桥启动时会在这里生成 `catalog.json` 和三份说明：

- `_说明\AI网页能力旁路-使用说明.md`：普通业务智能体的起点，说明何时在 MCP 能力不足时启用旁路；
- `_说明\本地自动化桥-技术接入说明.md`：真正开发、注册或调试浏览器客户端时使用；
- `_说明\本地自动化桥-AI接入说明.md`：为旧链接保留的兼容索引。

`catalog.json` 的 `start_here` 指向旁路使用说明，`guides` 给出两份正式文档；原有 `documentation` 字段继续保留。catalog 同时记录模块、CLI、注册表、SDK、示例、`job_capabilities` 和 `job_queue` 调用提示，其他本地 AI 可以从这里发现资源与实时刷新入口，不需要扫描整个磁盘，也不需要接触桥的令牌。

实际子目录由资源注册表决定。客户端只能使用资源 ID，不能把上述目录或其他绝对路径作为请求参数。

新的 v2 令牌、一次性配对码及其他运行状态放在当前 Windows 用户的应用状态目录。为保证旧 FBA 插件和旧桥可回滚，历史 v1 令牌文件可能暂时保留在 `C:\数据\领星\_config`；新功能不得使用它，其他 AI 也不应读取它。旧桥正式退役后再单独清理该兼容文件。

## HTTP 接口

服务协议分为两层：

### v1 兼容层

仅用于现有领星 FBA 插件：

- `GET /health`
- `POST /v1/pair`
- `POST /v1/ingest`

旧客户端请求头和确认响应继续兼容。现有 FBA 插件仍用 v1 配对和数据提交，但它的任务 worker 使用下方 v2 job 接口，并由同一已登记客户端的 `job:execute` 权限约束。v1 不是新插件的通用接口；不要基于 v1 开发新功能。

### v2 通用层

- `POST /v2/pair`：用一次性配对码换取客户端令牌。
- `GET /v2/capabilities`：返回当前客户端被允许访问的资源和操作。
- `POST /v2/datasets/{id}/ingest`：提交指定数据集。
- `GET /v2/configs/{id}`：读取指定配置。
- `PUT /v2/configs/{id}`：发布指定配置，仅对获得写权限的客户端开放。
- `POST /v2/artifacts/{bucket}?filename=...`：上传文件到指定文件桶。
- `GET /v2/job-capabilities`：列出当前客户端可见的任务能力。
- `POST /v2/jobs`：创建已登记能力的任务。
- `POST /v2/jobs/claim`：浏览器长轮询领取自己有权执行的任务。
- `GET /v2/jobs/{id}`：读取任务状态。
- `POST /v2/jobs/{id}/progress`：执行客户端续约并报告进度。
- `POST /v2/jobs/{id}/complete`：执行客户端提交成功或失败结果。
- `POST /v2/runtime/heartbeat`：业务客户端上报当前标签页的 `idle / running / error` 状态。
- `GET /v2/runtime/status`：拥有 `runtime:read` 权限的公共状态中心读取按客户端聚合的明细。

`GET /health` 还包含不需要令牌的 `runtime_summary`，只给出在线功能数、页面实例数、运行中和异常数量，不暴露客户端名称或明细。

除健康检查和配对外，v2 请求使用：

```http
X-Local-Bridge-Client: <clientId>
Authorization: Bearer <clientToken>
```

客户端启动后应先读取 `capabilities`，不要假设某个资源一定存在或自己拼接本地路径。

### 公共状态中心与心跳

“领星ERP-接口探针”同时承担领星页面内的公共状态中心。它平时显示一个可收起的小状态条，展开后读取 `GET /v2/runtime/status`；探针本身不作为业务功能上报，也不领取 job。

正式业务插件默认每 20 秒发送一次心跳，桥在 90 秒没有收到心跳后自动判定该实例离线。请求体严格只允许：

```json
{
  "instance_id": "每个标签页独立的安全标识",
  "state": "idle",
  "version": "1.0.0",
  "message": "已加载，等待任务"
}
```

插件不得在心跳中提交客户端名称、capability、账号、页面 URL、请求参数或 `current_job_id`。客户端身份和能力来自认证令牌与注册表；当前 job 来自桥端的 claim/progress/complete 记录。多个标签页会保留为多个实例，但状态中心按 `client_id` 聚合为一个逻辑功能：任一实例运行时显示“运行中”，否则异常优先于空闲。

升级状态中心不会自动修改既有业务脚本。旧插件若要出现在状态中心，需要各自做一次兼容更新；数据采集和任务逻辑无需重写。当前领星功能模板已经内置心跳，新插件按模板开发即可自动兼容。

## 由 AI 实时刷新浏览器数据

从 `catalog.json` 取得实际 `cli_path` 后，先列出已登记能力：

```powershell
node bridge-cli.cjs job list-capabilities
```

例如，首个只读能力用于刷新领星 FBA 货件数据：

```powershell
node bridge-cli.cjs job run lingxing.fba_shipments.refresh --wait
```

该能力不接受输入，不修改领星业务状态，也不需要 `--confirm`；默认 TTL 为 600 秒。成功结果包含 `run_id`、`account_key`、采集/桥提交时间、`dataset_path`、记录数和变化摘要。

`--wait` 表示 CLI 等待终态并输出最终任务 JSON。命令成功只说明该任务进入 `succeeded`；业务智能体随后仍应读取 `C:\数据\领星\manifest.json`，确认 `datasets.fba_shipments.state` 为 `success`，再读取其中 `snapshot` 指向的正式数据。若不等待，可使用返回的任务 ID 查询：

```powershell
node bridge-cli.cjs job status <job-id>
```

运行前提：

- 本地桥健康；
- Chrome 或其他安装了油猴脚本的浏览器正在运行；
- 至少一个匹配页面已打开并保持合法登录；
- 对应正式业务插件已启用、完成桥接配对，并包含该 capability 的 worker；
- 电脑没有休眠，页面请求客户端仍可用。

当前 FBA 增量导出助手沿用已登记的 v1 兼容客户端，会自动完成兼容配对，不需要另行生成 v2 配对码。以后新建的 v2 worker 仍应按各自说明使用一次性配对码。

桥和计划任务常驻并不等于浏览器常驻。如果没有 worker，任务会保持 `pending`，到 TTL 后成为 `expired`；如果页面登录失效或接口异常，任务会成为 `failed` 并返回结构化错误。此时应根据错误修复前提，不要循环创建相同任务。

## 安装与首次运行

本模块使用 Node.js，不需要安装 Web 服务器或数据库。

1. 保留完整模块目录，不要只复制单个 `bridge.cjs`。
2. 在模块目录运行注册表检查：

   ```powershell
   node bridge-cli.cjs registry check
   ```

3. 前台启动桥，先观察是否有配置或端口错误：

   ```powershell
   .\start-bridge.cmd
   ```

4. 在另一个终端验证状态：

   ```powershell
   node bridge-cli.cjs health
   ```

5. 确认健康检查正常后，运行：

   ```powershell
   .\install-background-task.cmd
   ```

   它会创建当前用户登录时触发的计划任务 `本地自动化桥`。安装完成后可关闭诊断窗口，再次执行 `health` 确认服务仍可访问。

如果 `32145` 端口已被旧桥占用，应先停止旧实例，再启动新桥。不要同时运行两个监听相同端口的实例。

## 后台运行与开机启动

前台执行 `node bridge.cjs` 时，关闭 CMD/PowerShell 窗口就会终止进程；这只适合调试。

正式使用应通过 `install-background-task.cmd` 安装 Windows 后台启动项。计划任务运行 `run-bridge-hidden.vbs`，它负责：

- 当前用户登录后自动启动；
- 隐藏控制台窗口；
- 进程意外退出约 60 秒后重新拉起；
- 始终从本模块目录启动。

安装或更新后台项后，用以下命令确认真正运行的是新服务：

```powershell
node bridge-cli.cjs health
```

若健康检查失败，先检查端口占用、Node.js 路径和后台任务的工作目录。不要通过关闭安全软件来解决启动问题；启动脚本应保持可读、可审计，不下载或执行网络代码。

## 客户端配对

为某个已登记客户端生成一次性配对码：

```powershell
node bridge-cli.cjs client pair-code <clientId>
```

把配对码输入对应插件的配对界面。配对成功后，插件保存返回的令牌；配对码随即失效。不要把令牌硬编码到用户脚本，也不要把令牌发给其他客户端共用。

## 配置管理

本地 AI 或脚本可以直接维护业务文件；需要统一校验和发布时，使用 CLI：

```powershell
node bridge-cli.cjs config list
node bridge-cli.cjs config get <id>
node bridge-cli.cjs config publish <id> <json-file>
```

`config publish` 只接受注册表中存在的配置 ID，并应以原子方式写入。浏览器端只有在 ACL 明确授予写权限时，才能使用 `PUT /v2/configs/{id}`。

## 更新与兼容

- 更新桥之前先运行测试和 `registry check`。
- 保留现有 `C:\数据\领星\FBA数据`，不要为了升级桥迁移或重写历史快照。
- 旧 FBA 插件可继续走 v1；新插件统一使用 v2。
- 需要被公共状态中心发现的既有业务插件，各自补一次 runtime heartbeat；不更新仍可保留原业务能力，只是状态不会完整显示。
- 切换后台任务后再次运行 `health`，并实际执行一次 FBA 导出确认兼容链路。
- 回滚时恢复旧后台启动目标即可；不要删除业务数据。

## 给 AI 或开发者的下一步

普通业务智能体应先阅读 [AI网页能力旁路-使用说明.md](AI网页能力旁路-使用说明.md)。它负责判断：优先使用已有 MCP；能力缺失时先检查现有本地数据和适配器；仍缺失时再向用户索取 HAR 或请求样本，并在旁路打通后回到原任务。

只有确认需要生成、修改或调试油猴插件时，才继续阅读 [本地自动化桥-技术接入说明.md](本地自动化桥-技术接入说明.md)。旧的 [AI接入说明.md](AI接入说明.md) 仅作为兼容索引保留。

可复制的 v2 客户端封装位于 [sdk/bridge-client.js](sdk/bridge-client.js)，最小油猴骨架位于 [examples/userscript-template.user.js](examples/userscript-template.user.js)。模板中的站点、客户端 ID 和资源 ID 都是故意保留的占位符，使用前必须按具体功能缩小权限并替换。
