# 本地自动化桥：AI 接入说明

这份文档给 Codex、WorkBuddy 和其他需要生成客户端、发布配置或分析本地数据的智能体使用。

## 最重要的判断

先判断自己是否已经能访问本地文件：

- **能访问本地文件**：直接读取或写入登记好的业务目录；需要统一校验、原子发布时使用 `bridge-cli.cjs`。
- **不能访问本地文件，但运行在浏览器中**：通过本地桥的 v2 API 使用已授权资源。
- **需要分析 FBA 数据**：直接读取 `C:\数据\领星` 下的清单与快照；不要驱动浏览器重新抓取，除非用户明确要求刷新数据。

桥不是 MCP，也不是所有工具都必须经过的总线。它是浏览器等受限客户端进入本地资源的受控入口。本地文件才是跨工具共享、可长期保存的事实来源。

## 当前资源位置

| 内容 | 默认位置 | 读取原则 |
| --- | --- | --- |
| 领星 FBA 数据 | `C:\数据\领星\FBA数据` | 先看 `C:\数据\领星\manifest.json` |
| 通用共享配置和文件 | `C:\数据\业务自动化` | 先看 `catalog.json` 和 `_说明`，不猜子目录 |
| 桥运行状态和 v2 令牌 | 当前用户的应用状态目录 | 不读取、不展示、不上传 |

不要递归扫描整个 `C:\数据` 来猜资源，也不要读取桥的令牌或配对状态。为了兼容和回滚，旧系统的 `C:\数据\领星\_config\bridge-token.txt` 可能暂时仍在；它属于秘密文件，不是业务数据源。

`C:\数据\业务自动化\catalog.json` 会给出当前机器上的 `cli_path`、`registry_path`、`sdk_path` 和已登记资源路径。需要执行 CLI 时应读取这些字段，不要假定模块安装在固定代码目录。

## 资源类型

v2 将可访问内容分成三类：

### Dataset

浏览器或其他采集端提交的结构化数据。每个数据集有固定 ID、适配器、目标位置、大小限制和允许写入的客户端。

现有 FBA 数据集 ID：

```text
fba_shipments
```

FBA 的快照、增量和清单格式继续沿用现有实现。分析时以 `manifest.json` 中 `datasets.fba_shipments` 的成功记录为入口，不以目录修改时间猜测最新文件。

### Config

供客户端读取的版本化 JSON 业务配置，例如货代渠道报价、命名规则或店铺映射。

- 本地工具可直接生成源 JSON，再用 CLI 发布。
- 浏览器客户端通常只有读权限。
- 只有 ACL 明确允许时，浏览器客户端才能发布配置。
- 配置 ID 与磁盘路径是两回事；客户端只应知道 ID。

### Artifact

浏览器产生的非结构化或半结构化文件，例如箱唛、发票、Excel 或 PDF。上传时使用登记好的文件桶 ID；文件名由客户端建议，最终路径和清理规则由桥决定。

artifact 不是任意文件系统写接口。客户端不能提交目录路径，也不能覆盖桶外文件。

## AI 读取 FBA 数据

需要当前完整数据时：

1. 读取 `C:\数据\领星\manifest.json`。
2. 找到 `datasets.fba_shipments`。
3. 只有 `state` 为 `success` 时才把它视为完整可用结果。
4. 打开其 `snapshot` 指向的文件。
5. 使用快照中的 `records` 数组完成分析，并用 `record_count` 核对数量。

需要最近一次变化时，读取 `datasets.fba_shipments.last_change`：

- `export.kind = baseline` 表示首次比较基线，不等于“本次全部新增”。
- `export.kind = delta` 时，使用 `export.changes`。
- `op = add`：完整新记录在 `current`。
- `op = update`：新记录在 `current`，字段差异在 `changed_fields` / `field_changes`。
- `op = remove`：旧记录在 `previous`。

不要修改或删除清单、快照与增量文件。如果状态失败或数据明显过旧，应明确告诉用户数据未成功刷新。

## AI 发布配置

推荐流程：

1. 先确定注册表中已有的配置 ID 和约定结构。
2. 从业务来源生成一个独立 JSON 文件。
3. 在发布前做字段、类型、时间和来源校验。
4. 使用 CLI 发布：

   ```powershell
   node bridge-cli.cjs config publish <id> <json-file>
   ```

5. 再读取一次已发布配置，核对版本、更新时间和关键数量。

可用命令：

```powershell
node bridge-cli.cjs config list
node bridge-cli.cjs config get <id>
node bridge-cli.cjs registry check
```

不要为了临时功能新建一个“万能配置”或把密钥、Cookie、登录令牌写入业务配置。新增配置资源时，应同时定义用途、JSON 结构、生产者、消费者和最小权限。

## 生成新的油猴客户端

新脚本统一使用 v2，建议客户端 ID 使用稳定、带命名空间的名称，例如：

```text
userscript.lingxing.automation.v2
userscript.example.invoice-export.v1
```

