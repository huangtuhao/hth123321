// ==UserScript==
// @name         领星ERP-FBA货件数据增量导出助手
// @namespace    http://tampermonkey.net/
// @version      1.3.0
// @description  每日、手动或经本地数据桥任务触发抓取领星FBA货件，保存完整快照与增量数据。
// @author       Your Assistant & User
// @match        *://erp.lingxing.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      127.0.0.1
// ==/UserScript==

(function () {
  "use strict";

  const CONFIG = {
    VERSION: "1.3.0",
    SCHEMA_VERSION: "lingxing-fba-shipment-export/1",
    NORMALIZER_VERSION: 1,
    API_PATH: "/api/fba_shipment/showShipment_v2",
    PAGE_SIZE: 500,
    MAX_PAGES: 10000,
    QUERY_SCOPE: "all-shipments-v1",
    DEFAULT_SETTINGS: {
      autoEnabled: true,
      autoTime: "09:00",
    },
    SETTINGS_KEY: "LX_FBA_DELTA_SETTINGS_V1",
    STATUS_KEY: "LX_FBA_DELTA_STATUS_V1",
    LAST_ACCOUNT_KEY: "LX_FBA_DELTA_LAST_ACCOUNT_V1",
    LOCK_KEY: "LX_FBA_DELTA_EXPORT_LOCK_V1",
    DB_NAME: "LX_FBA_DELTA_EXPORT_DB_V1",
    DB_STORE: "kv",
    LOCK_TTL_MS: 15 * 60 * 1000,
    AUTO_RETRY_MS: 30 * 60 * 1000,
    CLIENT_WAIT_MS: 60 * 1000,
    BRIDGE_BASE_URL: "http://127.0.0.1:32145",
    BRIDGE_DATASET: "fba_shipments",
    BRIDGE_PROTOCOL_VERSION: 1,
    BRIDGE_CLIENT: "lingxing-tampermonkey-v1",
    BRIDGE_TOKEN_KEY: "LX_LOCAL_BRIDGE_TOKEN_V1",
    BRIDGE_TIMEOUT_MS: 120 * 1000,
    BRIDGE_HEALTH_TIMEOUT_MS: 5000,
    BRIDGE_EXPECTED_PATH: "C:\\数据\\领星\\FBA数据",
    BRIDGE_JOB_CAPABILITY: "lingxing.fba_shipments.refresh",
    BRIDGE_JOB_WORKER_KEY: "LX_FBA_DELTA_JOB_WORKER_ID_V1",
    BRIDGE_JOB_LEADER_KEY: "LX_FBA_DELTA_JOB_WORKER_LEADER_V1",
    BRIDGE_JOB_CLAIM_WAIT_MS: 25 * 1000,
    BRIDGE_JOB_REQUEST_TIMEOUT_MS: 40 * 1000,
    BRIDGE_JOB_PROGRESS_TIMEOUT_MS: 15 * 1000,
    BRIDGE_JOB_MIN_RUN_BUDGET_MS: 120 * 1000,
    BRIDGE_JOB_COMPLETION_RESERVE_MS: 35 * 1000,
    BRIDGE_JOB_LEADER_TTL_MS: 90 * 1000,
    BRIDGE_JOB_LEADER_HEARTBEAT_MS: 20 * 1000,
    BRIDGE_JOB_IDLE_RETRY_MS: 3000,
    BRIDGE_JOB_ERROR_RETRY_MAX_MS: 60 * 1000,
    BRIDGE_RUNTIME_HEARTBEAT_MS: 20 * 1000,
    BRIDGE_RUNTIME_HEARTBEAT_TIMEOUT_MS: 5000,
  };

  const META_ONLY_KEYS = new Set([
    "gmt_modified",
    "sync_time",
    "is_synchronous",
    "reference_update_num",
    "reference_sync_status",
  ]);

  const UNORDERED_ARRAY_KEYS = new Set([
    "item_list",
    "tracking_number_list",
    "date_info",
    "relate",
    "inbound_shipment_lists",
    "awd_error_msg_info",
  ]);

  const runtime = {
    running: false,
    nextAutoAttemptAt: 0,
    scheduler: null,
    initialized: false,
    menuRegistered: false,
    jobWorkerStarted: false,
    jobWorkerStopped: false,
    jobWorkerId: "",
    jobWorkerTabId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    jobWorkerLeader: false,
    jobWorkerLeaderHeartbeat: null,
    activeBridgeJobId: "",
    runtimeHeartbeatTimer: null,
    runtimeHeartbeatInFlight: false,
    runtimeHeartbeatPending: false,
    runtimeHeartbeatLastWarningAt: 0,
    runtimeHeartbeatState: "idle",
    runtimeHeartbeatMessage: "已加载，等待任务",
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const pad2 = (value) => String(value).padStart(2, "0");

  function localDay(date = new Date()) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function localTimestamp(date = new Date()) {
    return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
  }

  function formatDisplayTime(value) {
    if (!value) return "从未";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("zh-CN", { hour12: false });
  }

  function makeRunId() {
    const random = Math.random().toString(36).slice(2, 7);
    return `${localTimestamp()}-${random}`;
  }

  function sanitizeFilename(name) {
    return String(name)
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
  }

  function getPageDocument() {
    try {
      return typeof unsafeWindow !== "undefined" ? unsafeWindow.document : document;
    } catch (_) {
      return document;
    }
  }

  function getPageWindow() {
    try {
      return typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    } catch (_) {
      return window;
    }
  }

  // -----------------------------------------------------------------------------
  // IndexedDB：完整基线可能逐渐增大，不放进 GM_setValue。
  // -----------------------------------------------------------------------------
  const DB = {
    _promise: null,

    open() {
      if (this._promise) return this._promise;
      this._promise = new Promise((resolve, reject) => {
        const request = indexedDB.open(CONFIG.DB_NAME, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(CONFIG.DB_STORE)) {
            db.createObjectStore(CONFIG.DB_STORE, { keyPath: "key" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("无法打开 IndexedDB"));
        request.onblocked = () => reject(new Error("IndexedDB 被其他页面阻塞，请关闭多余的领星页面后重试"));
      });
      return this._promise;
    },

    async get(key) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(CONFIG.DB_STORE, "readonly");
        const request = tx.objectStore(CONFIG.DB_STORE).get(key);
        request.onsuccess = () => resolve(request.result?.value ?? null);
        request.onerror = () => reject(request.error || new Error("读取本地基线失败"));
      });
    },

    async put(key, value) {
      return this.putMany([{ key, value }]);
    },

    async putMany(entries, deleteKeys = []) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(CONFIG.DB_STORE, "readwrite");
        const store = tx.objectStore(CONFIG.DB_STORE);
        entries.forEach((entry) => store.put(entry));
        deleteKeys.forEach((key) => store.delete(key));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("写入本地基线失败"));
        tx.onabort = () => reject(tx.error || new Error("写入本地基线已中止"));
      });
    },
  };

  async function getSettings() {
    const saved = (await GM_getValue(CONFIG.SETTINGS_KEY, {})) || {};
    const autoTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(saved.autoTime || ""))
      ? String(saved.autoTime)
      : CONFIG.DEFAULT_SETTINGS.autoTime;
    return {
      autoEnabled:
        typeof saved.autoEnabled === "boolean"
          ? saved.autoEnabled
          : CONFIG.DEFAULT_SETTINGS.autoEnabled,
      autoTime,
    };
  }

  async function saveStatus(patch) {
    const current = (await GM_getValue(CONFIG.STATUS_KEY, {})) || {};
    const next = { ...current, ...patch };
    await GM_setValue(CONFIG.STATUS_KEY, next);
    return next;
  }

  // -----------------------------------------------------------------------------
  // 本地数据桥：仅连接固定的 127.0.0.1 服务。服务端决定实际保存路径，
  // 脚本不会接受或传递任意磁盘路径。只有严格校验写入 ACK 后才允许推进基线。
  // -----------------------------------------------------------------------------
  function bridgeError(message, details = {}) {
    const error = new Error(message);
    error.code = details.code || "BRIDGE_ERROR";
    if (details.status !== undefined) error.httpStatus = details.status;
    if (details.cause) error.cause = details.cause;
    return error;
  }

  function bridgeRequest(method, path, { body, headers = {}, timeout = CONFIG.BRIDGE_TIMEOUT_MS } = {}) {
    if (typeof GM_xmlhttpRequest !== "function") {
      return Promise.reject(bridgeError("当前油猴环境不支持 GM_xmlhttpRequest，无法连接本地数据桥"));
    }

    const url = `${CONFIG.BRIDGE_BASE_URL}${path}`;
    return new Promise((resolve, reject) => {
      const options = {
        method,
        url,
        timeout,
        headers: {
          Accept: "application/json",
          "X-LingXing-Bridge-Client": CONFIG.BRIDGE_CLIENT,
          ...headers,
        },
        onload: (response) => {
          let payload = null;
          try {
            payload = response.responseText ? JSON.parse(response.responseText) : {};
          } catch (error) {
            reject(
              bridgeError(`本地数据桥返回了无效 JSON（HTTP ${response.status || 0}）`, {
                status: response.status,
                cause: error,
              }),
            );
            return;
          }

          if (response.status < 200 || response.status >= 300) {
            const remoteCode =
              typeof payload?.error?.code === "string" ? payload.error.code : "BRIDGE_HTTP_ERROR";
            const recoveryHint =
              {
                ACCOUNT_MISMATCH: "当前目录已绑定到另一个领星账号，请确认登录账号或为不同账号使用独立数据目录",
                LINEAGE_MISMATCH: "本地版本链与浏览器待交付任务不一致，请先核对 manifest.json 与 status.json",
                RUN_ID_CONFLICT: "相同运行编号已有不同内容，请保留待交付任务并人工核对本地数据",
                PAYLOAD_TOO_LARGE: "数据超过本地桥限制，需要提高 LINGXING_BRIDGE_MAX_BYTES 后重启数据桥",
              }[remoteCode] || "";
            const detail =
              payload?.error?.message ||
              payload?.message ||
              (typeof payload?.error === "string" ? payload.error : "") ||
              `HTTP ${response.status || 0}`;
            reject(
              bridgeError(
                `本地数据桥请求失败（${remoteCode}）：${detail}${recoveryHint ? `。${recoveryHint}` : ""}`,
                {
                  code: remoteCode,
                status: response.status,
                },
              ),
            );
            return;
          }
          resolve(payload);
        },
        onerror: () => reject(bridgeError(`无法连接本地数据桥 ${CONFIG.BRIDGE_BASE_URL}`)),
        ontimeout: () => reject(bridgeError("本地数据桥请求超时")),
        onabort: () => reject(bridgeError("本地数据桥请求已中止")),
      };

      if (body !== undefined) {
        options.data = typeof body === "string" ? body : JSON.stringify(body);
        options.headers["Content-Type"] = "application/json;charset=UTF-8";
      }
      GM_xmlhttpRequest(options);
    });
  }

  async function getBridgeToken({ forcePair = false } = {}) {
    if (!forcePair) {
      const savedToken = String((await GM_getValue(CONFIG.BRIDGE_TOKEN_KEY, "")) || "").trim();
      if (savedToken) return savedToken;
    }

    const result = await bridgeRequest("POST", "/v1/pair", {
      body: {
        protocol_version: CONFIG.BRIDGE_PROTOCOL_VERSION,
        client: CONFIG.BRIDGE_CLIENT,
      },
      timeout: CONFIG.BRIDGE_HEALTH_TIMEOUT_MS,
    });
    if (
      result?.ok !== true ||
      Number(result?.protocol_version) !== CONFIG.BRIDGE_PROTOCOL_VERSION ||
      typeof result?.token !== "string" ||
      !result.token.trim()
    ) {
      throw bridgeError("本地数据桥配对响应不完整，未取得有效令牌");
    }

    const token = result.token.trim();
    await GM_setValue(CONFIG.BRIDGE_TOKEN_KEY, token);
    return token;
  }

  async function authorizedBridgeRequest(method, path, options = {}) {
    let token = await getBridgeToken();
    const request = () =>
      bridgeRequest(method, path, {
        ...options,
        headers: {
          ...(options.headers || {}),
          "X-LingXing-Bridge-Token": token,
        },
      });
    try {
      return await request();
    } catch (error) {
      if (![401, 403].includes(Number(error?.httpStatus))) throw error;
      await GM_setValue(CONFIG.BRIDGE_TOKEN_KEY, "");
      token = await getBridgeToken({ forcePair: true });
      return request();
    }
  }

  function runtimeHeartbeatPayload() {
    const payload = {
      instance_id: `fba-${runtime.jobWorkerTabId}`,
      version: CONFIG.VERSION,
      state: runtime.runtimeHeartbeatState,
    };
    const message = String(runtime.runtimeHeartbeatMessage || "")
      .replace(/[\x00-\x1f\x7f]+/g, " ")
      .trim()
      .slice(0, 300);
    if (message) payload.message = message;
    return payload;
  }

  async function sendRuntimeHeartbeat() {
    if (runtime.jobWorkerStopped) return;
    if (runtime.runtimeHeartbeatInFlight) {
      runtime.runtimeHeartbeatPending = true;
      return;
    }
    runtime.runtimeHeartbeatInFlight = true;
    try {
      await authorizedBridgeRequest("POST", "/v2/runtime/heartbeat", {
        body: runtimeHeartbeatPayload(),
        timeout: CONFIG.BRIDGE_RUNTIME_HEARTBEAT_TIMEOUT_MS,
      });
      runtime.runtimeHeartbeatLastWarningAt = 0;
    } catch (error) {
      const now = Date.now();
      if (now - runtime.runtimeHeartbeatLastWarningAt >= 60 * 1000) {
        runtime.runtimeHeartbeatLastWarningAt = now;
        console.warn("[领星FBA增量导出] 无法上报运行状态，将自动重试", error);
      }
    } finally {
      runtime.runtimeHeartbeatInFlight = false;
      if (runtime.runtimeHeartbeatPending && !runtime.jobWorkerStopped) {
        runtime.runtimeHeartbeatPending = false;
        void sendRuntimeHeartbeat();
      }
    }
  }

  function requestRuntimeHeartbeat() {
    Promise.resolve(sendRuntimeHeartbeat()).catch((error) => {
      console.warn("[领星FBA增量导出] 运行状态上报异常", error);
    });
  }

  function setRuntimeHeartbeatState(state, message = "") {
    if (!["idle", "running", "error"].includes(state)) return;
    runtime.runtimeHeartbeatState = state;
    runtime.runtimeHeartbeatMessage = String(message || "");
    requestRuntimeHeartbeat();
  }

  function startRuntimeHeartbeat() {
    if (runtime.runtimeHeartbeatTimer) return;
    requestRuntimeHeartbeat();
    runtime.runtimeHeartbeatTimer = setInterval(
      requestRuntimeHeartbeat,
      CONFIG.BRIDGE_RUNTIME_HEARTBEAT_MS,
    );
    window.addEventListener(
      "beforeunload",
      () => {
        if (runtime.runtimeHeartbeatTimer) clearInterval(runtime.runtimeHeartbeatTimer);
        runtime.runtimeHeartbeatTimer = null;
      },
      { once: true },
    );
  }

  function validateBridgeAck(ack, expected) {
    if (
      ack?.ok !== true ||
      ack?.committed !== true ||
      Number(ack?.protocol_version) !== CONFIG.BRIDGE_PROTOCOL_VERSION ||
      ack?.dataset_id !== CONFIG.BRIDGE_DATASET ||
      ack?.run_id !== expected.runId ||
      ack?.account_key !== expected.accountKey ||
      Number(ack?.record_count) !== expected.recordCount ||
      ack?.ingest_sha256 !== expected.publicationSha256
    ) {
      throw bridgeError("本地数据桥 ACK 与待交付快照不一致，基线不会推进", {
        code: "BRIDGE_ACK_INVALID",
      });
    }
    return ack;
  }

  async function postPublication(publicationText, expected, token) {
    const ack = await bridgeRequest("POST", "/v1/ingest", {
      body: publicationText,
      headers: {
        "X-LingXing-Bridge-Token": token,
      },
    });
    return validateBridgeAck(ack, expected);
  }

  async function publishToBridge(pending) {
    const publicationSha256 = await sha256(pending.publicationText);
    if (!/^[a-f0-9]{64}$/.test(publicationSha256)) {
      throw bridgeError("当前浏览器无法计算可靠的 SHA-256，已拒绝提交基线", {
        code: "BRIDGE_HASH_UNAVAILABLE",
      });
    }
    const expected = {
      runId: pending.runId,
      accountKey: pending.accountKey,
      recordCount: pending.nextBaseline.records.length,
      publicationSha256,
    };
    let token = await getBridgeToken();
    try {
      return await postPublication(pending.publicationText, expected, token);
    } catch (error) {
      if (![401, 403].includes(Number(error?.httpStatus))) throw error;
      await GM_setValue(CONFIG.BRIDGE_TOKEN_KEY, "");
      token = await getBridgeToken({ forcePair: true });
      return postPublication(pending.publicationText, expected, token);
    }
  }

  function bridgePathFromResponse(response) {
    const rootValue = response?.data_root || response?.root;
    const root = typeof rootValue === "string" ? rootValue.replace(/[\\/]+$/, "") : "";
    const datasetValue =
      response?.dataset_path ||
      response?.datasets?.[CONFIG.BRIDGE_DATASET]?.path ||
      response?.datasets?.[CONFIG.BRIDGE_DATASET]?.folder;
    if (typeof datasetValue === "string" && datasetValue.trim()) {
      const normalized = datasetValue.trim().replace(/\//g, "\\");
      if (/^[A-Za-z]:\\/.test(normalized) || normalized.startsWith("\\\\")) return normalized;
      if (root) return `${root}\\${normalized.replace(/^\\+/, "")}`;
    }
    return (
      (root ? `${root}\\FBA数据` : "") ||
      CONFIG.BRIDGE_EXPECTED_PATH
    );
  }

  async function checkBridgeConnection({ pair = true, persist = true } = {}) {
    const health = await bridgeRequest("GET", "/health", {
      timeout: CONFIG.BRIDGE_HEALTH_TIMEOUT_MS,
    });
    if (
      health?.ok !== true ||
      Number(health?.protocol_version) !== CONFIG.BRIDGE_PROTOCOL_VERSION
    ) {
      throw bridgeError("本地数据桥健康检查未通过或协议版本不兼容");
    }
    if (pair) await getBridgeToken({ forcePair: true });

    const checkedAt = new Date().toISOString();
    const bridgePath = bridgePathFromResponse(health);
    if (persist) {
      await saveStatus({
        bridgeAvailable: true,
        lastBridgeHealthAt: checkedAt,
        lastBridgePath: bridgePath,
        lastBridgeError: "",
      });
    }
    return { health, bridgePath, checkedAt };
  }

  // -----------------------------------------------------------------------------
  // 页面请求适配器：该接口属于 erp.lingxing.com 同源接口，必须复用页面的
  // $post，不能使用会转向 gw.lingxingerp.com 的 $gwPost。
  // 这样仍由领星自己的请求拦截器补齐 Token、公司和账号信息，不保存凭证。
  // -----------------------------------------------------------------------------
  function normalizeErpResponse(response) {
    // $post 通常直接返回业务响应；axios.post 则返回 { data: 业务响应 }。
    if (response?.code !== undefined) return response;
    if (response?.data?.code !== undefined) return response.data;
    return response;
  }

  function createErpPostClient(vm) {
    try {
      if (typeof vm?.$post === "function") {
        return {
          kind: "$post",
          // 与 FBA 货件页面 getShipmentList 的原生调用保持一致；fbaCargo 用于
          // 页面请求层生成 req_time_sequence，避免并发列表请求互相覆盖。
          post: async (path, payload) =>
            normalizeErpResponse(await vm.$post(path, payload, {}, null, null, "fbaCargo")),
        };
      }
    } catch (_) {
      // 某些 Vue 代理对象读取属性可能抛错，交给遍历逻辑继续查找。
    }
    return null;
  }

  function findErpPostClient() {
    const pageDocument = getPageDocument();
    const roots = [];
    const selectors = ["#app", ".app-wrapper", ".el-main", ".fba-shipment"];

    selectors.forEach((selector) => {
      const element = pageDocument.querySelector(selector);
      if (element?.__vue__) roots.push(element.__vue__);
    });

    const seen = new Set();
    const queue = [...roots];
    while (queue.length > 0 && seen.size < 5000) {
      const vm = queue.shift();
      if (!vm || seen.has(vm)) continue;
      seen.add(vm);
      try {
        const client = createErpPostClient(vm);
        if (client) return client;
        if (Array.isArray(vm.$children)) queue.push(...vm.$children);
        if (vm.$parent) queue.push(vm.$parent);
      } catch (_) {
        // 某些 Vue 代理对象读取属性可能抛错，跳过即可。
      }
    }

    return null;
  }

  async function waitForErpPostClient(timeoutMs = CONFIG.CLIENT_WAIT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const client = findErpPostClient();
      if (client) return client;
      await sleep(1000);
    }
    throw new Error("未找到领星页面同源请求实例（$post）。请确认已经登录并打开 FBA 货件页面，然后刷新后重试。");
  }

  function makeListPayload(offset) {
    return {
      search_field_time: "create_date",
      is_sta: "",
      is_awd: "",
      ship_mode: "",
      step: [],
      is_closed: "",
      application_diff: "",
      received_diff: "",
      application_received_diff: "",
      is_relate_packing_task_sn: "",
      is_add_tracking: "",
      delivery_order_status: [],
      box_type: "",
      is_uploaded_box: "",
      sta_transportation_mode: "",
      delivery_mode: "",
      carrier_type: "",
      create_uids: [],
      principal_uids: [],
      is_store_diff: "",
      sort_field: "gmt_create",
      sort_type: "desc",
      search_field: "shipment_id",
      shipment_status: [],
      is_relate_shipment: "",
      seniorSearchList: [],
      shipment_type: [],
      offset,
      length: CONFIG.PAGE_SIZE,
    };
  }

  function rawShipmentKey(row) {
    if (row?.id !== undefined && row?.id !== null && row?.id !== "") {
      return `id:${row.id}`;
    }

    if (row?.shipment_id !== undefined && row?.shipment_id !== null && row?.shipment_id !== "") {
      return `shipment:${row.shipment_id}`;
    }

    // 基线本身已经按账号隔离；sid 是店铺维度，不能参与货件稳定主键。
    throw new Error("接口返回了缺少货件ID的记录，已停止更新基线");
  }

  async function fetchAllShipments(client, onProgress) {
    let expectedTotal = null;
    let firstRowKey = null;
    let offset = 0;
    let pageCount = 0;
    let sumList = null;
    const rows = [];

    while (pageCount < CONFIG.MAX_PAGES) {
      const response = await client.post(CONFIG.API_PATH, makeListPayload(offset));
      if (response?.code !== 1 || !Array.isArray(response?.data?.list)) {
        throw new Error(response?.msg || `第 ${pageCount + 1} 页返回格式异常`);
      }

      const data = response.data;
      const pageRows = data.list;
      const pageTotal = Number(data.total);
      if (!Number.isFinite(pageTotal) || pageTotal < 0) {
        throw new Error(`第 ${pageCount + 1} 页缺少有效的 total`);
      }

      if (expectedTotal === null) {
        expectedTotal = pageTotal;
        firstRowKey = pageRows.length ? rawShipmentKey(pageRows[0]) : null;
        sumList = data.sum_list || null;
      } else if (pageTotal !== expectedTotal) {
        throw new Error(`抓取过程中货件总数由 ${expectedTotal} 变为 ${pageTotal}，为避免漏数请稍后重试`);
      }

      rows.push(...pageRows);
      pageCount += 1;
      onProgress?.(`正在抓取第 ${pageCount} 页：${Math.min(rows.length, expectedTotal)}/${expectedTotal}`);

      if (rows.length >= expectedTotal) break;
      if (pageRows.length === 0) {
        throw new Error(`分页提前结束：应有 ${expectedTotal} 条，实际只拿到 ${rows.length} 条`);
      }
      offset += CONFIG.PAGE_SIZE;
    }

    if (pageCount >= CONFIG.MAX_PAGES && rows.length < expectedTotal) {
      throw new Error("分页数量超过安全上限，已停止抓取");
    }

    // 多页抓取期间若有新货件插入，offset 分页可能发生位移；复查第一页防止静默漏数。
    if (pageCount > 1) {
      const verification = await client.post(CONFIG.API_PATH, makeListPayload(0));
      if (verification?.code !== 1 || !Array.isArray(verification?.data?.list)) {
        throw new Error("分页完成后的第一页复查失败");
      }
      const verifyTotal = Number(verification.data.total);
      const verifyFirstKey = verification.data.list.length
        ? rawShipmentKey(verification.data.list[0])
        : null;
      if (verifyTotal !== expectedTotal || verifyFirstKey !== firstRowKey) {
        throw new Error("抓取期间货件列表发生变化，为避免漏数请稍后重试");
      }
    }

    const unique = new Map();
    rows.forEach((row) => unique.set(rawShipmentKey(row), row));
    if (unique.size !== expectedTotal) {
      throw new Error(`分页校验失败：接口报告 ${expectedTotal} 条，去重后只有 ${unique.size} 条`);
    }

    return {
      rows: [...unique.values()],
      expectedTotal,
      pageCount,
      sumList,
    };
  }

  async function fetchWithRetry(client, onProgress) {
    let lastError;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        return await fetchAllShipments(client, onProgress);
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          onProgress?.(`首次抓取未通过完整性校验，正在重新抓取：${error.message}`);
          await sleep(1500);
        }
      }
    }
    throw lastError;
  }

  // -----------------------------------------------------------------------------
  // 标准化与差异计算。
  // -----------------------------------------------------------------------------
  function simpleCompare(a, b) {
    if (a === b) return 0;
    return a < b ? -1 : 1;
  }

  function preferredArrayKey(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const fields = [
      "shipment_item_id",
      "id",
      "status_name",
      "seq",
      "isp_id",
      "sku",
      "fnsku",
      "shipment_id",
      "tracking_number",
    ];
    const parts = fields
      .filter((field) => value[field] !== undefined && value[field] !== null)
      .map((field) => `${field}:${value[field]}`);
    return parts.length ? parts.join("|") : null;
  }

  function canonicalize(value, path = []) {
    if (value === null || value === undefined) return value ?? null;
    if (typeof value !== "object") return value;

    if (Array.isArray(value)) {
      const normalized = value.map((item, index) => canonicalize(item, [...path, String(index)]));
      const arrayName = path[path.length - 1];
      if (UNORDERED_ARRAY_KEYS.has(arrayName)) {
        normalized.sort((left, right) => {
          const leftKey = preferredArrayKey(left) || JSON.stringify(left);
          const rightKey = preferredArrayKey(right) || JSON.stringify(right);
          return simpleCompare(leftKey, rightKey);
        });
      }
      return normalized;
    }

    const output = {};
    Object.keys(value)
      .sort(simpleCompare)
      .forEach((key) => {
        output[key] = canonicalize(value[key], [...path, key]);
      });
    return output;
  }

  function normalizeShipment(raw) {
    const business = {};
    const sourceMeta = {};
    Object.keys(raw || {}).forEach((key) => {
      if (META_ONLY_KEYS.has(key)) sourceMeta[key] = raw[key];
      else business[key] = raw[key];
    });
    return {
      data: canonicalize(business),
      sourceMeta: canonicalize(sourceMeta),
    };
  }

  async function sha256(text) {
    if (globalThis.crypto?.subtle) {
      const bytes = new TextEncoder().encode(text);
      const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    }

    // HTTPS 页面正常都会有 SubtleCrypto；这里仅作为旧环境后备。
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
  }

  async function prepareCurrentRecords(rows) {
    const records = await Promise.all(
      rows.map(async (row) => {
        const key = rawShipmentKey(row);
        const normalized = normalizeShipment(row);
        const fingerprint = await sha256(JSON.stringify(normalized.data));
        return {
          key,
          fingerprint,
          data: normalized.data,
          sourceMeta: normalized.sourceMeta,
          missingCount: 0,
          firstMissingAt: null,
        };
      }),
    );
    records.sort((a, b) => simpleCompare(a.key, b.key));
    return records;
  }

  function valueType(value) {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value;
  }

  function addFieldChange(changes, path, before, after, limit) {
    if (changes.length >= limit) return;
    changes.push({
      path: path || "$",
      before_exists: before !== undefined,
      after_exists: after !== undefined,
      before: before === undefined ? null : before,
      after: after === undefined ? null : after,
    });
  }

  function collectFieldChanges(before, after, path = "", changes = [], limit = 500) {
    if (changes.length >= limit) return changes;
    if (Object.is(before, after)) return changes;

    const beforeType = valueType(before);
    const afterType = valueType(after);
    if (beforeType !== afterType || !["object", "array"].includes(beforeType)) {
      addFieldChange(changes, path, before, after, limit);
      return changes;
    }

    if (beforeType === "array") {
      if (before.length !== after.length) {
        addFieldChange(changes, `${path}.length`, before.length, after.length, limit);
      }
      const maxLength = Math.max(before.length, after.length);
      for (let index = 0; index < maxLength && changes.length < limit; index += 1) {
        collectFieldChanges(before[index], after[index], `${path}[${index}]`, changes, limit);
      }
      return changes;
    }

    const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].sort(simpleCompare);
    keys.forEach((key) => {
      if (changes.length >= limit) return;
      const nextPath = path ? `${path}.${key}` : key;
      collectFieldChanges(before?.[key], after?.[key], nextPath, changes, limit);
    });
    return changes;
  }

  function publicRecord(record) {
    return {
      ...record.data,
      _source_meta: record.sourceMeta,
    };
  }

  function eventIdentity(record) {
    return {
      key: record.key,
      shipment_id: record.data?.shipment_id ?? null,
      seller: record.data?.seller ?? null,
      destination_fulfillment_center_id: record.data?.destination_fulfillment_center_id ?? null,
    };
  }

  function deriveAccountKey(rows) {
    const uids = [...new Set(rows.map((row) => row?.uid).filter((value) => value !== undefined && value !== null && value !== ""))]
      .map(String)
      .sort(simpleCompare);
    if (uids.length) return `uid-${uids.join("-")}`;
    return null;
  }

  function isCompatibleBaseline(baseline) {
    return Boolean(
      baseline &&
        baseline.schemaVersion === CONFIG.SCHEMA_VERSION &&
        baseline.normalizerVersion === CONFIG.NORMALIZER_VERSION &&
        baseline.queryScope === CONFIG.QUERY_SCOPE &&
        Array.isArray(baseline.records),
    );
  }

  function assertNoSuspiciousDrop(baseline, currentCount) {
    if (!isCompatibleBaseline(baseline)) return;
    const visiblePrevious = baseline.records.filter((record) => !record.missingCount).length;
    const drop = visiblePrevious - currentCount;
    if (visiblePrevious >= 100 && drop >= 50 && currentCount < visiblePrevious * 0.5) {
      throw new Error(
        `本次只取得 ${currentCount} 条，上次为 ${visiblePrevious} 条，降幅异常。为避免误删，基线未更新。`,
      );
    }
  }

  function buildExport({ baseline, currentRecords, fetchResult, trigger, runId, startedAt, completedAt, accountKey }) {
    const compatible = isCompatibleBaseline(baseline);
    const previousRunId = compatible ? baseline.runId : null;

    if (!compatible) {
      const nextBaseline = {
        schemaVersion: CONFIG.SCHEMA_VERSION,
        normalizerVersion: CONFIG.NORMALIZER_VERSION,
        queryScope: CONFIG.QUERY_SCOPE,
        accountKey,
        runId,
        createdAt: completedAt,
        updatedAt: completedAt,
        records: currentRecords,
      };

      const output = {
        schema_version: CONFIG.SCHEMA_VERSION,
        normalizer_version: CONFIG.NORMALIZER_VERSION,
        exporter_version: CONFIG.VERSION,
        kind: "baseline",
        reason: baseline ? "schema_or_scope_changed" : "first_run",
        run_id: runId,
        previous_run_id: null,
        trigger,
        started_at: startedAt,
        completed_at: completedAt,
        account_key: accountKey,
        query: {
          endpoint: CONFIG.API_PATH,
          scope: CONFIG.QUERY_SCOPE,
          sort_field: "gmt_create",
          sort_type: "desc",
          page_size: CONFIG.PAGE_SIZE,
        },
        source: {
          expected_total: fetchResult.expectedTotal,
          fetched_total: fetchResult.rows.length,
          unique_total: currentRecords.length,
          pages: fetchResult.pageCount,
          complete: true,
          sum_list: fetchResult.sumList,
        },
        summary: {
          baseline_records: currentRecords.length,
          added: 0,
          updated: 0,
          removed: 0,
          pending_missing: 0,
          unchanged: 0,
        },
        records: currentRecords.map(publicRecord),
      };
      return { output, nextBaseline };
    }

    const oldMap = new Map(baseline.records.map((record) => [record.key, record]));
    const currentMap = new Map(currentRecords.map((record) => [record.key, record]));
    const nextRecords = [];
    const changes = [];
    let added = 0;
    let updated = 0;
    let removed = 0;
    let unchanged = 0;
    let pendingMissing = 0;
    let recovered = 0;

    currentRecords.forEach((current) => {
      const previous = oldMap.get(current.key);
      nextRecords.push(current);

      if (!previous) {
        added += 1;
        changes.push({
          op: "add",
          ...eventIdentity(current),
          changed_fields: ["*"],
          current: publicRecord(current),
        });
        return;
      }

      if (previous.missingCount) recovered += 1;
      if (previous.fingerprint === current.fingerprint) {
        unchanged += 1;
        return;
      }

      updated += 1;
      const fieldChanges = collectFieldChanges(previous.data, current.data);
      changes.push({
        op: "update",
        ...eventIdentity(current),
        changed_fields: fieldChanges.map((change) => change.path),
        field_changes: fieldChanges,
        current: publicRecord(current),
      });
    });

    baseline.records.forEach((previous) => {
      if (currentMap.has(previous.key)) return;
      const nextMissingCount = Number(previous.missingCount || 0) + 1;
      if (nextMissingCount >= 2) {
        removed += 1;
        changes.push({
          op: "remove",
          ...eventIdentity(previous),
          changed_fields: ["*"],
          previous: publicRecord(previous),
          missing_since: previous.firstMissingAt || completedAt,
        });
        return;
      }

      pendingMissing += 1;
      nextRecords.push({
        ...previous,
        missingCount: nextMissingCount,
        firstMissingAt: previous.firstMissingAt || completedAt,
      });
    });

    nextRecords.sort((a, b) => simpleCompare(a.key, b.key));
    changes.sort((a, b) => simpleCompare(a.key, b.key));

    const nextBaseline = {
      schemaVersion: CONFIG.SCHEMA_VERSION,
      normalizerVersion: CONFIG.NORMALIZER_VERSION,
      queryScope: CONFIG.QUERY_SCOPE,
      accountKey,
      runId,
      createdAt: baseline.createdAt || completedAt,
      updatedAt: completedAt,
      records: nextRecords,
    };

    const output = {
      schema_version: CONFIG.SCHEMA_VERSION,
      normalizer_version: CONFIG.NORMALIZER_VERSION,
      exporter_version: CONFIG.VERSION,
      kind: "delta",
      run_id: runId,
      previous_run_id: previousRunId,
      trigger,
      started_at: startedAt,
      completed_at: completedAt,
      account_key: accountKey,
      query: {
        endpoint: CONFIG.API_PATH,
        scope: CONFIG.QUERY_SCOPE,
        sort_field: "gmt_create",
        sort_type: "desc",
        page_size: CONFIG.PAGE_SIZE,
      },
      source: {
        expected_total: fetchResult.expectedTotal,
        fetched_total: fetchResult.rows.length,
        unique_total: currentRecords.length,
        pages: fetchResult.pageCount,
        complete: true,
        sum_list: fetchResult.sumList,
      },
      summary: {
        added,
        updated,
        removed,
        pending_missing: pendingMissing,
        recovered,
        unchanged,
        total_changes: changes.length,
        source_records: currentRecords.length,
        baseline_records_after: nextRecords.length,
      },
      changes,
    };

    return { output, nextBaseline };
  }

  function makeBridgePublication(output, nextBaseline, sourceRecordCount) {
    return {
      schema_version: CONFIG.BRIDGE_PROTOCOL_VERSION,
      dataset: CONFIG.BRIDGE_DATASET,
      account_key: output.account_key,
      run_id: output.run_id,
      collected_at: output.completed_at,
      export: output,
      snapshot: {
        semantics: "confirmed_next_baseline",
        record_count: nextBaseline.records.length,
        source_record_count: sourceRecordCount,
        pending_missing: Number(output?.summary?.pending_missing || 0),
        source: output.source,
        records: nextBaseline.records.map((record) => ({
          ...publicRecord(record),
          _record_key: record.key,
        })),
      },
    };
  }

  function createPendingRun({ output, nextBaseline, baselineKey, outputFilename, outputText }) {
    const publication = makeBridgePublication(
      output,
      nextBaseline,
      Number(output?.source?.unique_total ?? output?.summary?.source_records ?? 0),
    );
    const fallbackFilename = sanitizeFilename(
      `领星FBA货件-数据桥待交付-${output.run_id}.json`,
    );
    return {
      formatVersion: 2,
      runId: output.run_id,
      accountKey: output.account_key,
      trigger: output.trigger,
      collectedAt: output.completed_at,
      baselineKey,
      nextBaseline,
      outputFilename,
      outputText,
      summary: output.summary,
      publicationText: JSON.stringify(publication, null, 2),
      fallbackFilename,
      fallbackAttemptedAt: null,
      fallbackDownloadedAt: null,
      fallbackError: "",
      createdAt: output.completed_at,
    };
  }

  async function normalizePendingRun(pending) {
    if (!pending) return null;
    if (pending.formatVersion === 2 && pending.publicationText && pending.nextBaseline) {
      return pending;
    }

    // 兼容 v1.0.x 下载失败后遗留的 pendingRun；旧结构同样包含完整 nextBaseline，
    // 可安全升级为数据桥 publication，而无需推进基线。
    if (pending.text && pending.nextBaseline && pending.baselineKey) {
      let output;
      try {
        output = JSON.parse(pending.text);
      } catch (error) {
        throw bridgeError("发现旧版待交付任务，但其 JSON 已损坏；基线保持不变", {
          code: "PENDING_INVALID",
          cause: error,
        });
      }
      const upgraded = createPendingRun({
        output,
        nextBaseline: pending.nextBaseline,
        baselineKey: pending.baselineKey,
        outputFilename: pending.filename || `领星FBA货件-${output.run_id}.json`,
        outputText: pending.text,
      });
      await DB.put("pendingRun", upgraded);
      return upgraded;
    }

    throw bridgeError("发现无法识别的待交付任务；为避免错乱，本次未抓取新数据", {
      code: "PENDING_INVALID",
    });
  }

  async function commitPendingRun(pending, ack, lockToken) {
    assertRunLockOwned(lockToken);
    const bridgeCommittedAt = new Date().toISOString();
    const bridgePath = bridgePathFromResponse(ack);
    await DB.putMany(
      [
        { key: pending.baselineKey, value: pending.nextBaseline },
        {
          key: "lastOutput",
          value: {
            runId: pending.runId,
            filename: pending.outputFilename,
            text: pending.outputText,
            createdAt: pending.collectedAt,
          },
        },
        {
          key: "lastBridgeAck",
          value: { ack, receivedAt: bridgeCommittedAt },
        },
      ],
      ["pendingRun"],
    );
    // 正式基线与 outbox 已在同一 IndexedDB 事务中提交。以下仅为界面辅助状态，
    // 即使浏览器的 GM 存储偶发失败，也不能把已成功交付的数据误判为桥接失败。
    try {
      await GM_setValue(CONFIG.LAST_ACCOUNT_KEY, pending.accountKey);
      await saveStatus({
        state: "success",
        lastSuccessAt: pending.collectedAt,
        lastTrigger: pending.trigger,
        lastRunId: pending.runId,
        lastFilename: pending.outputFilename,
        lastSummary: pending.summary,
        lastError: "",
        accountKey: pending.accountKey,
        bridgeAvailable: true,
        baselineCommitted: true,
        lastBridgeSuccessAt: bridgeCommittedAt,
        lastBridgeRunId: pending.runId,
        lastBridgePath: bridgePath,
        lastBridgeError: "",
      });
    } catch (error) {
      console.warn("[领星FBA增量导出] 数据已交付，但界面状态保存失败", error);
    }
    return { bridgeCommittedAt, bridgePath };
  }

  async function attemptEmergencyDownload(pending) {
    if (pending.fallbackAttemptedAt) {
      return {
        pending,
        attempted: true,
        saved: Boolean(pending.fallbackDownloadedAt),
        error: pending.fallbackError || "",
      };
    }

    // 先记录“已尝试”，这样自动重试或页面刷新不会生成重复下载。
    let updated = {
      ...pending,
      fallbackAttemptedAt: new Date().toISOString(),
    };
    await DB.put("pendingRun", updated);

    try {
      await downloadJsonText(updated.publicationText, updated.fallbackFilename);
      updated = {
        ...updated,
        fallbackDownloadedAt: new Date().toISOString(),
        fallbackError: "",
      };
      await DB.put("pendingRun", updated);
      return { pending: updated, attempted: true, saved: true, error: "" };
    } catch (error) {
      updated = {
        ...updated,
        fallbackError: error?.message || String(error),
      };
      await DB.put("pendingRun", updated);
      return {
        pending: updated,
        attempted: true,
        saved: false,
        error: updated.fallbackError,
      };
    }
  }

  async function deliverPendingRun(pending, lockToken) {
    let ack;
    try {
      ack = await publishToBridge(pending);
    } catch (cause) {
      // 桥接阶段失败时生成一次应急文件；任何情况下都不在这里推进基线。
      const fallback = await attemptEmergencyDownload(pending);

      const fallbackText = fallback.saved
        ? `；已下载一次应急文件 ${pending.fallbackFilename}`
        : fallback.attempted
          ? `；应急文件下载失败：${fallback.error || "未知错误"}`
          : "";
      const error = bridgeError(
        `${cause?.message || String(cause)}${fallbackText}。共享目录尚未确认写入，基线未推进`,
        { code: "BRIDGE_DELIVERY_FAILED", cause },
      );
      error.fallbackAttempted = fallback.attempted;
      error.fallbackSaved = fallback.saved;
      error.fallbackFilename = pending.fallbackFilename;
      throw error;
    }

    // ACK 已确认桥端写入。若本地事务失败，pendingRun 仍在，下次会按同一
    // run_id 幂等重发并再次尝试提交；这种情况无需也不应生成应急下载。
    const committed = await commitPendingRun(pending, ack, lockToken);
    return { ack, ...committed };
  }

  async function resumePendingRun(lockToken) {
    const rawPending = await DB.get("pendingRun");
    if (!rawPending) return null;
    const pending = await normalizePendingRun(rawPending);
    setPanelStatus(`发现待交付任务 ${pending.runId}，正在优先重发到本地数据桥…`);
    const result = await deliverPendingRun(pending, lockToken);
    toast(`待交付任务已写入数据桥：${pending.runId}，继续抓取最新数据`, "success", 5000);
    return { pending, result };
  }

  // -----------------------------------------------------------------------------
  // 下载与跨标签运行锁。
  // -----------------------------------------------------------------------------
  function anchorDownload(text, filename) {
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(() => {
      anchor.remove();
      URL.revokeObjectURL(url);
    }, 30000);
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error("无法生成下载数据"));
      reader.readAsDataURL(blob);
    });
  }

  function gmDownloadUrl(url, filename) {
    return new Promise((resolve, reject) => {
      GM_download({
        url,
        name: filename,
        saveAs: false,
        onload: resolve,
        onerror: (error) => reject(new Error(error?.error || error?.details || "GM_download 下载失败")),
        ontimeout: () => reject(new Error("下载超时")),
      });
    });
  }

  async function downloadJsonText(text, filename, { allowAnchorFallback = false } = {}) {
    if (typeof GM_download !== "function") {
      if (allowAnchorFallback) {
        anchorDownload(text, filename);
        return false;
      }
      throw new Error("当前油猴环境不支持 GM_download，未推进数据基线");
    }

    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    try {
      try {
        await gmDownloadUrl(url, filename);
      } catch (blobError) {
        console.warn("[领星FBA增量导出] Blob URL 下载失败，改用 data URL 重试。", blobError);
        const dataUrl = await blobToDataUrl(blob);
        await gmDownloadUrl(dataUrl, filename);
      }
      return true;
    } catch (error) {
      if (!allowAnchorFallback) throw error;
      console.warn("[领星FBA增量导出] GM_download 失败，手动重下载改用页面下载。", error);
      anchorDownload(text, filename);
      return false;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
  }

  async function acquireRunLock() {
    const pageLocks = getPageWindow()?.navigator?.locks || navigator?.locks;
    if (pageLocks && typeof pageLocks.request === "function") {
      let releaseHold;
      const hold = new Promise((resolve) => {
        releaseHold = resolve;
      });
      let settle;
      let settled = false;
      const acquired = new Promise((resolve) => {
        settle = (value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
      });
      let requestPromise;
      try {
        requestPromise = pageLocks
          .request(CONFIG.LOCK_KEY, { mode: "exclusive", ifAvailable: true }, async (lock) => {
            if (!lock) {
              settle(null);
              return;
            }
            settle({ type: "web-lock", releaseHold, requestPromise: null });
            await hold;
          })
          .catch((error) => {
            console.warn("[领星FBA增量导出] Web Locks 获取失败，将使用租约锁。", error);
            settle(undefined);
          });
      } catch (error) {
        console.warn("[领星FBA增量导出] Web Locks 调用失败，将使用租约锁。", error);
        settle(undefined);
      }
      const webToken = await acquired;
      if (webToken) {
        webToken.requestPromise = requestPromise;
        return webToken;
      }
      if (webToken === null) return null;
    }

    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const now = Date.now();
      const existing = JSON.parse(localStorage.getItem(CONFIG.LOCK_KEY) || "null");
      if (existing?.expiresAt > now) return null;
      localStorage.setItem(CONFIG.LOCK_KEY, JSON.stringify({ token, expiresAt: now + CONFIG.LOCK_TTL_MS }));
      await sleep(80 + Math.random() * 120);
      const confirmed = JSON.parse(localStorage.getItem(CONFIG.LOCK_KEY) || "null");
      if (confirmed?.token !== token) return null;
      const heartbeat = setInterval(() => {
        try {
          const current = JSON.parse(localStorage.getItem(CONFIG.LOCK_KEY) || "null");
          if (current?.token === token) {
            localStorage.setItem(
              CONFIG.LOCK_KEY,
              JSON.stringify({ token, expiresAt: Date.now() + CONFIG.LOCK_TTL_MS }),
            );
          }
        } catch (_) {
          // 提交前还会再次验证锁所有权。
        }
      }, Math.floor(CONFIG.LOCK_TTL_MS / 3));
      return { type: "lease", token, heartbeat };
    } catch (_) {
      throw new Error("浏览器无法建立可靠的跨标签运行锁，已停止导出以避免重复或错乱");
    }
  }

  function assertRunLockOwned(lockToken) {
    if (!lockToken) throw new Error("运行锁已丢失，未更新数据基线");
    if (lockToken.type === "web-lock") return;
    try {
      const current = JSON.parse(localStorage.getItem(CONFIG.LOCK_KEY) || "null");
      if (current?.token !== lockToken.token || current.expiresAt <= Date.now()) {
        throw new Error("运行锁已被其他标签页接管，未更新数据基线");
      }
    } catch (error) {
      if (error?.message?.includes("运行锁")) throw error;
      throw new Error("无法验证跨标签运行锁，未更新数据基线");
    }
  }

  function releaseRunLock(lockToken) {
    if (!lockToken) return;
    if (lockToken.type === "web-lock") {
      lockToken.releaseHold?.();
      return;
    }
    if (lockToken.heartbeat) clearInterval(lockToken.heartbeat);
    if (lockToken.type !== "lease") return;
    try {
      const current = JSON.parse(localStorage.getItem(CONFIG.LOCK_KEY) || "null");
      if (current?.token === lockToken.token) localStorage.removeItem(CONFIG.LOCK_KEY);
    } catch (_) {
      // localStorage 不可用时只有本标签运行锁。
    }
  }

  // -----------------------------------------------------------------------------
  // UI。
  // -----------------------------------------------------------------------------
  function addStyles() {
    if (document.getElementById("lxde-styles")) return;
    const style = document.createElement("style");
    style.id = "lxde-styles";
    style.textContent = `
      .lxde-overlay { position:fixed; inset:0; z-index:2147483647; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,.55); backdrop-filter:blur(2px); }
      .lxde-panel { width:min(620px,92vw); max-height:88vh; overflow:auto; background:#fff; border-radius:12px; box-shadow:0 12px 40px rgba(0,0,0,.22); font-family:system-ui,-apple-system,"Microsoft YaHei",sans-serif; color:#303133; }
      .lxde-header { position:relative; padding:20px 52px 16px 22px; border-bottom:1px solid #ebeef5; font-size:19px; font-weight:700; }
      .lxde-close { position:absolute; right:16px; top:13px; width:34px; height:34px; border:0; background:transparent; color:#909399; font-size:25px; cursor:pointer; }
      .lxde-body { padding:20px 22px; }
      .lxde-card { padding:14px 16px; margin-bottom:14px; background:#f7f8fb; border:1px solid #ebeef5; border-radius:8px; }
      .lxde-row { display:flex; justify-content:space-between; align-items:center; gap:16px; padding:5px 0; font-size:13px; }
      .lxde-label { color:#7a7f87; }
      .lxde-value { text-align:right; word-break:break-all; }
      .lxde-setting { display:flex; align-items:center; flex-wrap:wrap; gap:10px; }
      .lxde-setting input[type="time"] { padding:7px 9px; border:1px solid #dcdfe6; border-radius:5px; }
      .lxde-actions { display:flex; flex-wrap:wrap; gap:10px; margin-top:16px; }
      .lxde-btn { border:0; border-radius:6px; padding:9px 15px; cursor:pointer; font-size:13px; }
      .lxde-btn:disabled { opacity:.55; cursor:not-allowed; }
      .lxde-primary { background:#5146d8; color:#fff; }
      .lxde-secondary { background:#edf0f5; color:#4f5660; }
      .lxde-success { background:#23a36d; color:#fff; }
      .lxde-status { min-height:20px; margin-top:14px; padding:10px 12px; border-radius:6px; background:#edf6ff; color:#337ecc; font-size:13px; line-height:1.5; }
      .lxde-note { margin-top:14px; color:#909399; font-size:12px; line-height:1.6; }
      .lxde-toast { position:fixed; top:30px; left:50%; transform:translateX(-50%); z-index:2147483647; max-width:min(600px,90vw); padding:11px 18px; border-radius:7px; color:#fff; box-shadow:0 6px 18px rgba(0,0,0,.18); font-size:14px; }
      .lxde-toast.info { background:#409eff; } .lxde-toast.success { background:#23a36d; } .lxde-toast.error { background:#e65a5a; } .lxde-toast.warning { background:#d7942d; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function toast(message, type = "info", duration = 4200) {
    document.querySelectorAll(".lxde-toast").forEach((element) => element.remove());
    const element = document.createElement("div");
    element.className = `lxde-toast ${type}`;
    element.textContent = message;
    document.body.appendChild(element);
    setTimeout(() => element.remove(), duration);
  }

  function setPanelStatus(message) {
    const element = document.getElementById("lxde-live-status");
    if (element) element.textContent = message;
  }

  function setRunButtonsDisabled(disabled) {
    document.querySelectorAll("[data-lxde-run]").forEach((button) => {
      button.disabled = disabled;
    });
  }

  async function testBridgeFromUi() {
    const button = document.getElementById("lxde-test-bridge");
    if (button) button.disabled = true;
    setPanelStatus("正在检测并配对本地数据桥…");
    try {
      const result = await checkBridgeConnection({ pair: true, persist: true });
      setPanelStatus(`本地数据桥可用：${result.bridgePath}`);
      toast("本地数据桥连接正常，配对令牌已就绪", "success", 5000);
      await refreshPanelInfo();
      return true;
    } catch (error) {
      const message = error?.message || String(error);
      setRuntimeHeartbeatState("error", `无法启动 FBA 数据同步：${message}`);
      await saveStatus({
        bridgeAvailable: false,
        lastBridgeHealthAt: new Date().toISOString(),
        lastBridgeError: message,
      });
      setPanelStatus(`数据桥不可用：${message}`);
      toast(`本地数据桥检测失败：${message}`, "error", 7000);
      await refreshPanelInfo();
      return false;
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function refreshPanelInfo() {
    const status = (await GM_getValue(CONFIG.STATUS_KEY, {})) || {};
    const pending = await DB.get("pendingRun");
    const accountKey =
      (await GM_getValue(CONFIG.LAST_ACCOUNT_KEY, "")) || pending?.accountKey || "";
    const baseline = accountKey ? await DB.get(`baseline:${accountKey}`) : null;
    const lastOutput = await DB.get("lastOutput");
    const bridgeStatus = status.bridgeAvailable === true
      ? `可用（检测于 ${formatDisplayTime(status.lastBridgeHealthAt)}）`
      : status.bridgeAvailable === false
        ? "不可用"
        : "尚未检测";
    const pendingText = pending
      ? `${pending.runId || "未知任务"}${pending.fallbackDownloadedAt ? "（应急文件已下载，等待重发）" : "（等待重发）"}`
      : "无";

    const mappings = {
      "lxde-last-success": formatDisplayTime(status.lastSuccessAt),
      "lxde-last-trigger": status.lastTrigger === "scheduled"
        ? "每日自动"
        : status.lastTrigger === "manual"
          ? "手动运行"
          : status.lastTrigger === "bridge_job"
            ? "AI / 数据桥任务"
            : "—",
      "lxde-account": accountKey || "尚未建立基线",
      "lxde-baseline-count": baseline?.records?.length ?? 0,
      "lxde-last-result": status.lastSummary
        ? `新增 ${status.lastSummary.added || 0}，修改 ${status.lastSummary.updated || 0}，删除 ${status.lastSummary.removed || 0}`
        : "—",
      "lxde-last-error": status.lastError || "无",
      "lxde-bridge-status": bridgeStatus,
      "lxde-bridge-path": status.lastBridgePath || CONFIG.BRIDGE_EXPECTED_PATH,
      "lxde-bridge-success": formatDisplayTime(status.lastBridgeSuccessAt),
      "lxde-bridge-pending": pendingText,
      "lxde-bridge-error": status.lastBridgeError || "无",
    };

    Object.entries(mappings).forEach(([id, value]) => {
      const element = document.getElementById(id);
      if (element) element.textContent = String(value);
    });

    const redownload = document.getElementById("lxde-redownload");
    if (redownload) redownload.disabled = !lastOutput?.text;
  }

  async function openPanel() {
    document.getElementById("lxde-overlay")?.remove();
    const settings = await getSettings();
    const overlay = document.createElement("div");
    overlay.id = "lxde-overlay";
    overlay.className = "lxde-overlay";
    overlay.innerHTML = `
      <div class="lxde-panel" role="dialog" aria-modal="true" aria-label="FBA货件本地数据桥">
        <div class="lxde-header">FBA 货件本地数据桥<button id="lxde-close" class="lxde-close" title="关闭">×</button></div>
        <div class="lxde-body">
          <div class="lxde-card">
            <div class="lxde-row"><span class="lxde-label">当前账号基线</span><span id="lxde-account" class="lxde-value">读取中…</span></div>
            <div class="lxde-row"><span class="lxde-label">基线记录数</span><span id="lxde-baseline-count" class="lxde-value">读取中…</span></div>
            <div class="lxde-row"><span class="lxde-label">上次成功</span><span id="lxde-last-success" class="lxde-value">读取中…</span></div>
            <div class="lxde-row"><span class="lxde-label">上次触发方式</span><span id="lxde-last-trigger" class="lxde-value">读取中…</span></div>
            <div class="lxde-row"><span class="lxde-label">上次结果</span><span id="lxde-last-result" class="lxde-value">读取中…</span></div>
            <div class="lxde-row"><span class="lxde-label">最近错误</span><span id="lxde-last-error" class="lxde-value">读取中…</span></div>
          </div>
          <div class="lxde-card">
            <div class="lxde-row"><span class="lxde-label">本地数据桥</span><span id="lxde-bridge-status" class="lxde-value">读取中…</span></div>
            <div class="lxde-row"><span class="lxde-label">FBA 保存位置</span><span id="lxde-bridge-path" class="lxde-value">读取中…</span></div>
            <div class="lxde-row"><span class="lxde-label">上次桥接成功</span><span id="lxde-bridge-success" class="lxde-value">读取中…</span></div>
            <div class="lxde-row"><span class="lxde-label">待交付任务</span><span id="lxde-bridge-pending" class="lxde-value">读取中…</span></div>
            <div class="lxde-row"><span class="lxde-label">桥接错误</span><span id="lxde-bridge-error" class="lxde-value">读取中…</span></div>
          </div>
          <div class="lxde-card">
            <div class="lxde-setting">
              <label><input id="lxde-auto-enabled" type="checkbox" ${settings.autoEnabled ? "checked" : ""}> 每天自动运行</label>
              <label>时间 <input id="lxde-auto-time" type="time" value="${settings.autoTime}"></label>
              <button id="lxde-save-settings" class="lxde-btn lxde-secondary">保存设置</button>
            </div>
          </div>
          <div class="lxde-actions">
            <button id="lxde-run-now" data-lxde-run class="lxde-btn lxde-primary">立即同步到本地数据桥</button>
            <button id="lxde-test-bridge" class="lxde-btn lxde-secondary">检测数据桥</button>
            <button id="lxde-redownload" class="lxde-btn lxde-success">重新下载上次结果</button>
          </div>
          <div id="lxde-live-status" class="lxde-status">就绪。数据桥确认写入后才会推进本地基线。</div>
          <div class="lxde-note">自动任务只有在浏览器已打开、且至少有一个已登录的领星页面存活时才能运行。数据桥不可用时只会下载一次含完整快照的应急文件，不会推进基线；恢复后将优先重发待交付任务。</div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    document.getElementById("lxde-close").onclick = close;
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });

    document.getElementById("lxde-save-settings").onclick = async () => {
      const autoEnabled = document.getElementById("lxde-auto-enabled").checked;
      const autoTime = document.getElementById("lxde-auto-time").value;
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(autoTime)) {
        toast("请输入有效的每日运行时间", "warning");
        return;
      }
      await GM_setValue(CONFIG.SETTINGS_KEY, { autoEnabled, autoTime });
      toast("自动运行设置已保存", "success");
      checkAutomaticRun();
    };

    document.getElementById("lxde-run-now").onclick = () => runExport("manual");
    document.getElementById("lxde-test-bridge").onclick = testBridgeFromUi;
    document.getElementById("lxde-redownload").onclick = async () => {
      const lastOutput = await DB.get("lastOutput");
      if (!lastOutput?.text) {
        toast("还没有可重新下载的结果", "warning");
        return;
      }
      await downloadJsonText(lastOutput.text, lastOutput.filename);
      toast(`已重新下载：${lastOutput.filename}`, "success");
    };

    await refreshPanelInfo();
  }

  // -----------------------------------------------------------------------------
  // 运行控制。
  // -----------------------------------------------------------------------------
  async function runExport(trigger, options = {}) {
    const throwOnError = options.throwOnError === true;
    const showUserNotice = trigger !== "bridge_job";
    const updateRunProgress = (message, progress) => {
      setPanelStatus(message);
      if (typeof options.onProgress !== "function") return;
      try {
        Promise.resolve(options.onProgress(message, progress)).catch((error) => {
          console.warn("[领星FBA增量导出] 任务进度回报失败，数据抓取继续", error);
        });
      } catch (error) {
        console.warn("[领星FBA增量导出] 任务进度回报失败，数据抓取继续", error);
      }
    };

    if (runtime.running || (runtime.activeBridgeJobId && trigger !== "bridge_job")) {
      const error = bridgeError("当前页面已经在抓取，请稍候", { code: "WORKER_BUSY" });
      if (showUserNotice) toast(error.message, "warning");
      if (throwOnError) throw error;
      return false;
    }

    let lockToken;
    try {
      lockToken = await acquireRunLock();
    } catch (error) {
      const message = error?.message || String(error);
      await saveStatus({
        state: "error",
        lastAttemptAt: new Date().toISOString(),
        lastAttemptTrigger: trigger,
        lastError: message,
      });
      updateRunProgress(`失败：${message}`);
      if (showUserNotice) toast(`FBA 数据导出失败：${message}`, "error", 8000);
      if (throwOnError) throw error;
      return false;
    }
    if (!lockToken) {
      const error = bridgeError("另一个领星标签页正在抓取，请稍候", {
        code: "WORKER_BUSY",
      });
      if (showUserNotice && trigger === "manual") toast(error.message, "warning");
      if (throwOnError) throw error;
      return false;
    }

    runtime.running = true;
    setRuntimeHeartbeatState(
      "running",
      trigger === "bridge_job"
        ? "正在执行 AI 发起的 FBA 货件刷新"
        : trigger === "scheduled"
          ? "正在执行定时 FBA 货件同步"
          : "正在执行手动 FBA 货件同步",
    );
    setRunButtonsDisabled(true);
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const runId = makeRunId();

    try {
      updateRunProgress("已开始处理 FBA 货件刷新任务…", 2);
      // 真正的 outbox：任何旧任务都必须先按原 run_id 幂等重发并取得严格 ACK。
      // 成功提交旧基线后，本轮仍会继续抓取一次最新数据，避免恢复后只停在旧快照。
      const resumed = await resumePendingRun(lockToken);
      if (resumed) updateRunProgress("旧的待交付数据已确认写入，继续抓取最新货件…", 8);

      updateRunProgress("正在等待领星页面请求环境…", 10);
      const client = await waitForErpPostClient();
      const fetchResult = await fetchWithRetry(client, (message) => updateRunProgress(message));

      const accountKey = deriveAccountKey(fetchResult.rows);
      if (!accountKey) {
        throw new Error("本次结果为空或缺少账号标识，无法安全确认所属账号，因此未更新任何基线");
      }
      const baselineKey = `baseline:${accountKey}`;
      const baseline = await DB.get(baselineKey);
      assertNoSuspiciousDrop(baseline, fetchResult.rows.length);

      updateRunProgress(`已取得 ${fetchResult.rows.length} 条，正在计算变化…`, 70);
      const currentRecords = await prepareCurrentRecords(fetchResult.rows);
      const completedAt = new Date().toISOString();
      const { output, nextBaseline } = buildExport({
        baseline,
        currentRecords,
        fetchResult,
        trigger,
        runId,
        startedAt,
        completedAt,
        accountKey,
      });

      output.duration_ms = Date.now() - startedMs;
      const kindText = output.kind === "baseline" ? "完整基线" : "增量";
      const filename = sanitizeFilename(`领星FBA货件-${kindText}-${localTimestamp()}.json`);
      const text = JSON.stringify(output, null, 2);

      // 先写入本地 outbox；数据桥 ACK 前不推进正式基线。
      const pending = createPendingRun({
        output,
        nextBaseline,
        baselineKey,
        outputFilename: filename,
        outputText: text,
      });
      await DB.put("pendingRun", pending);

      assertRunLockOwned(lockToken);
      updateRunProgress(
        `数据已校验，正在写入本地数据桥（${CONFIG.BRIDGE_EXPECTED_PATH}）…`,
        85,
      );
      const delivery = await deliverPendingRun(pending, lockToken);

      runtime.nextAutoAttemptAt = 0;
      updateRunProgress(
        `完成：已写入 ${delivery.bridgePath}；新增 ${output.summary.added || 0}，修改 ${output.summary.updated || 0}，删除 ${output.summary.removed || 0}`,
        100,
      );
      if (showUserNotice) {
        toast(`FBA 数据已同步到本地数据桥：${delivery.bridgePath}`, "success", 6000);
      }
      try {
        await refreshPanelInfo();
      } catch (error) {
        // 桥 ACK 与 IndexedDB 基线已经提交，面板刷新只是展示层，不能把本轮
        // 已成功落盘的数据反向标成失败。
        console.warn("[领星FBA增量导出] 数据已同步，但面板信息刷新失败", error);
      }
      if (trigger !== "bridge_job") {
        setRuntimeHeartbeatState("idle", "最近一次 FBA 货件同步已完成");
      }
      return {
        run_id: output.run_id,
        account_key: output.account_key,
        collected_at: output.completed_at,
        bridge_committed_at: delivery.bridgeCommittedAt,
        dataset_id: CONFIG.BRIDGE_DATASET,
        dataset_path: delivery.bridgePath,
        output_kind: output.kind,
        source_record_count: fetchResult.rows.length,
        record_count: nextBaseline.records.length,
        summary: output.summary,
      };
    } catch (error) {
      console.error("[领星FBA增量导出] 运行失败", error);
      runtime.nextAutoAttemptAt = Date.now() + CONFIG.AUTO_RETRY_MS;
      const message = error?.message || String(error);
      setRuntimeHeartbeatState("error", `FBA 数据同步失败：${message}`);
      const isBridgeFailure = error?.code === "BRIDGE_DELIVERY_FAILED";
      const statusPatch = {
        state: isBridgeFailure ? "bridge_error" : "error",
        lastAttemptAt: new Date().toISOString(),
        lastAttemptTrigger: trigger,
        lastError: message,
      };
      if (isBridgeFailure) {
        Object.assign(statusPatch, {
          bridgeAvailable: false,
          baselineCommitted: false,
          lastBridgeError: message,
          lastFallbackAt: error.fallbackAttempted ? new Date().toISOString() : undefined,
          lastFallbackFilename: error.fallbackSaved ? error.fallbackFilename : undefined,
        });
      }
      await saveStatus(statusPatch);
      updateRunProgress(`失败：${message}`);
      if (showUserNotice) toast(`FBA 数据同步失败：${message}`, "error", 8000);
      await refreshPanelInfo();
      if (throwOnError) throw error;
      return false;
    } finally {
      runtime.running = false;
      requestRuntimeHeartbeat();
      setRunButtonsDisabled(false);
      releaseRunLock(lockToken);
    }
  }

  // -----------------------------------------------------------------------------
  // 本地数据桥任务客户端：AI 只能触发预注册能力，不能下发任意 URL、请求体、
  // JavaScript 或磁盘路径。浏览器必须保持已登录的领星页面存活。
  // -----------------------------------------------------------------------------
  function v2EnvelopeData(response) {
    if (response && typeof response === "object" && response.data && typeof response.data === "object") {
      return response.data;
    }
    return response || {};
  }

  function parseClaimedBridgeJob(response) {
    const data = v2EnvelopeData(response);
    const rawJob = data.job || data.claimed_job || (data.job_id || data.id ? data : null);
    if (!rawJob) return null;

    const id = String(rawJob.job_id || rawJob.id || "").trim();
    const capability = String(rawJob.capability || "").trim();
    const claimToken = String(rawJob.claim_token || data.claim_token || "").trim();
    if (!id || !claimToken || !capability) {
      throw bridgeError("数据桥返回了不完整的任务认领信息", { code: "JOB_CLAIM_INVALID" });
    }
    return { ...rawJob, id, capability, claimToken };
  }

  async function getBridgeJobWorkerId() {
    if (runtime.jobWorkerId) return runtime.jobWorkerId;
    const saved = String((await GM_getValue(CONFIG.BRIDGE_JOB_WORKER_KEY, "")) || "").trim();
    if (/^[A-Za-z0-9._:-]{8,160}$/.test(saved)) {
      runtime.jobWorkerId = saved;
      return saved;
    }
    const pageCrypto = getPageWindow()?.crypto || globalThis.crypto;
    const random =
      typeof pageCrypto?.randomUUID === "function"
        ? pageCrypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const created = `lingxing-fba-userscript:${random}`;
    await GM_setValue(CONFIG.BRIDGE_JOB_WORKER_KEY, created);
    runtime.jobWorkerId = created;
    return created;
  }

  async function claimBridgeJob(workerId) {
    const response = await authorizedBridgeRequest("POST", "/v2/jobs/claim", {
      body: {
        capabilities: [CONFIG.BRIDGE_JOB_CAPABILITY],
        worker_id: workerId,
        wait_ms: CONFIG.BRIDGE_JOB_CLAIM_WAIT_MS,
      },
      timeout: CONFIG.BRIDGE_JOB_REQUEST_TIMEOUT_MS,
    });
    return parseClaimedBridgeJob(response);
  }

  async function reportBridgeJobProgress(job, workerId, message, progress) {
    const body = {
      claim_token: job.claimToken,
      progress: {
        message: String(message || "任务正在运行").slice(0, 500),
        worker_id: workerId,
        reported_at: new Date().toISOString(),
      },
    };
    if (Number.isFinite(progress)) {
      body.progress.percent = Math.min(100, Math.max(0, Number(progress)));
    }
    return authorizedBridgeRequest(
      "POST",
      `/v2/jobs/${encodeURIComponent(job.id)}/progress`,
      { body, timeout: CONFIG.BRIDGE_JOB_PROGRESS_TIMEOUT_MS },
    );
  }

  async function completeBridgeJob(job, state, details = {}) {
    const body = {
      claim_token: job.claimToken,
      state,
    };
    if (state === "succeeded") body.result = details.result || {};
    else body.error = details.error || { code: "REFRESH_FAILED", message: "FBA 刷新失败" };
    return authorizedBridgeRequest(
      "POST",
      `/v2/jobs/${encodeURIComponent(job.id)}/complete`,
      { body, timeout: CONFIG.BRIDGE_JOB_PROGRESS_TIMEOUT_MS },
    );
  }

  function createBridgeJobProgressReporter(job, workerId) {
    let lastMessage = "任务正在运行";
    let lastProgress;
    let pending = null;
    let draining = null;
    const drain = () => {
      if (draining) return draining;
      draining = (async () => {
        while (pending) {
          const current = pending;
          pending = null;
          try {
            await reportBridgeJobProgress(job, workerId, current.message, current.progress);
          } catch (error) {
            console.warn("[领星FBA增量导出] 无法回报任务进度，刷新流程继续", error);
          }
        }
      })().finally(() => {
        draining = null;
        if (pending) drain();
      });
      return draining;
    };
    const notify = (message, progress) => {
      lastMessage = String(message || lastMessage);
      if (Number.isFinite(progress)) lastProgress = Number(progress);
      pending = { message: lastMessage, progress: lastProgress };
      return drain();
    };
    return {
      notify,
      heartbeat: () => notify(lastMessage, lastProgress),
      flush: async () => {
        while (pending || draining) {
          if (draining) await draining;
          else await drain();
        }
      },
    };
  }

  function validateBridgeJob(job) {
    if (job.capability !== CONFIG.BRIDGE_JOB_CAPABILITY) {
      throw bridgeError(`拒绝执行未注册能力：${job.capability}`, {
        code: "CAPABILITY_NOT_ALLOWED",
      });
    }
    const input = job.input;
    if (input !== undefined && input !== null) {
      if (typeof input !== "object" || Array.isArray(input)) {
        throw bridgeError("FBA 刷新能力当前不接受任务参数", {
          code: "UNSUPPORTED_JOB_INPUT",
        });
      }
      const allowedKeys = new Set(["reason", "trigger"]);
      if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
        throw bridgeError("FBA 刷新任务包含未支持的参数", {
          code: "UNSUPPORTED_JOB_INPUT",
        });
      }
      for (const key of allowedKeys) {
        if (
          input[key] !== undefined &&
          (typeof input[key] !== "string" || input[key].length > 200)
        ) {
          throw bridgeError(`FBA 刷新任务参数 ${key} 必须是 200 字以内的文本`, {
            code: "UNSUPPORTED_JOB_INPUT",
          });
        }
      }
    }
  }

  function serializeBridgeJobError(error) {
    const message = String(error?.message || error || "FBA 刷新失败").slice(0, 1000);
    let code = String(
      error?.code === "BRIDGE_DELIVERY_FAILED" && error?.cause?.code
        ? error.cause.code
        : error?.code || "",
    ).trim();
    if (!code && message.includes("未找到领星页面同源请求实例")) code = "LOGIN_REQUIRED";
    if (!code) code = "REFRESH_FAILED";
    const requiresUserAction = new Set([
      "ACCOUNT_MISMATCH",
      "LINEAGE_MISMATCH",
      "RUN_ID_CONFLICT",
      "PAYLOAD_TOO_LARGE",
      "PERMISSION_DENIED",
      "LOGIN_REQUIRED",
      "PENDING_INVALID",
    ]).has(code);
    const retryable = !requiresUserAction && new Set([
      "WORKER_BUSY",
      "BRIDGE_ERROR",
      "BRIDGE_HTTP_ERROR",
      "RESOURCE_BUSY",
      "INTERNAL_ERROR",
      "REFRESH_FAILED",
      "JOB_DEADLINE_TOO_CLOSE",
    ]).has(code);
    return {
      code: code.slice(0, 100),
      message,
      retryable,
      requires_user_action: requiresUserAction,
    };
  }

  async function handleClaimedBridgeJob(job, workerId) {
    runtime.activeBridgeJobId = job.id;
    setRuntimeHeartbeatState("running", "正在执行 AI 发起的 FBA 货件刷新");
    const reporter = createBridgeJobProgressReporter(job, workerId);
    const heartbeat = setInterval(() => reporter.heartbeat(), 20 * 1000);
    let terminalPresence = null;
    try {
      let result;
      try {
        validateBridgeJob(job);
        await reporter.notify("浏览器已认领 FBA 货件刷新任务", 1);
        const expiresAt = Date.parse(job.expires_at || "");
        if (!Number.isFinite(expiresAt)) {
          throw bridgeError("数据桥任务缺少有效的过期时间", {
            code: "JOB_EXPIRY_INVALID",
          });
        }
        const latestStartAt = expiresAt
          - CONFIG.BRIDGE_JOB_MIN_RUN_BUDGET_MS
          - CONFIG.BRIDGE_JOB_COMPLETION_RESERVE_MS;
        while (true) {
          if (Date.now() >= latestStartAt) {
            throw bridgeError("任务剩余时间不足以安全完成一次 FBA 抓取，请稍后重新发起", {
              code: "JOB_DEADLINE_TOO_CLOSE",
            });
          }
          try {
            result = await runExport("bridge_job", {
              throwOnError: true,
              onProgress: reporter.notify,
            });
            break;
          } catch (error) {
            if (error?.code !== "WORKER_BUSY") throw error;
            await reporter.notify("已有导出正在运行，AI 任务等待其完成…", 1);
            await sleep(3000);
          }
        }
        if (!result || typeof result !== "object") {
          throw bridgeError("FBA 刷新未返回可确认的结果", { code: "REFRESH_RESULT_INVALID" });
        }
      } catch (error) {
        clearInterval(heartbeat);
        const serialized = serializeBridgeJobError(error);
        terminalPresence = {
          state: "error",
          message: `AI 发起的 FBA 货件刷新失败：${serialized.message}`,
        };
        await reporter.flush();
        try {
          await completeBridgeJob(job, "failed", { error: serialized });
        } catch (completionError) {
          console.error("[领星FBA增量导出] 任务失败且无法回报完成状态", job.id, completionError);
          throw completionError;
        }
        console.warn("[领星FBA增量导出] AI 触发任务失败", job.id, serialized);
        return;
      }

      // 刷新成功与“成功状态已回报”分开处理：若最终回报临时失败，不得再把
      // 已落盘的数据错误标记为刷新失败。任务租约过期后可由桥端按策略重试。
      clearInterval(heartbeat);
      await reporter.flush();
      await completeBridgeJob(job, "succeeded", {
        result: {
          capability: CONFIG.BRIDGE_JOB_CAPABILITY,
          worker_id: workerId,
          ...result,
        },
      });
      console.info("[领星FBA增量导出] AI 触发任务已完成", job.id, result.run_id);
      terminalPresence = {
        state: "idle",
        message: "最近一次 AI 发起的 FBA 货件刷新已完成",
      };
    } catch (error) {
      if (!terminalPresence) {
        terminalPresence = {
          state: "error",
          message: `FBA 任务状态回报失败：${error?.message || String(error)}`,
        };
      }
      throw error;
    } finally {
      clearInterval(heartbeat);
      if (runtime.activeBridgeJobId === job.id) runtime.activeBridgeJobId = "";
      if (terminalPresence) {
        setRuntimeHeartbeatState(terminalPresence.state, terminalPresence.message);
      } else {
        requestRuntimeHeartbeat();
      }
    }
  }

  async function bridgeJobWorkerLoop(shouldContinue) {
    const workerId = await getBridgeJobWorkerId();
    let retryMs = CONFIG.BRIDGE_JOB_IDLE_RETRY_MS;
    while (!runtime.jobWorkerStopped && shouldContinue()) {
      if (runtime.running) {
        await sleep(1500);
        continue;
      }
      try {
        const job = await claimBridgeJob(workerId);
        retryMs = CONFIG.BRIDGE_JOB_IDLE_RETRY_MS;
        if (!job) continue;
        await handleClaimedBridgeJob(job, workerId);
      } catch (error) {
        if (runtime.jobWorkerStopped || !shouldContinue()) break;
        console.warn("[领星FBA增量导出] 数据桥任务轮询暂时不可用，将自动重试", error);
        const jitter = Math.floor(Math.random() * 750);
        await sleep(retryMs + jitter);
        retryMs = Math.min(retryMs * 2, CONFIG.BRIDGE_JOB_ERROR_RETRY_MAX_MS);
      }
    }
  }

  function fallbackJobLeaderStorage() {
    return getPageWindow()?.localStorage || localStorage;
  }

  function ownsFallbackJobLeadership() {
    try {
      const current = JSON.parse(
        fallbackJobLeaderStorage().getItem(CONFIG.BRIDGE_JOB_LEADER_KEY) || "null",
      );
      return (
        current?.owner === runtime.jobWorkerTabId &&
        Number(current?.expiresAt) > Date.now()
      );
    } catch (_) {
      return false;
    }
  }

  async function tryAcquireFallbackJobLeadership() {
    try {
      const storage = fallbackJobLeaderStorage();
      const now = Date.now();
      const current = JSON.parse(storage.getItem(CONFIG.BRIDGE_JOB_LEADER_KEY) || "null");
      if (
        current?.owner &&
        current.owner !== runtime.jobWorkerTabId &&
        Number(current.expiresAt) > now
      ) {
        return false;
      }
      storage.setItem(
        CONFIG.BRIDGE_JOB_LEADER_KEY,
        JSON.stringify({
          owner: runtime.jobWorkerTabId,
          expiresAt: now + CONFIG.BRIDGE_JOB_LEADER_TTL_MS,
        }),
      );
      // 给并发标签页一次覆盖并暴露竞争的机会，再确认最终 owner。
      await sleep(50 + Math.floor(Math.random() * 100));
      if (!ownsFallbackJobLeadership()) return false;
      runtime.jobWorkerLeader = true;
      if (!runtime.jobWorkerLeaderHeartbeat) {
        runtime.jobWorkerLeaderHeartbeat = setInterval(() => {
          if (!ownsFallbackJobLeadership()) {
            runtime.jobWorkerLeader = false;
            clearInterval(runtime.jobWorkerLeaderHeartbeat);
            runtime.jobWorkerLeaderHeartbeat = null;
            return;
          }
          try {
            fallbackJobLeaderStorage().setItem(
              CONFIG.BRIDGE_JOB_LEADER_KEY,
              JSON.stringify({
                owner: runtime.jobWorkerTabId,
                expiresAt: Date.now() + CONFIG.BRIDGE_JOB_LEADER_TTL_MS,
              }),
            );
          } catch (_) {
            runtime.jobWorkerLeader = false;
          }
        }, CONFIG.BRIDGE_JOB_LEADER_HEARTBEAT_MS);
      }
      return true;
    } catch (error) {
      console.warn("[领星FBA增量导出] 无法建立任务轮询标签页租约", error);
      return false;
    }
  }

  function releaseFallbackJobLeadership() {
    if (runtime.jobWorkerLeaderHeartbeat) {
      clearInterval(runtime.jobWorkerLeaderHeartbeat);
      runtime.jobWorkerLeaderHeartbeat = null;
    }
    if (!runtime.jobWorkerLeader) return;
    runtime.jobWorkerLeader = false;
    try {
      const storage = fallbackJobLeaderStorage();
      const current = JSON.parse(storage.getItem(CONFIG.BRIDGE_JOB_LEADER_KEY) || "null");
      if (current?.owner === runtime.jobWorkerTabId) {
        storage.removeItem(CONFIG.BRIDGE_JOB_LEADER_KEY);
      }
    } catch (_) {
      // 租约最多在 TTL 后自行失效。
    }
  }

  async function fallbackJobLeadershipLoop() {
    while (!runtime.jobWorkerStopped) {
      if (!(await tryAcquireFallbackJobLeadership())) {
        await sleep(5000);
        continue;
      }
      await bridgeJobWorkerLoop(() => ownsFallbackJobLeadership());
      releaseFallbackJobLeadership();
      if (!runtime.jobWorkerStopped) await sleep(2000);
    }
  }

  async function webLockJobLeadershipLoop(pageLocks) {
    while (!runtime.jobWorkerStopped) {
      let acquired = false;
      try {
        await pageLocks.request(
          CONFIG.BRIDGE_JOB_LEADER_KEY,
          { mode: "exclusive", ifAvailable: true },
          async (lock) => {
            if (!lock || runtime.jobWorkerStopped) return;
            acquired = true;
            runtime.jobWorkerLeader = true;
            try {
              await bridgeJobWorkerLoop(() => runtime.jobWorkerLeader);
            } finally {
              runtime.jobWorkerLeader = false;
            }
          },
        );
      } catch (error) {
        console.warn("[领星FBA增量导出] Web Locks 任务选主失败，将稍后重试", error);
      }
      if (!runtime.jobWorkerStopped) await sleep(acquired ? 1000 : 5000);
    }
  }

  function startBridgeJobWorker() {
    if (runtime.jobWorkerStarted) return;
    runtime.jobWorkerStarted = true;
    runtime.jobWorkerStopped = false;
    const pageLocks = getPageWindow()?.navigator?.locks || navigator?.locks;
    const runner = pageLocks?.request
      ? webLockJobLeadershipLoop(pageLocks)
      : fallbackJobLeadershipLoop();
    Promise.resolve(runner).catch((error) => {
      console.error("[领星FBA增量导出] 数据桥任务客户端意外停止", error);
      runtime.jobWorkerStarted = false;
    });
    window.addEventListener(
      "beforeunload",
      () => {
        runtime.jobWorkerStopped = true;
        runtime.jobWorkerLeader = false;
        releaseFallbackJobLeadership();
      },
      { once: true },
    );
  }

  function todayScheduledTime(timeText) {
    const [hour, minute] = timeText.split(":").map(Number);
    const scheduled = new Date();
    scheduled.setHours(hour, minute, 0, 0);
    return scheduled.getTime();
  }

  async function checkAutomaticRun() {
    if (runtime.running || runtime.activeBridgeJobId || Date.now() < runtime.nextAutoAttemptAt) return;
    const settings = await getSettings();
    if (!settings.autoEnabled) return;

    const scheduledAt = todayScheduledTime(settings.autoTime);
    if (Date.now() < scheduledAt) return;

    const status = (await GM_getValue(CONFIG.STATUS_KEY, {})) || {};
    const lastSuccessMs = status.lastSuccessAt ? new Date(status.lastSuccessAt).getTime() : 0;
    if (Number.isFinite(lastSuccessMs) && lastSuccessMs >= scheduledAt) return;

    await runExport("scheduled");
  }

  function ensureUi() {
    try {
      addStyles();
      document.getElementById("lxde-float")?.remove();
    } catch (error) {
      console.error("[领星FBA增量导出] 注入样式失败", error);
    }
  }

  function startScheduler() {
    if (runtime.scheduler) return;
    runtime.scheduler = setInterval(checkAutomaticRun, 60 * 1000);
    setTimeout(checkAutomaticRun, 5000);
    window.addEventListener("focus", checkAutomaticRun);
    window.addEventListener("online", checkAutomaticRun);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) checkAutomaticRun();
    });
  }

  function registerMenuCommands() {
    if (runtime.menuRegistered || typeof GM_registerMenuCommand !== "function") return;
    try {
      GM_registerMenuCommand("领星 FBA 数据桥：显示面板", openPanel);
      runtime.menuRegistered = true;
    } catch (error) {
      console.error("[领星FBA增量导出] 注册油猴菜单失败", error);
    }
  }

  function init() {
    ensureUi();
    registerMenuCommands();
    if (runtime.initialized) return;
    runtime.initialized = true;
    try {
      startScheduler();
    } catch (error) {
      console.error("[领星FBA增量导出] 启动每日调度失败，但手动入口仍可使用", error);
    }
    try {
      startRuntimeHeartbeat();
    } catch (error) {
      console.error("[领星FBA增量导出] 启动运行状态上报失败，但数据同步仍可使用", error);
    }
    try {
      startBridgeJobWorker();
    } catch (error) {
      console.error("[领星FBA增量导出] 启动数据桥任务客户端失败，但原有导出入口仍可使用", error);
    }
    console.info("[领星FBA增量导出] 已加载", CONFIG.VERSION, localDay());
  }

  registerMenuCommands();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
    setTimeout(init, 1000);
  } else {
    init();
  }
})();
