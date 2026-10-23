// ==UserScript==
// @name         领星ERP-功能插件模板（请复制后改名）
// @namespace    local.lingxing.toolkit
// @version      1.1.0
// @description  领星内部请求与本地桥的安全开发模板；占位配置完成前不会执行。
// @match        https://erp.lingxing.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      127.0.0.1
// ==/UserScript==

/*
 * 使用顺序：
 * 1. 先用“领星ERP-接口探针”取得真实请求样本，禁止猜接口或认证头。
 * 2. 为本功能登记独立 client / dataset / config / artifact 最小权限。
 * 3. 填完 FEATURE，增加业务层分页、完整性与字段验证，再把 setupComplete 改为 true。
 * 4. 同步修改 FEATURE.version；模板会自动向公共状态中心上报 idle/running/error。
 * 5. 此文件已内嵌固定版本 SDK，最终插件不要依赖远程 @require。
 */

/*__BRIDGE_CLIENT__*/

/*__LINGXING_PAGE_CLIENT__*/

(function lingxingFeatureTemplate() {
  'use strict';

  let running = false;
  const runtimePresence = {
    instanceId: `feature-tab:${typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
    state: 'idle',
    message: '已加载，等待任务',
    timer: null,
    inFlight: false,
    pending: false,
    lastWarningAt: 0,
  };

  const FEATURE = Object.freeze({
    setupComplete: false,
    id: 'replace_me',
    title: '请替换功能名称',
    version: '0.1.0',
    page: {
      test(url) {
        return url.origin === 'https://erp.lingxing.com' && url.pathname === '/replace-me';
      },
    },
    request: {
      // 只能取 post / gwPost / gateGet / gatePost 之一；必须来自探针证据。
      transport: 'post',
      path: '/replace-me',
      sequenceGroup: null,
      buildPayload() {
        return {};
      },
      buildConfig() {
        // 例如二进制下载可返回 { responseType: 'arraybuffer' }。
        return {};
      },
    },
    bridge: {
      clientId: 'replace_me_client',
      tokenKey: 'replace_me_bridge_token',
      // 没有业务需要就保持 null；不要申请无关权限。
      datasetId: null,
      artifactBucket: null,
    },
  });

  function assertConfigured() {
    if (!FEATURE.setupComplete) {
      throw new Error('模板尚未完成配置；请先按文件头注释完成适配。');
    }
    if (!FEATURE.page.test(new URL(location.href))) {
      throw new Error('当前页面不属于本功能允许的页面。');
    }
  }

  function createBridge() {
    return globalThis.LocalAutomationBridge.createLocalBridgeClient({
      clientId: FEATURE.bridge.clientId,
      baseUrl: 'http://127.0.0.1:32145',
      tokenKey: FEATURE.bridge.tokenKey,
    });
  }

  function runtimeHeartbeatPayload() {
    const payload = {
      instance_id: runtimePresence.instanceId,
      state: runtimePresence.state,
      version: FEATURE.version,
    };
    const message = String(runtimePresence.message || '')
      .replace(/[\x00-\x1f\x7f]+/g, ' ')
      .trim()
      .slice(0, 300);
    if (message) payload.message = message;
    return payload;
  }

  async function sendRuntimeHeartbeat() {
    // 未完成模板永远不访问本地桥；未配对时也保持安静。
    if (!FEATURE.setupComplete) return;
    const token = await Promise.resolve(GM_getValue(FEATURE.bridge.tokenKey, ''));
    if (typeof token !== 'string' || !token.trim()) return;
    if (runtimePresence.inFlight) {
      runtimePresence.pending = true;
      return;
    }
    runtimePresence.inFlight = true;
    try {
      await createBridge().runtimeHeartbeat(runtimeHeartbeatPayload());
      runtimePresence.lastWarningAt = 0;
    } catch (error) {
      const now = Date.now();
      if (!runtimePresence.lastWarningAt || now - runtimePresence.lastWarningAt >= 60000) {
        runtimePresence.lastWarningAt = now;
        console.warn(`[${FEATURE.title}] 无法上报公共状态心跳，业务功能继续运行`, error);
      }
    } finally {
      runtimePresence.inFlight = false;
      if (runtimePresence.pending) {
        runtimePresence.pending = false;
        queueMicrotask(() => { void sendRuntimeHeartbeat(); });
      }
    }
  }

  function setRuntimeState(state, message) {
    if (!['idle', 'running', 'error'].includes(state)) {
      throw new Error(`不支持的运行状态：${state}`);
    }
    runtimePresence.state = state;
    runtimePresence.message = String(message || '');
    void sendRuntimeHeartbeat();
  }

  function startRuntimeHeartbeat() {
    if (!FEATURE.setupComplete || runtimePresence.timer) return;
    void sendRuntimeHeartbeat();
    runtimePresence.timer = setInterval(() => { void sendRuntimeHeartbeat(); }, 20000);
    window.addEventListener('beforeunload', () => {
      if (runtimePresence.timer) clearInterval(runtimePresence.timer);
      runtimePresence.timer = null;
    }, { once: true });
  }

  async function callLingXing(pageClient) {
    const { transport, path, sequenceGroup } = FEATURE.request;
    const payload = FEATURE.request.buildPayload();
    const config = FEATURE.request.buildConfig();
    if (transport === 'post') return pageClient.post(path, payload, { sequenceGroup });
    if (transport === 'gwPost') return pageClient.gwPost(path, payload);
    if (transport === 'gateGet') return pageClient.gateGet(path, config);
    if (transport === 'gatePost') return pageClient.gatePost(path, payload, config);
    throw new Error(`不支持的领星 transport：${transport}`);
  }

  async function executeOnce() {
    assertConfigured();

    const pageClient = await globalThis.LingXingPageClient.connect({
      pageWindow: typeof unsafeWindow === 'object' ? unsafeWindow : window,
      requiredTransports: [FEATURE.request.transport],
      timeoutMs: 15000,
    });

    const raw = await callLingXing(pageClient);
    // TODO：在这里做严格的响应结构、分页总数、稳定主键、账号和筛选范围校验。
    // TODO：只有“完整快照”才能覆盖完整基线；筛选结果必须使用独立 scope。

    if (!FEATURE.bridge.datasetId && !FEATURE.bridge.artifactBucket) return raw;

    const bridge = createBridge();
    const capabilities = await bridge.capabilities();
    // TODO：先验证 capabilities 中确实存在本功能需要的资源，再写入。
    void capabilities;
    // TODO：按资源类型调用 bridge.ingestDataset(...) 或 bridge.uploadArtifact(...)。
    return raw;
  }

  async function runOnce() {
    if (running) throw new Error('上一轮尚未完成；为避免重复请求，本次未执行。');
    running = true;
    setRuntimeState('running', `正在运行：${FEATURE.title}`);
    try {
      const result = await executeOnce();
      setRuntimeState('idle', `最近一次运行已完成：${FEATURE.title}`);
      return result;
    } catch (error) {
      setRuntimeState('error', `运行失败：${error?.message || String(error)}`);
      throw error;
    } finally {
      running = false;
    }
  }

  async function pair() {
    assertConfigured();
    const code = prompt('请输入本地桥一次性配对码：');
    if (!code) return;
    const bridge = createBridge();
    await bridge.pair(code.trim());
    setRuntimeState('idle', `已配对，等待运行：${FEATURE.title}`);
    alert(`${FEATURE.title}：配对成功`);
  }

  GM_registerMenuCommand(`${FEATURE.title}：运行一次`, () => {
    runOnce().catch((error) => alert(`${FEATURE.title}：${error.message}`));
  });
  GM_registerMenuCommand(`${FEATURE.title}：桥接配对`, () => {
    pair().catch((error) => alert(`${FEATURE.title}：${error.message}`));
  });
  startRuntimeHeartbeat();
}());
