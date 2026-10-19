# 领星数据：AI 读取说明

这份说明是给需要使用领星数据的智能体看的。不要研究桥接程序，也不要直接请求领星接口；按下面步骤读取本地 JSON 即可。

## 最短读取流程

1. 数据根目录是 `C:\数据\领星`。
2. 先读取 `C:\数据\领星\manifest.json`。
3. 在 `datasets` 中选择需要的数据集。目前 FBA 货件的数据集 ID 是 `fba_shipments`。
4. 只有数据集的 `state` 为 `success` 时，才把它当作一次完整、可用的采集结果。
5. 读取该数据集的 `snapshot` 字段。这个路径相对于数据根目录，例如：

   `C:\数据\领星` + `FBA数据/snapshots/xxxx.json`

6. 快照文件里的 `records` 数组，就是当前完整的 FBA 货件数据。日常查询和分析优先使用它。

一句话：**先读 `manifest.json`，再读 `datasets.fba_shipments.snapshot` 指向的文件，最后分析其中的 `records`。**

## 文件分别表示什么

- `manifest.json`：总入口，记录每个数据集最新一次成功采集的时间、状态、数量和文件位置。
- `FBA数据/snapshots/*.json`：每次成功采集后保存的不可变完整快照。
- `FBA数据/latest.json`：最新完整数据的便捷副本。可以人工查看，但自动分析优先使用 `manifest.json` 指向的 `snapshot`。
- `FBA数据/changes/*.json`：每次采集相对于上一次的变化。
- `FBA数据/status.json`：最近一次成功写入的状态、数量和文件位置；它不代表桥接进程此刻一定仍在运行。
- `_config`：桥接程序的私有配置。**不要读取、展示或上传这里的任何内容。**

## FBA 货件常用字段

每条货件记录都有 `_record_key` 作为稳定内部标识。常用业务字段包括：

| 字段 | 含义 |
| --- | --- |
| `shipment_id` | 亚马逊 FBA 货件编号 |
| `shipment_name` | 货件名称 |
| `seller` | 领星店铺/账号 |
| `destination_fulfillment_center_id` | 亚马逊目的仓代码 |
| `shipment_status` | 货件状态，如 `SHIPPED`、`CANCELLED` |
| `gmt_create` | 货件创建时间 |
| `total_quantity_shipped` | 发货总数量 |
| `last_success_box_count` | 最近成功提交的箱数 |
| `reference_id` | Reference ID |
| `item_list` | 货件内商品明细；常见子字段有 `sku`、`msku`、`fnsku`、`asin`、`local_name`、`quantity_shipped`、`quantity_received` |
| `tracking_number_list` | 跟踪号列表 |

其余字段保持领星接口原始命名。遇到未说明字段时，应结合实际值判断，不要只凭字段名猜测。

## 怎样读取“本次有哪些变化”

在 `manifest.json` 中读取 `datasets.fba_shipments.last_change`，再打开它指向的文件。先看 `export.kind`：

- `baseline`：第一次建立完整比较基线，完整记录位于 `export.records`；不能把这些记录解释成当天新增。
- `delta`：后续增量，变化位于：

`export.changes`

`delta` 中每条变化的 `op` 表示：

- `add`：新增货件，完整新记录在 `current`。
- `update`：货件有更新，完整新记录在 `current`；`changed_fields` 是变化字段名，`field_changes` 中有修改前后的值。
- `remove`：货件已确认从结果中消失，旧记录在 `previous`。

汇总数字位于 `export.summary`，包括 `added`、`updated`、`removed`、`unchanged` 和 `total_changes`。

如果要分析一段时间内的变化，应按文件名时间顺序读取 `FBA数据/changes` 中对应日期范围内的文件，并按 `run_id` 去重。

## 正确性规则

- `manifest.json` 是一次成功写入的最终标志；不要凭目录里“最新修改的文件”自行猜测最新数据。
- `updated_at`、`collected_at` 等带 `Z` 的时间是 UTC 时间；中国时间为 UTC+8。
- `record_count` 是当前快照记录数，可用来核对 `records.length`。
- 为避免接口偶发漏数，某条货件第一次缺失时会暂时保留；连续两次缺失后才产生 `remove`。不要把 `pending_missing` 直接当作已删除。
- 所有数据均只读。不要修改或删除 `manifest.json`、快照、增量和配置文件。
- 如果 `state` 不是 `success`，或数据时间明显过旧，应先告诉用户“数据尚未成功更新”，不要把旧数据说成实时数据。

## 可直接交给智能体的提示词

### 分析当前全部数据

> 请先读取 `C:\数据\领星\AI读取说明.md`，再按说明读取 `manifest.json` 中 `fba_shipments.snapshot` 指向的完整快照。以快照的 `records` 为准完成分析，不要读取 `_config`。

### 分析最近一次变化

> 请先读取 `C:\数据\领星\AI读取说明.md`，再读取 `manifest.json` 中 `fba_shipments.last_change` 指向的增量文件，说明本次新增、更新、删除了哪些货件以及关键字段变化。不要读取 `_config`。

### 分析某段时间的变化

> 请先读取 `C:\数据\领星\AI读取说明.md`。按时间顺序读取 `C:\数据\领星\FBA数据\changes` 中指定日期范围内的增量文件，按 `run_id` 去重后汇总变化；需要当前详情时，再读取 `manifest.json` 指向的快照。不要读取 `_config`。

以后增加新的领星数据时，也会登记到 `manifest.json` 的 `datasets` 中。智能体应优先按数据集自己的 `snapshot`、`last_change` 和 `state` 字段读取，而不是把路径写死。