优先复用模块内的 `sdk/bridge-client.js` 和 `examples/userscript-template.user.js`，把客户端封装源码内嵌进最终用户脚本；不要通过远程 `@require` 动态加载。

生成脚本时必须做到：

1. `@match` 只覆盖实际业务网站，不使用全站通配符。
2. `@connect` 只允许 `127.0.0.1`（以及确有需要的本地桥地址）。
3. 使用 `GM_xmlhttpRequest` 或等价的油猴跨域能力访问本地桥。
4. 首次由用户输入一次性配对码，调用 `POST /v2/pair`；不要内置配对码。
5. 把客户端令牌保存在该脚本自己的油猴存储中；不要写进页面 DOM、日志或业务文件。
6. 后续请求携带：

   ```http
   X-Local-Bridge-Client: <clientId>
   Authorization: Bearer <clientToken>
   ```

7. 启动或进入功能前调用 `GET /v2/capabilities`，只显示实际获得授权的功能。
8. 遇到 `401` / `403` 时停止敏感操作并提示重新配对或检查权限，不要循环猜测令牌。
9. 网络失败时不得假装已经写入；只有收到成功确认后才更新界面状态。
10. 对重复提交使用稳定的运行 ID 或幂等标识（当对应资源协议提供时）。

默认领星自动化客户端 ID 为：

```text
userscript.lingxing.automation.v2
```

不要把现有 v1 FBA 客户端当作新插件模板。v1 只用于兼容历史接口和响应校验。

## v2 接口速查

| 接口 | 作用 | 关键限制 |
| --- | --- | --- |
| `GET /health` | 检查本地服务 | 不代表某客户端拥有资源权限 |
| `POST /v2/pair` | 一次性配对 | 必须使用已登记客户端和有效配对码 |
| `GET /v2/capabilities` | 获取当前权限 | 客户端应以结果驱动界面和功能 |
| `POST /v2/datasets/{id}/ingest` | 写数据集 | 需该 dataset 的写权限并满足适配器校验 |
| `GET /v2/configs/{id}` | 读配置 | 需该 config 的读权限 |
| `PUT /v2/configs/{id}` | 发布配置 | 需该 config 的写权限；浏览器默认不应拥有 |
| `POST /v2/artifacts/{bucket}?filename=...` | 上传文件 | 需桶写权限；`filename` 必须 URL 编码 |

具体 JSON 载荷、大小限制和响应字段以当前版本的资源协议与 `capabilities` 为准。不要根据资源 ID 推测磁盘路径，也不要自行降级到 v1。

## 对既有 FBA 插件的兼容规则

现有插件可以继续调用：

- `GET /health`
- `POST /v1/pair`
- `POST /v1/ingest`

旧请求头和严格 ACK 校验由兼容层保留。重构桥时不得改变以下业务语义：

- FBA 数据仍落到 `C:\数据\领星\FBA数据`。
- 成功清单只能在完整写入后更新。
- 快照、增量、数量、哈希和运行 ID 仍需相互一致。
- 账号绑定与漏数保护仍由 FBA 适配器处理。

AI 在修改现有 FBA 插件前，应先确认修改是否真的需要迁移到 v2；没有业务收益时可继续使用兼容层。

## 明确禁止的设计

不要生成或建议以下能力：

- 接收 `C:\...` 路径并返回文件内容的通用接口；
- 接收路径并任意写文件或覆盖目录；
- 从 HTTP 请求执行 JavaScript、PowerShell、CMD 或其他命令；
- 让所有客户端共享一个永久令牌；
- 在油猴脚本源码、Git 仓库、日志或业务 JSON 中保存令牌；
- 让一个插件自动获得所有网站、所有配置和所有文件桶权限；
- 绕过网站自身登录权限或把浏览器 Cookie 上传给桥。

若新需求看起来必须突破这些边界，应停止实现并向用户解释风险，再设计更窄的资源或专用动作。

## 可直接交给智能体的提示词

### 分析当前 FBA 数据

> 请读取 `C:\数据\领星\manifest.json`，找到 `datasets.fba_shipments` 的最新成功快照并分析其中的 `records`。不要扫描或读取桥的运行状态、令牌或配对文件；如果快照状态失败或时间过旧，请明确说明。

### 生成配置

> 请先查看本地自动化桥注册表中 `<configId>` 的结构和用途，生成通过校验的 JSON 到临时文件，再用 `node bridge-cli.cjs config publish <configId> <json-file>` 发布并回读核对。不要在配置中写入账号 Cookie、访问令牌或其他密钥。

### 生成油猴插件

> 请为目标网站生成一个权限最小化的油猴脚本，使用本地自动化桥 v2。脚本必须使用独立 clientId、一次性配对、`GET /v2/capabilities`、独立令牌存储和明确的失败提示；只访问已登记的 dataset/config/artifact，不得请求任意路径或执行任意本地代码。
