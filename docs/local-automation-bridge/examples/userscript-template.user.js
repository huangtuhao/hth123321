// ==UserScript==
// @name         本地自动化桥 v2 客户端模板（请改名）
// @namespace    https://example.invalid/local-automation-bridge
// @version      0.1.0
// @description  本地自动化桥 v2 接入模板；安装前必须替换站点和客户端配置。
// @match        https://example.invalid/*
// @connect      127.0.0.1
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

/*
 * 安装前必须完成：
 * 1. 把上面的 @match 从 example.invalid 改成唯一需要操作的网站；不要改成全站通配符。
 * 2. 把 sdk/bridge-client.js 的完整内容复制到本文件 metadata 之后、本段示例之前。
 *    不要使用远程 @require；这样脚本运行时不依赖外部代码源。
 * 3. 在 bridge.config.json 注册专用 clientId、站点来源和最小权限，然后替换下方占位值。
 * 4. 用本地 CLI 生成一次性配对码，由用户当次输入；不要把配对码或令牌写进源码。
 *
 * 此模板故意不会自动发请求。完成配置后，再把 main() 接到你的按钮或业务流程。
 */

(function userscriptExample() {
  'use strict';

  if (!globalThis.LocalAutomationBridge) {
    console.warn('请先把 sdk/bridge-client.js 的内容复制到此模板的 metadata 之后。');
    return;
  }

  const bridge = globalThis.LocalAutomationBridge.createLocalBridgeClient({
    clientId: 'replace_me_client',
    baseUrl: 'http://127.0.0.1:32145',
    tokenKey: 'replace_me_bridge_token_v2',
  });

  // 把用户当次输入的一次性配对码传进来；pair() 会只把换得的令牌写入 GM_setValue。
  async function pairOnce(pairingCode) {
    return bridge.pair(pairingCode);
  }

  async function main() {
    const capabilities = await bridge.capabilities();

    // 配置读取支持 ETag。若结果 notModified=true，请继续使用你在业务层已有的配置副本。
    // const configResult = await bridge.getConfig('replace_me_config', previousEtag);

    // 数据集 ID 必须已登记且当前客户端拥有写权限。
    // const ack = await bridge.ingestDataset('replace_me_dataset', { records: [] });

    // 只传文件名，不传本地路径。arrayBuffer 可来自页面下载响应或 File.arrayBuffer()。
    // const upload = await bridge.uploadArtifact(
    //   'replace_me_bucket',
    //   'example.pdf',
    //   arrayBuffer,
    //   'application/pdf',
    // );

    return capabilities;
  }

  // 按你的界面显式调用 pairOnce(code) 或 main()；不要在页面加载时自动配对或无限重试。
  void pairOnce;
  void main;
}());
