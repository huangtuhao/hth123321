# 领星本地数据桥

这是一个零第三方依赖的本机 HTTP 服务。油猴脚本负责使用当前领星登录状态抓取数据，本地桥负责把完整快照和增量结果安全地写到 `C:\数据\领星`，供 Codex 或其他本地工具读取。

当前白名单中只有 `fba_shipments`。客户端不能指定文件夹或文件名，因此无法借接口写入任意磁盘位置。

## 启动

需要 Node.js 20 或更高版本；不需要运行 `npm install`。

双击：

```text
start-bridge.cmd
```

也可以在终端运行：

```text
node .\bridge.cjs
```

启动脚本会打开一个持续可见的 Node 控制台，运行状态直接显示在窗口中；关闭窗口或按 `Ctrl+C` 即停止。它不会隐藏运行，也不会调用 PowerShell。默认只监听 `127.0.0.1:32145`，不会监听局域网网卡。首次启动会创建：

```text
C:\数据\领星\_config\bridge-token.txt
```

配套的 v1.1.0 及以上油猴脚本会通过受限的 `/v1/pair` 接口自动配对，并把令牌保存在油猴私有存储中，不需要手工复制。令牌不要上传到 GitHub，也不要写入公开仓库。

健康检查不需要令牌：

```text
http://127.0.0.1:32145/health
```

## 配对和写入接口

自动配对：

```text
POST http://127.0.0.1:32145/v1/pair
X-LingXing-Bridge-Client: lingxing-tampermonkey-v1
```

本地桥不返回 CORS 授权，普通网页无法跨域读取配对令牌；油猴使用 `GM_xmlhttpRequest` 完成配对。

写入：

```text
POST http://127.0.0.1:32145/v1/ingest
Content-Type: application/json
X-LingXing-Bridge-Token: <bridge-token.txt 中的内容>
```

第一版的固定契约如下：

```json
{
  "schema_version": 1,
  "dataset": "fba_shipments",
  "account_key": "company:901595888601981952:user:10859312",
  "run_id": "20261014T090000-01234567",
  "collected_at": "2026-10-14T09:00:00+08:00",
  "export": {
    "run_id": "20261014T090000-01234567",
    "account_key": "company:901595888601981952:user:10859312",
    "completed_at": "2026-10-14T09:00:00+08:00",
    "export_type": "delta",
    "source": {
      "unique_total": 1
    },
    "summary": {
      "added": 2,
      "updated": 1,
      "removed": 0,
      "pending_missing": 0,
      "baseline_records_after": 1
    },
    "changes": []
  },
  "snapshot": {
    "semantics": "confirmed_next_baseline",
    "record_count": 1,
    "source_record_count": 1,
    "pending_missing": 0,
    "source": {
      "endpoint": "/api/fba_shipment/showShipment_v2",
      "page_size": 500
    },
    "records": [
      {
        "_record_key": "id:123456",
        "id": 123456,
        "shipment_id": "FBA123456"
      }
    ]
  }
}
```

要求：

- `dataset` 目前必须是 `fba_shipments`。
- `account_key` 是油猴为当前领星公司/用户生成的稳定、不透明账号标识。同一数据目录首次写入后即绑定该值；其他账号写入会收到 HTTP 409，避免多账号数据互相覆盖。
- `export.export_type` 必须是 `baseline` 或 `delta`。为便于兼容，也接受 `export.type`、`export.kind` 或 `export.mode`，但新代码应使用 `export_type`。
- 外层与 `export` 中的 `run_id`、`account_key`、完成时间必须一致；快照数量也必须与 `export.summary` 和 `export.source.unique_total` 互相吻合。
- `export` 保存本次原始基线/增量输出。
- `snapshot.records` 必须是油猴差异计算完成后的“下一版确认基线”，不能直接使用接口本次原始列表，也不能只放变化记录。每条记录必须带唯一且稳定的 `_record_key`。
- 第一次从接口消失、尚未确认删除的记录仍应保留在 `snapshot.records`；连续两次缺失并产生 `remove` 事件后才移出。这样 `latest.json` 与 `changes` 中的增量事件严格一致。
- 如果提供 `snapshot.record_count`，它必须与数组长度一致。
- `snapshot.source_record_count` 是本次接口实际返回的记录数；`snapshot.pending_missing` 是首次缺失、仍保留在确认基线中的记录数。
- 单次请求默认最大 128 MiB。
- 同一个 `run_id` 的网络重试必须原样重发完全相同的 JSON 字节；本地桥会用 SHA-256 做幂等校验。

油猴建议使用 `GM_xmlhttpRequest`，并声明：

```javascript
// @grant   GM_xmlhttpRequest
// @connect 127.0.0.1
```

发送示意：

```javascript
GM_xmlhttpRequest({
  method: 'POST',
  url: 'http://127.0.0.1:32145/v1/ingest',
  headers: {
    'Content-Type': 'application/json',
    'X-LingXing-Bridge-Token': bridgeToken,
  },
  data: JSON.stringify(payload),
  timeout: 120000,
  onload(response) {
    if (response.status !== 200 && response.status !== 201) {
      throw new Error(`本地桥写入失败：HTTP ${response.status}`);
    }
  },
});
```

## 输出结构

一次成功写入后：

```text
C:\数据\领星\
├─ manifest.json
├─ _config\
│  └─ bridge-token.txt
└─ FBA数据\
   ├─ latest.json
   ├─ status.json
   ├─ snapshots\
   │  └─ 20261014-090000-123-a1b2c3d4.json
   └─ changes\
      └─ 20261014-090000-123-delta-a1b2c3d4.json
```

- `latest.json`：最新完整快照的便捷镜像，适合人工查看。
- `snapshots/*.json`：每次成功提交的不可变完整快照；严谨读取时先看 `manifest.json` 指向的快照。
- `changes/*.json`：每次油猴产生的基线或增量输出，作为历史记录。
- `status.json`：该数据集最近一次成功写入状态、数量和 SHA-256。
- `manifest.json`：所有数据集的统一索引；它总是最后写入，可视为这一批文件写完的提交标志。Codex 自动分析必须先读取它，再读取其中指向的不可变 `snapshot`；不要把单独出现的新 `latest.json` 当成已提交批次。

每个 JSON 文件都先写入同目录的唯一临时文件、同步到磁盘，再通过重命名替换目标。所有写入请求在进程内串行执行，避免并发请求相互覆盖。

## 可选配置

可在启动前设置环境变量：

| 环境变量 | 默认值 | 说明 |
|---|---:|---|
| `LINGXING_BRIDGE_ROOT` | `C:\数据\领星` | 数据根目录 |
| `LINGXING_BRIDGE_PORT` | `32145` | 本机端口 |
| `LINGXING_BRIDGE_MAX_BYTES` | `134217728` | 请求体最大字节数 |
| `LINGXING_BRIDGE_TOKEN` | 首次自动生成 | 至少 24 字符；设置后不读取令牌文件内容 |

监听地址不能配置为其他网卡，始终固定为 `127.0.0.1`。

命令提示符示例：

```text
set "LINGXING_BRIDGE_ROOT=D:\领星数据"
node .\bridge.cjs
```

## 自测

```text
node --test .\bridge.test.cjs
```
