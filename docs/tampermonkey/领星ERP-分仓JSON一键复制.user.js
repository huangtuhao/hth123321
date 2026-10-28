// ==UserScript==
// @name         领星ERP-分仓JSON一键复制
// @namespace    http://tampermonkey.net/
// @version      4.3.0
// @description  领星创建货件页：点一下在独立标签页里算出「分仓 vs 合并」各方案成本，可逐票改渠道、按区域分配，页面可另存长期保留；保留复制分仓JSON。
// @author       You
// @match        *://erp.lingxing.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @connect      127.0.0.1
// @updateURL    http://127.0.0.1:32145/userscripts/%E9%A2%86%E6%98%9FERP-%E5%88%86%E4%BB%93JSON%E4%B8%80%E9%94%AE%E5%A4%8D%E5%88%B6.user.js
// @downloadURL  http://127.0.0.1:32145/userscripts/%E9%A2%86%E6%98%9FERP-%E5%88%86%E4%BB%93JSON%E4%B8%80%E9%94%AE%E5%A4%8D%E5%88%B6.user.js
// @connect      localhost
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const PAGE = typeof unsafeWindow !== 'undefined' ? unsafeWindow.document : document;
    const CLIENT_ID = 'userscript.lingxing.automation.v2';
    const BRIDGE = 'http://127.0.0.1:32145';
    const CFG_ID = 'freight_channels';
    const TOKEN_KEY = 'lx_freight_bridge_token';
    const PROVIDER_KEY = 'lx_freight_provider';
    const CFG_CACHE = 'lx_freight_cfg_cache';

    /* ============================================================
     * 独立分析页（来自 page.template.html + pricing.js + render.js + page.js）
     * 计算全部在未来那个标签页里完成，这里只负责取数和拼装
     * ============================================================ */
    (function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.FreightPage = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    var TPL = "<!doctype html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<title>分仓方案对比</title>\n<style>\n  * { box-sizing: border-box; }\n  html, body { margin: 0; padding: 0; }\n  body {\n    background: #f5f6f8; color: #111827; font-size: 13.5px; line-height: 1.6;\n    font-family: -apple-system, BlinkMacSystemFont, \"PingFang SC\", \"Microsoft YaHei\", sans-serif;\n  }\n  .wrap { max-width: 1120px; margin: 0 auto; padding: 22px 24px 60px; }\n\n  /* ---------- 顶部 ---------- */\n  .top { display: flex; align-items: flex-start; gap: 18px; margin-bottom: 16px; }\n  .top h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: .2px; }\n  .top .sub { margin-top: 4px; color: #6b7280; font-size: 12.5px; }\n  .top .sp { flex: 1; }\n  .top .right { display: flex; align-items: center; gap: 10px; flex: none; padding-top: 2px; }\n  .sel { padding: 7px 10px; border: 1px solid #d1d5db; border-radius: 8px; background: #fff;\n         font-size: 13px; color: #111827; cursor: pointer; }\n  .btn { border: none; cursor: pointer; border-radius: 8px; font-size: 13px; font-weight: 600;\n         padding: 8px 14px; transition: background .15s; }\n  .btn.ghost { background: #fff; color: #374151; border: 1px solid #d1d5db; }\n  .btn.ghost:hover { background: #f3f4f6; }\n  #hmeta { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }\n  .tag { background: #eef2ff; color: #3730a3; border-radius: 6px; padding: 3px 9px; font-size: 12px; }\n  .tag b { font-weight: 700; }\n  .tag.note { background: #fef3c7; color: #92400e; }\n\n  /* ---------- 结论卡 ---------- */\n  .rec { background: #fff; border: 1px solid #e5e7eb; border-left: 4px solid #10b981;\n         border-radius: 12px; padding: 16px 20px; box-shadow: 0 1px 3px rgba(15,23,42,.06); }\n  .rec.warnrec { border-left-color: #f59e0b; }\n  .rec .lab { font-size: 11.5px; font-weight: 700; letter-spacing: .3px; color: #10b981; }\n  .rec.warnrec .lab { color: #b45309; }\n  .rec .top { display: flex; align-items: baseline; gap: 12px; margin-top: 6px; flex-wrap: wrap; }\n  .rec .name { font-size: 17px; font-weight: 700; }\n  .rec .money { font-size: 24px; font-weight: 800; color: #b91c1c; font-variant-numeric: tabular-nums; }\n  .rec .sub { color: #6b7280; font-size: 12.5px; }\n  .rec .flag { margin-top: 10px; padding: 9px 12px; background: #fffbeb; border: 1px solid #fde68a;\n               border-radius: 8px; color: #92400e; font-size: 12.5px; line-height: 1.65; }\n\n  .alerts { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }\n  .alert { padding: 8px 12px; border-radius: 8px; font-size: 12.5px; }\n  .alert.warn { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }\n  .alert.info { background: #f0f9ff; color: #075985; border: 1px solid #bae6fd; }\n\n  /* ---------- 表格 ---------- */\n  .sec { margin: 24px 0 10px; font-size: 14px; font-weight: 700; display: flex; align-items: baseline; gap: 10px; }\n  .sec .hint { font-size: 12px; font-weight: 400; color: #9ca3af; }\n  .tblwrap { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden;\n             box-shadow: 0 1px 3px rgba(15,23,42,.05); }\n  table { width: 100%; border-collapse: collapse; }\n  th { text-align: left; font-weight: 600; color: #6b7280; background: #f9fafb; padding: 9px 12px;\n       font-size: 12px; border-bottom: 1px solid #eef0f3; white-space: nowrap; }\n  td { padding: 9px 12px; border-bottom: 1px solid #f1f3f5; vertical-align: middle; }\n  tr:last-child td { border-bottom: none; }\n  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }\n  tr.best { background: #f0fdf4; }\n  tr.dead { color: #9ca3af; }\n  tr.picked { background: #fffbeb; }\n  .sid { font-size: 10.5px; color: #9ca3af; font-family: ui-monospace, Menlo, Consolas, monospace; }\n\n  .pill { display: inline-block; border-radius: 5px; padding: 1px 6px; font-size: 10.5px;\n          font-weight: 600; line-height: 1.5; vertical-align: 1px; }\n  .pill.na { background: #f3f4f6; color: #6b7280; font-weight: 500; }\n  .pill.best { background: #10b981; color: #fff; }\n  .pill.kp { background: #dbeafe; color: #1e40af; }\n  .pill.ep { background: #fce7f3; color: #9f1239; }\n  .pill.eta-mixed { background: #fef3c7; color: #92400e; }\n  .pill.plus { background: #ffedd5; color: #9a3412; }\n  .pill.z-west { background: #dbeafe; color: #1d4ed8; }\n  .pill.z-mid  { background: #fef3c7; color: #b45309; }\n  .pill.z-east { background: #ede9fe; color: #5b21b6; }\n\n  /* ---------- 时效权重滑条 ---------- */\n  .wbar { display: flex; align-items: center; gap: 14px; background: #fff; border: 1px solid #e5e7eb;\n          border-radius: 10px; padding: 10px 14px; margin-bottom: 14px;\n          box-shadow: 0 1px 3px rgba(15,23,42,.05); }\n  .wbar .wlab { font-size: 12.5px; font-weight: 600; white-space: nowrap; }\n  .wbar .wlab b { color: #4f46e5; font-size: 15px; }\n  .wbar .wu { color: #9ca3af; font-weight: 400; font-size: 11px; }\n  .wbar input[type=range] { flex: 1; accent-color: #4f46e5; cursor: pointer; min-width: 120px; }\n  .wbar .whint { font-size: 11.5px; color: #6b7280; white-space: nowrap; }\n  @media (max-width: 900px) { .wbar { flex-wrap: wrap; } .wbar .whint { white-space: normal; } }\n\n  /* ---------- 渠道选择：按钮 + 展开面板 ---------- */\n  td.chcell { max-width: 430px; }\n  button.chbtn { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left;\n                 background: #fff; border: 1px solid #d1d5db; border-radius: 7px; padding: 5px 9px;\n                 font-size: 12px; cursor: pointer; color: #111827; line-height: 1.5; font-family: inherit; }\n  button.chbtn:hover { border-color: #818cf8; background: #f5f6ff; }\n  button.chbtn .chname { font-weight: 600; }\n  button.chbtn .chev { margin-left: auto; color: #6b7280; font-size: 11px; white-space: nowrap; }\n  tr.chpop-row > td { padding: 6px 12px 10px 34px; background: #fafbff; }\n  .chpop { display: flex; flex-direction: column; gap: 5px; padding: 8px; background: #fff;\n           border: 1px solid #c7d2fe; border-radius: 8px; max-height: 300px; overflow: auto; }\n  button.chopt { display: flex; flex-direction: column; align-items: flex-start; gap: 2px;\n                 background: #fff; border: 1px solid #e5e7eb; border-radius: 7px; padding: 6px 10px;\n                 font-size: 12px; cursor: pointer; text-align: left; color: #111827; font-family: inherit; }\n  button.chopt:hover { border-color: #818cf8; background: #f5f6ff; }\n  button.chopt.on { border-color: #10b981; background: #f0fdf4; }\n  button.chopt .o1 { font-weight: 600; }\n  button.chopt .o2 { color: #6b7280; font-size: 11.5px; }\n  .pill.cur { background: #10b981; color: #fff; }\n  .pill.cheap { background: #d1fae5; color: #047857; }\n  .pill.fast { background: #ede9fe; color: #5b21b6; }\n  .pill.rec { background: #4f46e5; color: #fff; }\n\n  /* ---------- 等待配置的 loading ---------- */\n  .loading { padding: 34px 30px; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px;\n             box-shadow: 0 1px 3px rgba(15,23,42,.05); }\n  .loading .lt { font-size: 15px; font-weight: 700; display: flex; align-items: center; gap: 10px; }\n  .loading .ls { margin-top: 6px; color: #6b7280; font-size: 12.5px; }\n  .spin { width: 15px; height: 15px; border: 2.5px solid #c7d2fe; border-top-color: #4f46e5;\n          border-radius: 50%; animation: spin .8s linear infinite; flex: none; }\n  @keyframes spin { to { transform: rotate(360deg); } }\n  .plog { margin-top: 14px; background: #0f172a; color: #cbd5e1; font-family: ui-monospace, Menlo, Consolas, monospace;\n          font-size: 11.5px; line-height: 1.7; padding: 12px 14px; border-radius: 8px;\n          max-height: 260px; overflow: auto; white-space: pre-wrap; word-break: break-all; }\n  .plog .t { color: #64748b; margin-right: 8px; }\n  .plog .bad { color: #fca5a5; }\n  .plog .ok { color: #86efac; }\n\n  /* ---------- 明细折叠 ---------- */\n  details.plan { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;\n                 margin-bottom: 8px; box-shadow: 0 1px 3px rgba(15,23,42,.05); }\n  details.plan > summary { cursor: pointer; padding: 11px 16px; display: flex; align-items: center;\n                           gap: 8px; font-weight: 600; list-style: none; user-select: none; }\n  details.plan > summary::-webkit-details-marker { display: none; }\n  details.plan > summary::before { content: '▸'; color: #9ca3af; font-size: 11px; margin-right: 2px; }\n  details.plan[open] > summary::before { content: '▾'; }\n  details.plan .inner { border-top: 1px solid #f1f3f5; padding: 4px 0 8px; }\n  details.plan .inner .tblwrap { border: none; box-shadow: none; border-radius: 0; }\n\n  .err { padding: 30px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; color: #991b1b; }\n  .foot { margin-top: 26px; color: #9ca3af; font-size: 11.5px; text-align: center; }\n</style>\n</head>\n<body>\n<div class=\"wrap\">\n  <div class=\"top\">\n    <div class=\"hleft\">\n      <h1 id=\"h1\">分仓方案对比</h1>\n      <div class=\"sub\" id=\"hsub\"></div>\n    </div>\n    <div class=\"sp\"></div>\n    <div class=\"right\">\n      <select class=\"sel\" id=\"prov\"></select>\n      <button class=\"btn ghost\" id=\"save\">另存为 HTML</button>\n    </div>\n  </div>\n  <div id=\"hmeta\"></div>\n  <div class=\"wbar\">\n    <span class=\"wlab\">⏱ 时效权重 <b id=\"wval\">0.20</b> <span class=\"wu\">元/kg/天</span></span>\n    <input type=\"range\" id=\"wrange\" min=\"0\" max=\"1\" step=\"0.05\" value=\"0.2\"\n           title=\"综合分 = 运费 + 权重 × 计费重 × 天数。0 = 只看价格；越大越偏向快渠道\">\n    <span class=\"whint\" id=\"whint\">推荐平衡</span>\n  </div>\n  <main id=\"app\"></main>\n  <div class=\"foot\">卡派=入仓口径，快递派=提取口径（到仓再加 3~5 天）· 数据与计算全部在本页完成，刷新不需要联网</div>\n</div>\n<script>\nvar CFG = @@CFG@@;\nvar INPUT = @@INPUT@@;\n/* =============================================================\n * 领星发货方案比价 · 定价内核（唯一运行时实现）\n * -------------------------------------------------------------\n * 纯函数，无 DOM、无网络、无第三方依赖。\n * 输入：配置包(freight-channels.json) + 分仓数据 + 合并候选\n * 输出：五档方案 + 逐仓明细 + 告警\n *\n * 口径（与 hub_case.py 必须一致）：\n *   计费重 = max(实重kg, 体积CBM × 167)\n *   卡派/海派整票计费；快递派单箱 12KG 低消 → max(kg, 箱数×12, CBM×167)\n *   新仓小票（口头价渠道）整票 <50KG 时单价 +1\n *   配置费 = placementFee(USD) × 6.70\n *   30 天红线：max(最晚) − min(最早) > 30 → 告警\n * ============================================================= */\n(function (root, factory) {\n  if (typeof module === 'object' && module.exports) module.exports = factory();\n  else root.FreightPricing = factory();\n})(typeof globalThis !== 'undefined' ? globalThis : this, function () {\n  'use strict';\n\n  var DAY_MS = 86400000;\n\n  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }\n  function r2(v) { return Math.round(v * 100) / 100; }\n\n  /* ---------- 时效权重（学习自老版分仓分析器 V5.1）----------\n   * 票层：综合成本 = 运费 + 权重 × 计费重 × 天数\n   *      （等价于按「单价 + 天数 × 权重(元/kg/天)」排序，与老分析器同构）\n   * 权重 = 0 → 纯看价格，行为与旧版完全一致；\n   * 无时效数据的渠道按 100 天计（与老分析器 999→100 的口径一致）。\n   * 方案层：score = 总价 + 权重 × Σ(计费重×天数)，即逐票综合成本之和 + 配置费。\n   */\n  function daysOf(item) {\n    return item.eta ? (item.eta.lo + item.eta.hi) / 2 : 100;\n  }\n  function candScore(item, weight) {\n    return item.cost + (weight || 0) * item.bill * daysOf(item);\n  }\n  function planScore(p, weight) {\n    if (p.total === null) return Infinity;\n    return p.total + (weight || 0) * (p.dayKg || 0);\n  }\n\n  /* ---------- 计费重 ---------- */\n  function billable(kg, cbm, boxes, divisor, boxFloor, isExpress) {\n    var byVolume = cbm * divisor;\n    if (!isExpress) return Math.max(kg, byVolume);\n    return Math.max(kg, boxes * boxFloor, byVolume);\n  }\n\n  /* ---------- 档位取价 ---------- */\n  function tierPrice(tiers, bill) {\n    if (!tiers || !tiers.length) return null;\n    var pick = null;\n    for (var i = 0; i < tiers.length; i++) {\n      if (tiers[i][0] <= bill) pick = tiers[i];\n      else break;\n    }\n    if (!pick) pick = tiers[0];            // 低于表格起订量 → 按起订量计（最低消费）\n    return { wmin: pick[0], price: pick[1], bill: Math.max(bill, pick[0]) };\n  }\n\n  /* ---------- 索引：把紧凑行解析成 仓→渠道→档位 ----------\n   * 行格式： 仓|渠道|档=价,档=价;仓|渠道|...\n   * 解析一次后按 (publication_id, provider) 缓存\n   */\n  var _idxCache = { key: null, idx: null };\n\n  function parseRows(str) {\n    var idx = Object.create(null);\n    if (!str) return idx;\n    var parts = str.split(';');\n    for (var i = 0; i < parts.length; i++) {\n      var a = parts[i].split('|');\n      if (a.length < 3) continue;\n      var wh = a[0], code = a[1];\n      var seg = a[2].split(',');\n      var tiers = [];\n      for (var j = 0; j < seg.length; j++) {\n        var kv = seg[j].split('=');\n        if (kv.length < 2) continue;\n        tiers.push([Number(kv[0]) || 0, Number(kv[1]) || 0]);\n      }\n      if (!tiers.length) continue;\n      tiers.sort(function (x, y) { return x[0] - y[0]; });\n      (idx[wh] || (idx[wh] = Object.create(null)))[code] = tiers;\n    }\n    return idx;\n  }\n\n  function tableOf(cfg, provider) {\n    var key = (cfg.publication_id || '') + '|' + provider;\n    if (_idxCache.key === key) return _idxCache.idx;\n    var pv = cfg.providers[provider] || {};\n    var idx = pv.rows ? parseRows(pv.rows) : (pv.wh || Object.create(null));\n    _idxCache = { key: key, idx: idx };\n    return idx;\n  }\n\n  /* ---------- 单个货件选渠道 ---------- */\n  function priceShipment(cfg, provider, sh, opts) {\n    opts = opts || {};\n    var weight = opts.weight || 0;\n    var P = cfg.params || {};\n    var vd = P.volumetric_divisor || 167;\n    var boxFloor = P.box_floor_kg || 12;\n    var lotKg = P.small_lot_kg || 50;\n    var lotAdd = P.small_lot_add || 1;\n\n    var wh = String(sh.warehouseCode || sh.wh || '');\n    var kg = num(sh.weight), cbm = num(sh.volume), boxes = Math.max(1, num(sh.boxCount));\n    var pv = cfg.providers[provider] || {};\n    var table = tableOf(cfg, provider)[wh];\n    var isManualWh = (pv.manual_wh || []).indexOf(wh) >= 0;\n    var whInfo = (cfg.warehouses || {})[wh] || {};\n    /* 手动指定的渠道：页面里改过渠道后，这一票就锁定到该渠道 */\n    var forced = String(opts.channel || sh.pickChannel || '');\n\n    var result = {\n      wh: wh, zone: whInfo.z || '', zip: whInfo.zip || '',\n      kg: kg, cbm: cbm, boxes: boxes,\n      shipmentId: sh.shipmentId || sh.shipment_id || '',\n      shipmentName: sh.shipmentName || '',\n      pickChannel: forced || null, pickMissing: false,\n      channel: null, channelName: null, mode: null, price: null,\n      bill: null, cost: null, eta: null, etaKind: null,\n      alt: [], all: [], missing: !table, candidates: 0\n    };\n    if (!table) { result.pickMissing = !!forced; return result; }\n\n    var codes = Object.keys(table);\n    for (var i = 0; i < codes.length; i++) {\n      var code = codes[i];\n      var meta = cfg.channels[provider + '|' + code];\n      if (!meta) continue;\n      var isExpress = (meta.m && meta.m !== '卡派');\n      var bill = billable(kg, cbm, boxes, vd, boxFloor, isExpress);\n      var tp = tierPrice(table[code], bill);\n      if (!tp) continue;\n\n      var price = tp.price;\n      // 新仓小票：口头价渠道、整票不足 50KG → 单价 +1\n      if (isManualWh && !isExpress && Math.max(kg, cbm * vd) < lotKg) price += lotAdd;\n\n      var cost = r2(tp.bill * price);\n      var etaKind = meta.k || (isExpress ? 'pick' : 'in');\n      var item = {\n        channel: code, channelName: meta.n, mode: meta.m,\n        price: r2(price), bill: r2(tp.bill), cost: cost,\n        eta: meta.d ? { lo: meta.d[0], hi: meta.d[1], kind: etaKind } : null,\n        etaKind: etaKind,\n        etaRaw: meta.t || '', taxStatus: meta.ts || 'stated'\n      };\n      item.days = daysOf(item);\n      item.score = candScore(item, weight);          // 权重为 0 时等价于按运费排\n      result.candidates++;\n      result.all.push(item);\n    }\n    if (result.all.length) result.all.sort(function (a, b) {\n      return (a.score - b.score) || (a.cost - b.cost) || (a.days - b.days);\n    });\n    result.alt = result.all;\n    /* 最便宜渠道（与权重无关，用于「比最便宜贵多少」） */\n    var cheapest = null;\n    for (var c = 0; c < result.all.length; c++) {\n      if (!cheapest || result.all[c].cost < cheapest.cost) cheapest = result.all[c];\n    }\n\n    /* 选中的渠道：手动指定优先，否则取最便宜 */\n    var pick = null;\n    if (forced) {\n      for (var m = 0; m < result.all.length; m++) {\n        if (result.all[m].channel === forced) { pick = result.all[m]; break; }\n      }\n      if (!pick) result.pickMissing = true;\n    } else if (result.all.length) {\n      pick = result.all[0];\n    }\n    if (pick) {\n      for (var k in pick) if (Object.prototype.hasOwnProperty.call(pick, k)) result[k] = pick[k];\n      result.chosen = pick.channel;\n      result.cheapest = cheapest.channel;\n      result.extra = r2(pick.cost - cheapest.cost);   // 比最便宜贵多少（与权重无关）\n    }\n    return result;\n  }\n\n  /* ---------- 方案交期 ---------- */\n  function planEta(rows) {\n    var mn = Infinity, mx = -Infinity, kinds = {};\n    rows.forEach(function (r) {\n      if (!r.eta) return;\n      kinds[r.eta.kind] = (kinds[r.eta.kind] || 0) + 1;\n      mn = Math.min(mn, r.eta.lo);\n      mx = Math.max(mx, r.eta.hi);\n    });\n    if (!isFinite(mn)) return null;\n    var ks = Object.keys(kinds);\n    return { lo: mn, hi: mx, kind: ks.length === 1 ? ks[0] : 'mixed', raw: kinds };\n  }\n\n  /* ---------- 主入口 ---------- */\n  function analyze(cfg, input) {\n    if (!cfg) throw new Error('缺少配置包');\n    var provider = input.provider || cfg.default_provider;\n    if (!cfg.providers[provider]) throw new Error('配置里没有货代：' + provider);\n\n    var P = cfg.params || {};\n    var rate = P.usd_rate || 6.70;\n    var vd = P.volumetric_divisor || 167;\n    var weight = input.weight || 0;\n    var split = input.split;\n    var merges = input.merges || [];\n    var today = input.today ? new Date(input.today) : new Date();\n\n    var shipments = split.shipments || [];\n    var kgTot = shipments.reduce(function (s, x) { return s + num(x.weight); }, 0);\n    var cbmTot = shipments.reduce(function (s, x) { return s + num(x.volume); }, 0);\n    var boxTot = shipments.reduce(function (s, x) { return s + Math.max(1, num(x.boxCount)); }, 0);\n\n    var plans = [];\n\n    /* --- 分仓 --- */\n    var sRows = shipments.map(function (s) { return priceShipment(cfg, provider, s, { weight: weight }); });\n    var sMissing = sRows.filter(function (r) { return r.missing; }).map(function (r) { return r.wh; });\n    var sNoPrice = sRows.filter(function (r) { return !r.missing && r.cost === null; }).map(function (r) { return r.wh; });\n    var sFreight = sRows.reduce(function (a, r) { return a + (r.cost || 0); }, 0);\n    var sDayKg = sRows.reduce(function (a, r) { return a + (r.bill && r.days ? r.bill * r.days : 0); }, 0);\n    plans.push({\n      key: 'split',\n      name: shipments.length + ' 货件分仓',\n      freight: r2(sFreight),\n      fee: 0,\n      total: r2(sFreight),\n      dayKg: r2(sDayKg),\n      rows: sRows,\n      eta: planEta(sRows),\n      missing: sMissing,\n      noPrice: sNoPrice,\n      complete: sMissing.length === 0 && sNoPrice.length === 0\n    });\n\n    /* --- 合并 --- */\n    merges.forEach(function (m, idx) {\n      var s = (m.shipments || [])[0] || {};\n      var wh = s.warehouseCode;\n      var filled = false;\n      var sh = {\n        warehouseCode: wh,\n        weight: num(s.weight) || kgTot,\n        volume: num(s.volume) || cbmTot,\n        boxCount: Math.max(1, num(s.boxCount) || boxTot)\n      };\n      if (!num(s.weight) || !num(s.volume) || !num(s.boxCount)) filled = true;\n      var r = priceShipment(cfg, provider, sh, { weight: weight });\n      var fee = r2(num(m.placementFee) * rate);\n      plans.push({\n        key: 'merge' + idx,\n        name: '1 货件 → ' + wh,\n        freight: r.cost === null ? null : r2(r.cost),\n        fee: fee,\n        total: r.cost === null ? null : r2(r.cost + fee),\n        dayKg: (r.bill && r.days) ? r2(r.bill * r.days) : 0,\n        rows: [r],\n        eta: planEta([r]),\n        missing: r.missing ? [wh] : [],\n        noPrice: (!r.missing && r.cost === null) ? [wh] : [],\n        complete: r.cost !== null,\n        filledFromSplit: filled,\n        placementFeeUSD: num(m.placementFee)\n      });\n    });\n\n    /* --- 排序 --- */\n    var ok = plans.filter(function (p) { return p.total !== null; });\n    ok.sort(function (a, b) { return a.total - b.total; });\n    var best = ok.length ? ok[0].total : null;\n    plans.forEach(function (p) {\n      p.delta = p.total === null || best === null ? null : r2(p.total - best);\n      p.isBest = p.total !== null && p.total === best;\n      p.winner = p.eta ? p.eta : null;\n    });\n\n    /* --- 告警 --- */\n    var warnings = [];\n    var eff = new Date(cfg.effective_at || 0);\n    var exp = new Date(cfg.expires_at || 0);\n    if (exp && exp < today) {\n      warnings.push({ level: 'warn', code: 'expired',\n        text: '报价配置已于 ' + String(cfg.expires_at || '').slice(0, 10) + ' 过期，请更新报价表后重新发布' });\n    } else if (exp && (exp - today) / DAY_MS < 7) {\n      warnings.push({ level: 'info', code: 'expiring',\n        text: '报价配置还有 ' + Math.round((exp - today) / DAY_MS) + ' 天过期' });\n    }\n    if (sMissing.length) warnings.push({ level: 'warn', code: 'missing',\n      text: sMissing.join('、') + ' 在该货代报价里查不到（分仓方案不可用）' });\n    if (sNoPrice.length) warnings.push({ level: 'warn', code: 'noprice',\n      text: sNoPrice.join('、') + ' 有渠道但没有匹配档位（分仓方案不可用）' });\n\n    var bestPlan = ok[0];\n    if (bestPlan && bestPlan.eta && bestPlan.eta.kind === 'mixed') {\n      warnings.push({ level: 'info', code: 'eta_mixed',\n        text: '该方案混用了「入仓」与「提取」两种时效口径，到仓要按提取时间再加 3~5 天看' });\n    }\n    if (bestPlan && bestPlan.eta && (bestPlan.eta.hi - bestPlan.eta.lo) > 30) {\n      warnings.push({ level: 'warn', code: 'span',\n        text: '首个货件与最晚货件预计相差 ' + (bestPlan.eta.hi - bestPlan.eta.lo) +\n              ' 天，超过亚马逊「首个送达后 30 天内全部送达」红线' });\n    }\n    var assumeCnt = 0;\n    plans.forEach(function (p) {\n      p.rows.forEach(function (r) { if (r.taxStatus === 'assumed') assumeCnt++; });\n    });\n    if (assumeCnt) warnings.push({ level: 'info', code: 'tax_assumed',\n      text: assumeCnt + ' 个货件用了「包税口径为推断」的渠道，正式下单前跟货代确认一句' });\n\n    return {\n      provider: provider,\n      quoteDate: (cfg.providers[provider] || {}).quote_date || '',\n      publication: cfg.publication_id || '',\n      params: { usd_rate: rate, volumetric_divisor: vd, weight: weight },\n      totals: {\n        kg: r2(kgTot), cbm: r2(cbmTot), boxes: boxTot,\n        bill: r2(Math.max(kgTot, cbmTot * vd))\n      },\n      plans: plans,\n      best: ok.length ? ok[0].key : null,\n      bestTotal: best,\n      warnings: warnings\n    };\n  }\n\n  /* ---------- 文案：一句话结论 ---------- */\n  function verdict(res) {\n    if (!res || !res.plans.length) return '';\n    var ok = res.plans.filter(function (p) { return p.total !== null; })\n      .sort(function (a, b) { return a.total - b.total; });\n    if (!ok.length) return '所有方案都缺报价，先去补报价表';\n    var w = ok[0];\n    var s = '推荐「' + w.name + '」¥' + w.total.toFixed(2);\n    if (w.eta) {\n      var ek = w.eta.kind === 'mixed' ? '（混口径）' : '';\n      s += '，' + w.eta.lo + '-' + w.eta.hi + ' 天到齐' + ek;\n    }\n    if (ok[1]) {\n      var d = ok[1].total - w.total;\n      s += '；比次优「' + ok[1].name + '」省 ¥' + d.toFixed(2);\n    }\n    return s;\n  }\n\n  return {\n    analyze: analyze,\n    verdict: verdict,\n    priceShipment: priceShipment,\n    billable: billable,\n    tierPrice: tierPrice,\n    daysOf: daysOf,\n    planScore: planScore\n  };\n});\n/* =============================================================\n * 渲染层：把 analyze() 的结果变成 HTML\n * 纯函数，不碰 DOM（便于离线预览和回归）\n *\n * v4：为「独立页面」服务\n *   - 仓库后带美西/美中/美东区域标识\n *   - 每票渠道可切换（输出 select，交互由 page.js 绑定）\n *   - 显示货件号\n * ============================================================= */\n(function (root, factory) {\n  if (typeof module === 'object' && module.exports) module.exports = factory();\n  else root.FreightRender = factory();\n})(typeof globalThis !== 'undefined' ? globalThis : this, function () {\n  'use strict';\n\n  function esc(s) {\n    return String(s == null ? '' : s).replace(/[&<>\"']/g,\n      function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' })[c]; });\n  }\n\n  function etaText(eta) {\n    if (!eta) return '<span class=\"pill na\">无时效</span>';\n    if (eta.kind === 'mixed') {\n      return eta.lo + '-' + eta.hi + ' 天 <span class=\"pill eta-mixed\" '\n        + 'title=\"混用了入仓与提取两种口径，到仓要按提取时间再加 3~5 天\">混</span>';\n    }\n    var k = eta.kind === 'pick' ? '提取' : '入仓';\n    return eta.lo + '-' + eta.hi + ' 天 <span class=\"pill na\">' + k + '</span>';\n  }\n\n  /* 区域标签：美西 / 美西二区 → 蓝，美中 → 橙，美东 → 紫 */\n  function zonePill(z) {\n    if (!z) return '';\n    var cls = z.indexOf('美西') === 0 ? 'z-west' : (z === '美中' ? 'z-mid' : 'z-east');\n    var tip = { '美西': '美国西部', '美西二区': '美国西部二区', '美中': '美国中西部', '美东': '美国东部' }[z] || z;\n    return '<span class=\"pill ' + cls + '\" title=\"' + esc(tip) + '\">' + esc(z) + '</span>';\n  }\n\n  /* ---------- 渠道选择：按钮 + 展开面板（2026-10-26 定）----------\n   * 下拉看不到全部选项，改成：点渠道单元格展开面板，所有候选直接列出、点选即换。\n   * 面板里每个选项带：完整渠道名、模式、单价×计费重=金额、时效、比最省贵多少、\n   * 以及「当前 / 最省 / 最快 / 综合」徽标（综合 = 当前权重下的推荐）。\n   */\n\n  function etaShort(a) {\n    if (!a.eta) return '无时效';\n    var k = a.eta.kind === 'pick' ? ' 提取' : (a.eta.kind === 'mixed' ? ' 混' : '');\n    return a.eta.lo + '-' + a.eta.hi + ' 天' + k;\n  }\n\n  function channelCell(r, interactive, dataKey, wopts) {\n    var modeCls = r.mode === '卡派' ? 'kp' : 'ep';\n    if (!interactive || !r.all || r.all.length < 2) {\n      return '<td>' + esc(r.channelName || r.channel)\n        + ' <span class=\"pill ' + modeCls + '\">' + esc(r.mode) + '</span></td>';\n    }\n    var open = wopts && wopts.openPanel === dataKey;\n    return '<td class=\"chcell\"><button class=\"chbtn\" data-key=\"' + esc(dataKey) + '\"'\n      + ' title=\"点击展开该仓全部 ' + r.all.length + ' 个可选渠道，直接点选\">'\n      + '<span class=\"chname\">' + esc(r.channelName || r.channel) + '</span>'\n      + ' <span class=\"pill ' + modeCls + '\">' + esc(r.mode) + '</span>'\n      + '<span class=\"chev\">' + (open ? '▲ 收起' : '▼ 共 ' + r.all.length + ' 个') + '</span>'\n      + '</button></td>';\n  }\n\n  function channelPanel(r, dataKey, weight) {\n    var w = weight || 0;\n    var minCost = Infinity, minDays = Infinity, bestScore = Infinity;\n    r.all.forEach(function (a) {\n      if (a.cost < minCost) minCost = a.cost;\n      if (a.eta && a.days < minDays) minDays = a.days;\n      if (a.score < bestScore) bestScore = a.score;\n    });\n    var opts = r.all.map(function (a) {\n      var badges = '';\n      if (a.channel === r.chosen) badges += ' <span class=\"pill cur\">当前</span>';\n      if (a.cost <= minCost + 0.005) badges += ' <span class=\"pill cheap\">最省</span>';\n      if (a.eta && a.days <= minDays + 0.01) badges += ' <span class=\"pill fast\">最快</span>';\n      if (w > 0 && a.score <= bestScore + 0.005 && a.channel !== r.chosen)\n        badges += ' <span class=\"pill rec\">综合推荐</span>';\n      var diff = a.cost - minCost;\n      return '<button class=\"chopt' + (a.channel === r.chosen ? ' on' : '') + '\"'\n        + ' data-key=\"' + esc(dataKey) + '\" data-ch=\"' + esc(a.channel) + '\">'\n        + '<span class=\"o1\">' + esc(a.channelName) + badges + '</span>'\n        + '<span class=\"o2\">¥' + a.price.toFixed(2) + '/kg × ' + a.bill.toFixed(1) + 'kg'\n        + ' = <b>¥' + a.cost.toFixed(2) + '</b> · ' + etaShort(a)\n        + (diff > 0.005 ? ' · 比最省 +¥' + diff.toFixed(2) : '')\n        + '</span></button>';\n    }).join('');\n    return '<tr class=\"chpop-row' + (r.chosen ? '' : ' dead') + '\"><td colspan=\"6\">'\n      + '<div class=\"chpop\">' + opts + '</div></td></tr>';\n  }\n\n  /**\n   * @param res  analyze() 结果\n   * @param opts {interactive:bool, editable:function(plan)->bool,\n   *               weight:number 元/kg/天, order:[planKey] 基线顺序, openPanel:key}\n   */\n  function resultHtml(res, opts) {\n    opts = opts || {};\n    var interactive = !!opts.interactive;\n    var W = opts.weight || 0;\n    /* 综合分 = 总价 + 权重 × Σ(计费重×天数)；权重 0 时退化为纯价格 */\n    function score(p) { return p.total === null ? Infinity : p.total + W * (p.dayKg || 0); }\n\n    /* 方案顺序：优先用外部传入的基线顺序（切渠道不跳变），否则按综合分 */\n    var plans = res.plans.slice();\n    if (opts.order && opts.order.length) {\n      var pos = {};\n      opts.order.forEach(function (k, i) { pos[k] = i; });\n      plans.sort(function (a, b) {\n        var da = a.total === null, db = b.total === null;\n        if (da !== db) return da ? 1 : -1;\n        var oa = pos[a.key] === undefined ? 999 : pos[a.key];\n        var ob = pos[b.key] === undefined ? 999 : pos[b.key];\n        return (oa - ob) || (a.total - b.total);\n      });\n    } else {\n      plans.sort(function (a, b) { return score(a) - score(b); });\n    }\n    /* 推荐（综合最优）：按当前权重和当前渠道选择算，只影响徽标和结论卡，不影响顺序 */\n    var best = null;\n    for (var i = 0; i < plans.length; i++) {\n      if (plans[i].total !== null && (!best || score(plans[i]) < score(best))) best = plans[i];\n    }\n\n    /* ---- 结论卡 ---- */\n    var isShip = opts.mode === 'shipment';\n    var rec = '';\n    if (best) {\n      var spanWarn = best.eta && (best.eta.hi - best.eta.lo) > 30;\n      function mid(p) { return p.eta ? (p.eta.lo + p.eta.hi) / 2 : null; }\n      var next = null;\n      for (var j = 0; j < plans.length; j++) {\n        if (plans[j] !== best && plans[j].total !== null\n            && (!next || score(plans[j]) < score(next))) next = plans[j];\n      }\n      var nextLine = '';\n      if (next) {\n        if (W > 0) {\n          var dDays = mid(next) !== null && mid(best) !== null ? mid(next) - mid(best) : null;\n          nextLine = ' · 次优「' + esc(next.name) + '」总价 ¥' + next.total.toFixed(2)\n            + (dDays ? '，' + (dDays > 0 ? '慢 ' : '快 ') + Math.abs(dDays).toFixed(1) + ' 天' : '')\n            + '，综合差 ¥' + (score(next) - score(best)).toFixed(2);\n        } else {\n          nextLine = ' · 比次优「' + esc(next.name) + '」省 ¥' + (next.total - best.total).toFixed(2);\n        }\n      }\n      var etaLine = best.eta\n        ? ('预计 ' + best.eta.lo + '-' + best.eta.hi + ' 天到齐' +\n           (best.eta.kind === 'mixed' ? '（混口径）' : ''))\n        : '该渠道无时效数据';\n      var slowRow = null, fastRow = null;\n      (best.rows || []).forEach(function (r) {\n        if (!r.eta) return;\n        if (!slowRow || r.eta.hi > slowRow.eta.hi) slowRow = r;\n        if (!fastRow || r.eta.lo < fastRow.eta.lo) fastRow = r;\n      });\n      var labText = isShip ? '当前这批货'\n        : (spanWarn ? '最便宜，但交期有风险' : (W > 0 ? '综合推荐' : '推荐'));\n      rec = '<div class=\"rec ' + (spanWarn ? 'warnrec' : '') + '\">'\n        + '<div class=\"lab\">' + labText + '</div>'\n        + '<div class=\"top\">'\n        + '<span class=\"name\">' + esc(best.name) + '</span>'\n        + '<span class=\"money\">¥' + best.total.toFixed(2) + '</span>'\n        + '<span class=\"sub\">' + (best.fee > 0\n            ? '运费 ¥' + best.freight.toFixed(2) + ' + 配置费 ¥' + best.fee.toFixed(2)\n            : '全部为运费，分仓不收配置费') + '</span>'\n        + '</div>'\n        + '<div class=\"sub\" style=\"margin-top:6px\">' + etaLine + nextLine\n        + '</div>'\n        + (spanWarn && slowRow\n            ? '<div class=\"flag\">最早 <b>' + esc(fastRow.wh) + '</b> ' + fastRow.eta.lo + '-' + fastRow.eta.hi\n              + ' 天，最晚 <b>' + esc(slowRow.wh) + '</b> ' + slowRow.eta.lo + '-' + slowRow.eta.hi\n              + ' 天（' + esc(slowRow.channelName || slowRow.channel) + '），相差 ' + (slowRow.eta.hi - fastRow.eta.lo)\n              + ' 天，超过亚马逊「首个送达后 30 天内全部送达」红线。'\n              + '把 ' + esc(slowRow.wh) + ' 这票单独换快船，其他票不用动。</div>'\n            : '')\n        + '</div>';\n    }\n\n    /* ---- 告警（跨度已进结论卡，这里不重复） ---- */\n    var alerts = (res.warnings || []).filter(function (w) { return w.code !== 'span'; })\n      .map(function (w) {\n        return '<div class=\"alert ' + (w.level === 'warn' ? 'warn' : 'info') + '\">' + esc(w.text) + '</div>';\n      }).join('');\n    var alertBlock = alerts ? '<div class=\"alerts\">' + alerts + '</div>' : '';\n\n    /* ---- 主表 ---- */\n    var rows = plans.map(function (p) {\n      var dead = p.total === null;\n      var why = '';\n      if (p.missing && p.missing.length) why = ' <span class=\"pill na\">' + esc(p.missing.join(',')) + ' 无报价</span>';\n      else if (p.noPrice && p.noPrice.length) why = ' <span class=\"pill na\">无匹配档位</span>';\n      return '<tr class=\"' + (p === best ? 'best' : '') + ' ' + (dead ? 'dead' : '') + '\">'\n        + '<td>' + esc(p.name) + (p === best ? ' <span class=\"pill best\">'\n            + (W > 0 ? '综合最优' : '最优') + '</span>' : '') + why + '</td>'\n        + '<td class=\"num\">' + (p.freight === null ? '—' : p.freight.toFixed(2)) + '</td>'\n        + '<td class=\"num\">' + (p.fee ? p.fee.toFixed(2) : '—') + '</td>'\n        + '<td class=\"num\"><b>' + (dead ? '—' : p.total.toFixed(2)) + '</b></td>'\n        + '<td class=\"num\">' + (p.delta === null || p.delta === 0 ? '—' : '+' + p.delta.toFixed(2)) + '</td>'\n        + '<td>' + etaText(p.eta) + '</td>'\n        + '</tr>';\n    }).join('');\n\n    /* ---- 逐仓明细（可改渠道） ---- */\n    var details = plans.filter(function (p) {\n      return p.rows.some(function (r) { return r.channel || r.missing; });\n    }).map(function (p) {\n      var editable = !opts.editable || opts.editable(p);\n      var inner = p.rows.map(function (r, ri) {\n        if (!r.channel) {\n          return '<tr><td><b>' + esc(r.wh) + '</b> ' + zonePill(r.zone) + '</td><td colspan=\"5\" class=\"num\">'\n            + '<span class=\"pill na\">' + (r.missing ? '报价库里没有这个仓' : '该仓所有渠道都无匹配档位')\n            + (r.pickMissing ? '（手动指定的渠道已不可用）' : '')\n            + '</span></td></tr>';\n        }\n        var key = p.key + '|' + ri;\n        var extra = (r.extra && r.extra > 0)\n          ? ' <span class=\"pill plus\" title=\"比该仓最便宜的渠道贵\">+' + r.extra.toFixed(2) + '</span>'\n          : '';\n        var sid = r.shipmentId\n          ? '<div class=\"sid\">' + esc(r.shipmentId) + '</div>' : '';\n        var row = '<tr' + (r.pickChannel ? ' class=\"picked\"' : '') + '>'\n          + '<td><b>' + esc(r.wh) + '</b> ' + zonePill(r.zone) + sid + '</td>'\n          + channelCell(r, interactive && editable, key, opts)\n          + '<td class=\"num\">' + r.bill.toFixed(2) + ' × ' + r.price.toFixed(2) + '</td>'\n          + '<td class=\"num\"><b>' + r.cost.toFixed(2) + '</b>' + extra + '</td>'\n          + '<td>' + etaText(r.eta) + '</td>'\n          + '<td class=\"num\">' + (r.all && r.all.length > 1 ? '共 ' + r.all.length + ' 个' : '') + '</td>'\n          + '</tr>';\n        var panel = (interactive && editable && opts.openPanel === key\n                     && r.all && r.all.length > 1) ? channelPanel(r, key, W) : '';\n        return row + panel;\n      }).join('');\n      return '<details class=\"plan\" ' + (p.isBest ? 'open' : '') + '>'\n        + '<summary data-pk=\"' + esc(p.key) + '\">' + esc(p.name)\n        + '<span style=\"margin-left:auto;font-variant-numeric:tabular-nums\">'\n        + (p.total === null ? '缺报价' : '¥' + p.total.toFixed(2)) + '</span></summary>'\n        + '<div class=\"inner\"><div class=\"tblwrap\"><table>'\n        + '<thead><tr><th>仓库 / 区域</th><th>渠道' + (interactive && editable ? '（可切换）' : '') + '</th>'\n        + '<th class=\"num\">计费重 × 单价</th><th class=\"num\">金额</th><th>时效</th><th class=\"num\">可选</th></tr></thead>'\n        + '<tbody>' + inner + '</tbody></table></div>'\n        + (p.filledFromSplit\n            ? '<div style=\"margin-top:8px;font-size:11.5px;color:#9ca3af\">合并票的重量/体积/箱数页面未给，按分仓合计回填</div>'\n            : '')\n        + '</div></details>';\n    }).join('');\n\n    return rec + alertBlock\n      + '<div class=\"sec\">' + (isShip ? '这批货的总成本' : '各方案总成本') + '</div>'\n      + '<div class=\"tblwrap\"><table><thead><tr><th>方案</th><th class=\"num\">运费</th>'\n      + '<th class=\"num\">配置费</th><th class=\"num\">合计</th><th class=\"num\">差额</th><th>预计时效</th></tr></thead>'\n      + '<tbody>' + rows + '</tbody></table></div>'\n      + '<div class=\"sec\">逐仓渠道明细' + (interactive ? '<span class=\"hint\">改任意一票的渠道，总价会立刻重算</span>' : '') + '</div>'\n      + details\n      + '<div style=\"margin-top:16px;color:#9ca3af;font-size:11.5px\">'\n      + '计费重 ' + res.totals.bill + ' KG（' + res.totals.kg + ' KG 实重 / ' + res.totals.cbm + ' M³ × '\n      + res.params.volumetric_divisor + '） · 汇率 ' + res.params.usd_rate\n      + (W > 0 ? ' · 时效权重 ' + W.toFixed(2) + ' 元/kg/天' : ' · 只看价格（时效权重 0）')\n      + ' · 货代 ' + esc(res.provider) + ' ' + esc(res.quoteDate) + ' 版</div>';\n  }\n\n  return { esc: esc, etaText: etaText, zonePill: zonePill, resultHtml: resultHtml };\n});\n/* =============================================================\n * 独立分析页面的运行时\n * - 依赖注入：CFG（报价配置，可先为 null 由油猴 postMessage 补送）、INPUT（本批货件数据）\n * - 提供：切货代、逐票改渠道、总价实时重算、另存为 HTML\n * - v4.1：点击后页面立即打开；配置未就绪时显示 loading 和每步耗时，\n *         配置由来源页通过 postMessage 送进来（用户 2026-10-23 定）\n * ============================================================= */\n(function () {\n  'use strict';\n\n  var cfg = window.CFG || null;\n  var input = window.INPUT || null;\n  var picks = {};                                  // idx -> channel\n  var weight = 0.2;                                // 时效权重 元/kg/天（0=只看价格）\n  var openPanel = null;                            // 当前展开的渠道选择面板 key\n  var provider = (input && input.provider) || (cfg && cfg.default_provider) || '';\n  var appEl = document.getElementById('app');\n  var headEl = document.getElementById('hmeta');\n  var t0 = (window.performance && performance.now) ? performance.now() : Date.now();\n  var logLines = [];\n\n  function now() {\n    return ((window.performance && performance.now ? performance.now() : Date.now()) - t0) / 1000;\n  }\n  function escLog(s) {\n    return String(s).replace(/[&<>]/g, function (c) {\n      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];\n    });\n  }\n  function logLine(text, cls) {\n    logLines.push({ t: now(), text: text, cls: cls || '' });\n    var box = document.getElementById('plog');\n    if (box) {\n      var d = document.createElement('div');\n      if (cls) d.className = cls;\n      d.innerHTML = '<span class=\"t\">+' + now().toFixed(2) + 's</span>' + escLog(text);\n      box.appendChild(d);\n      box.scrollTop = box.scrollHeight;\n    }\n  }\n\n  /* ---------- 状态恢复（从另存的文件重新打开时） ---------- */\n  function readState() {\n    var el = document.getElementById('__state__');\n    if (!el) return;\n    try {\n      var s = JSON.parse(el.textContent || '{}');\n      if (s.picks && typeof s.picks === 'object') picks = s.picks;\n      if (typeof s.weight === 'number' && s.weight >= 0) weight = s.weight;\n      if (s.provider && cfg && cfg.providers[s.provider]) provider = s.provider;\n      // 另存时若配置已就绪，会把配置一起存进状态，重开文件可以自愈\n      if (!cfg && s.cfg && s.cfg.providers) { cfg = s.cfg; logLine('从另存文件里恢复报价配置', 'ok'); }\n    } catch (e) { /* 坏掉的快照就按原数据来 */ }\n  }\n\n  function writeState() {\n    var el = document.getElementById('__state__');\n    if (!el) {\n      el = document.createElement('script');\n      el.type = 'application/json';\n      el.id = '__state__';\n      document.body.appendChild(el);\n    }\n    el.textContent = JSON.stringify({ picks: picks, provider: provider, cfg: cfg, weight: weight });\n  }\n\n  /* ---------- 等待配置的视图 ---------- */\n  function logDom(l) {\n    var d = document.createElement('div');\n    if (l.cls) d.className = l.cls;\n    d.innerHTML = '<span class=\"t\">+' + l.t.toFixed(2) + 's</span>' + escLog(l.text);\n    return d;\n  }\n\n  function renderWaiting(subtitle) {\n    appEl.innerHTML = '<div class=\"loading\">'\n      + '<div class=\"lt\"><span class=\"spin\"></span>正在准备报价数据…</div>'\n      + '<div class=\"ls\">' + (subtitle || '货件数据已经在这一页里了，现在只差本地桥的报价配置，通常 1 秒内到位。'\n          + '如果超过 10 秒，多半是本地桥没开（node bridge-cli.cjs health 看一眼）。') + '</div>'\n      + '<div class=\"plog\" id=\"plog\"></div></div>';\n    var box = document.getElementById('plog');\n    if (box) logLines.forEach(function (l) { box.appendChild(logDom(l)); });\n  }\n\n  function renderFatal(message) {\n    logLine('失败：' + message, 'bad');\n    appEl.innerHTML = '<div class=\"err\"><b>报价配置没拿到，这页算不了</b><br>'\n      + escLog(message)\n      + '<br><br><span style=\"font-size:12px;color:#b91c1c\">回到领星页面重新点一次「分析物流方案」即可；'\n      + '下面的日志显示了每一步的耗时，能看出卡在哪。</span></div>';\n    var wrap = document.createElement('div');\n    wrap.innerHTML = '<div class=\"plog\" id=\"plog\"></div>';\n    appEl.appendChild(wrap.firstChild);\n    var box = document.getElementById('plog');\n    if (box) logLines.forEach(function (l) { box.appendChild(logDom(l)); });\n  }\n\n  /* 成功后把加载耗时日志保留成页面底部的一个可折叠块 */\n  function appendLogDetails() {\n    if (!logLines.length) return;\n    var det = document.createElement('details');\n    det.className = 'plan';\n    det.style.marginTop = '18px';\n    det.innerHTML = '<summary>加载耗时（排查用）</summary>'\n      + '<div class=\"inner\"><div class=\"plog\" id=\"plog\"></div></div>';\n    appEl.appendChild(det);\n    var box = det.querySelector('.plog');\n    logLines.forEach(function (l) { box.appendChild(logDom(l)); });\n    logAttached = true;\n  }\n\n  /* ---------- 来源页把配置送进来 ---------- */\n  function onMessage(e) {\n    // 可信来源：opener（油猴 window.open）或父页面（iframe 联调/嵌用）\n    if (window.opener || window.parent !== window) {\n      if (e.source !== window.opener && e.source !== window.parent) return;\n    }\n    var d = e.data;\n    if (!d || typeof d !== 'object') return;\n    if (d.type === 'FREIGHT_LOG') { logLine(d.text, d.cls); return; }\n    if (d.type === 'FREIGHT_ERR') {\n      window.removeEventListener('message', onMessage);\n      renderFatal(d.message || '来源页报错，没有给原因');\n      (d.steps || []).forEach(function (s) { logLine(s); });\n      return;\n    }\n    if (d.type === 'FREIGHT_CFG' && d.cfg && d.cfg.providers) {\n      window.removeEventListener('message', onMessage);\n      cfg = d.cfg;\n      if (d.provider && cfg.providers[d.provider]) provider = d.provider;\n      if (d.input) input = d.input;\n      (d.steps || []).forEach(function (s) { logLine(s); });\n      logLine('报价配置到手（' + Math.round(JSON.stringify(cfg).length / 1024) + ' KB），开始计算', 'ok');\n      var tCalc = now();\n      render();\n      buildProviderSelect();\n      logLine('计算 + 渲染完成，用时 ' + (now() - tCalc).toFixed(2) + 's', 'ok');\n      appendLogDetails();\n      document.title = document.title.replace('（等待报价）', '');\n    }\n  }\n\n  /* ---------- 数据 ---------- */\n  function shipmentsWithPicks() {\n    return (input.split.shipments || []).map(function (s, i) {\n      var o = {};\n      for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) o[k] = s[k];\n      o.pickChannel = picks[i] || '';\n      return o;\n    });\n  }\n\n  function buildInput() {\n    return {\n      provider: provider,\n      split: { shipments: shipmentsWithPicks() },\n      merges: input.merges || [],\n      weight: weight\n    };\n  }\n\n  /* ---------- 渲染 ----------\n   * 每次渲染算两遍：\n   *   基线（不带手动选择的渠道）→ 只用来定方案顺序，切渠道不影响它，排序就不跳；\n   *   当前（带上手动选择）      → 出真实的金额和明细。\n   * 重渲染前记住：哪些方案折叠块是展开的、渠道面板开在哪个格子上，渲染后原样恢复。\n   */\n  var logAttached = false;\n\n  function render() {\n    if (!cfg || !input) return;\n    var res, order;\n    /* 记住展开状态 */\n    var openDetails = {};\n    Array.prototype.forEach.call(appEl.querySelectorAll('details.plan[open] > summary[data-pk]'), function (s) {\n      openDetails[s.getAttribute('data-pk')] = true;\n    });\n    try {\n      var baseline = FreightPricing.analyze(cfg, {\n        provider: provider,\n        split: { shipments: input.split.shipments || [] },\n        merges: input.merges || [],\n        weight: weight\n      });\n      order = baseline.plans.slice()\n        .sort(function (a, b) { return FreightPricing.planScore(a, weight) - FreightPricing.planScore(b, weight); })\n        .map(function (p) { return p.key; });\n      res = FreightPricing.analyze(cfg, buildInput());\n    } catch (e) {\n      appEl.innerHTML = '<div class=\"err\"><b>算不出来</b><br>' + FreightRender.esc(e.message) + '</div>';\n      return;\n    }\n    appEl.innerHTML = FreightRender.resultHtml(res, {\n      interactive: true,\n      mode: (input.meta && input.meta.mode) || '',\n      editable: function (p) { return p.key === 'split'; },\n      weight: weight,\n      order: order,\n      openPanel: openPanel\n    });\n    /* 恢复展开状态 */\n    Array.prototype.forEach.call(appEl.querySelectorAll('details.plan > summary[data-pk]'), function (s) {\n      if (openDetails[s.getAttribute('data-pk')]) s.parentElement.open = true;\n    });\n    bind();\n    if (logAttached) appendLogDetails();\n    renderHead(res);\n  }\n\n  function bind() {\n    /* 渠道单元格按钮：展开 / 收起候选面板 */\n    Array.prototype.forEach.call(appEl.querySelectorAll('button.chbtn'), function (btn) {\n      btn.onclick = function () {\n        var key = btn.getAttribute('data-key') || '';\n        openPanel = (openPanel === key) ? null : key;\n        render();\n      };\n    });\n    /* 面板里的候选：点选即换，面板保持展开方便连续比较 */\n    Array.prototype.forEach.call(appEl.querySelectorAll('button.chopt'), function (opt) {\n      opt.onclick = function () {\n        var key = opt.getAttribute('data-key') || '';\n        var ch = opt.getAttribute('data-ch') || '';\n        var idx = key.split('|')[1];\n        if (idx === undefined) return;\n        if (ch) picks[idx] = ch; else delete picks[idx];\n        render();\n      };\n    });\n  }\n\n  function renderHead(res) {\n    var pv = cfg.providers[provider] || {};\n    headEl.innerHTML = ''\n      + '<span class=\"tag\">报价 <b>' + FreightRender.esc(pv.quote_date || '') + '</b></span>'\n      + '<span class=\"tag\">计费重 <b>' + res.totals.bill + '</b> KG</span>'\n      + '<span class=\"tag\">' + res.totals.boxes + ' 箱 · ' + res.totals.cbm + ' M³</span>'\n      + (input.meta && input.meta.note\n          ? '<span class=\"tag note\">' + FreightRender.esc(input.meta.note) + '</span>' : '');\n  }\n\n  /* ---------- 顶部：时效权重滑条（学习自老版分仓分析器的「时间价值系数」）---------- */\n  function bindWeight() {\n    var range = document.getElementById('wrange');\n    var val = document.getElementById('wval');\n    var hint = document.getElementById('whint');\n    if (!range) return;\n    function hintOf(w) {\n      if (w <= 0.001) return '只看价格：完全按总运费排';\n      if (w <= 0.3) return '推荐平衡：每快 1 天，每公斤愿意多付 ' + w.toFixed(2) + ' 元';\n      if (w <= 0.6) return '急货偏快：每快 1 天，每公斤愿意多付 ' + w.toFixed(2) + ' 元';\n      return '不计成本要快：每快 1 天，每公斤愿意多付 ' + w.toFixed(2) + ' 元';\n    }\n    range.value = String(weight);\n    val.textContent = weight.toFixed(2);\n    hint.textContent = hintOf(weight);\n    range.oninput = function (e) {\n      weight = parseFloat(e.target.value) || 0;\n      val.textContent = weight.toFixed(2);\n      hint.textContent = hintOf(weight);\n      render();          // 权重变了 → 基线顺序重排（这是预期），手动选择的渠道保留\n      writeState();\n    };\n  }\n\n  /* ---------- 顶部：货代切换 ---------- */\n  function buildProviderSelect() {\n    var sel = document.getElementById('prov');\n    var names = Object.keys(cfg.providers);\n    sel.innerHTML = names.map(function (n) {\n      return '<option value=\"' + FreightRender.esc(n) + '\"'\n        + (n === provider ? ' selected' : '') + '>' + FreightRender.esc(n) + '</option>';\n    }).join('');\n    sel.onchange = function (e) {\n      provider = e.target.value;\n      picks = {};        // 渠道是按货代定的，换家就重来\n      openPanel = null;\n      render();\n    };\n  }\n\n  /* ---------- 另存为 HTML ---------- */\n  function saveHtml() {\n    writeState();\n    var html = '<!doctype html>\\n' + document.documentElement.outerHTML;\n    var blob = new Blob([html], { type: 'text/html;charset=utf-8' });\n    var d = new Date();\n    var stamp = d.getFullYear()\n      + String(d.getMonth() + 1).padStart(2, '0')\n      + String(d.getDate()).padStart(2, '0');\n    var whs = (input.split.shipments || []).map(function (s) { return s.warehouseCode; }).join('-');\n    var a = document.createElement('a');\n    a.href = URL.createObjectURL(blob);\n    a.download = '分仓方案_' + stamp + '_' + whs + '.html';\n    document.body.appendChild(a);\n    a.click();\n    setTimeout(function () {\n      URL.revokeObjectURL(a.href);\n      a.remove();\n    }, 2000);\n  }\n\n  /* ---------- 启动 ---------- */\n  function boot() {\n    readState();\n    var baseTitle = (input && input.meta && input.meta.title) || '分仓方案对比';\n    document.title = baseTitle;\n    var h1 = document.getElementById('h1');\n    if (h1) h1.textContent = baseTitle;\n    var sub = document.getElementById('hsub');\n    if (sub) sub.textContent = (input && input.meta && input.meta.subtitle) || '';\n    document.getElementById('save').onclick = saveHtml;\n    bindWeight();\n\n    if (cfg && cfg.providers && input) {\n      buildProviderSelect();\n      render();\n      appendLogDetails();\n      return;\n    }\n\n    // 配置还没到：先摆出等待视图，听来源页的消息\n    document.title = baseTitle + '（等待报价）';\n    renderWaiting();\n    window.addEventListener('message', onMessage);\n    // 有 opener（油猴 window.open）或处在我iframe里（联调/嵌用）时，消息都可能送进来；\n    // 只有真正孤立打开（既无 opener 也不是 iframe）才判定\"永远等不到\"\n    var hasSource = !!window.opener || window.parent !== window;\n    if (!hasSource) {\n      setTimeout(function () {\n        if (cfg) return;\n        renderFatal('这一页既没有来源页（opener）也不是 iframe，配置送不进来。'\n          + '多半是另存时配置还没加载完，回领星页面重新生成一份即可。');\n      }, 300);\n    }\n  }\n\n  if (document.readyState === 'loading') {\n    document.addEventListener('DOMContentLoaded', boot);\n  } else {\n    boot();\n  }\n})();\n</script>\n</body>\n</html>\n";
    function safeJson(v) {
        return JSON.stringify(v).replace(/<\//g, '<\\/');
    }
    function build(cfg, input) {
        return TPL
            .replace('@' + '@CFG' + '@' + '@', function () { return safeJson(cfg); })
            .replace('@' + '@INPUT' + '@' + '@', function () { return safeJson(input); });
    }
    return { build: build };
});

    const CSS = `
    .bar { position: fixed; right: 26px; bottom: 108px; display: flex; gap: 8px; align-items: center;
           padding: 8px 10px; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
           box-shadow: 0 6px 24px rgba(15,23,42,.14); z-index: 2147483000;
           font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; }
    .bar .st { font-size: 12px; color: #6b7280; font-variant-numeric: tabular-nums;
               max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .root { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
            color: #111827; font-size: 13px; line-height: 1.55; }
    .btn { border: none; cursor: pointer; border-radius: 7px; font-size: 13px; font-weight: 600;
           padding: 8px 14px; white-space: nowrap; transition: background .15s, opacity .15s; }
    .btn.main { background: #4f46e5; color: #fff; }
    .btn.main:hover { background: #4338ca; }
    .btn.ghost { background: #f3f4f6; color: #374151; font-weight: 500; }
    .btn.ghost:hover { background: #e5e7eb; }
    .btn.mini { padding: 5px 10px; font-size: 12px; }
    .btn:disabled { opacity: .55; cursor: not-allowed; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #d1d5db; flex: none; }
    .dot.on { background: #10b981; box-shadow: 0 0 0 3px rgba(16,185,129,.16); }
    .dot.off { background: #ef4444; box-shadow: 0 0 0 3px rgba(239,68,68,.14); }

    .toast { position: fixed; left: 50%; bottom: 40px; transform: translateX(-50%);
             background: #111827; color: #fff; padding: 9px 16px; border-radius: 9px; font-size: 13px;
             z-index: 2147483002; opacity: 0; transition: opacity .2s; pointer-events: none; }
    .toast.show { opacity: .95; }

    .mask { position: fixed; inset: 0; background: rgba(15,23,42,.32); display: none;
            align-items: center; justify-content: center; z-index: 2147483001; }
    .mask.open { display: flex; }
    .modal { width: min(560px, 92vw); max-height: 86vh; overflow: auto; background: #fff;
             border-radius: 14px; padding: 20px 22px; box-shadow: 0 18px 50px rgba(15,23,42,.25); }
    .modal h3 { margin: 0 0 4px; font-size: 15px; }
    .modal p { margin: 8px 0; font-size: 12.5px; color: #4b5563; }
    .modal code { display: block; background: #111827; color: #e5e7eb; padding: 8px 11px; border-radius: 7px;
                  font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11.5px;
                  word-break: break-all; margin: 6px 0; }
    .modal input { width: 100%; margin-top: 10px; padding: 9px 11px; border: 1px solid #d1d5db;
                   border-radius: 8px; font-size: 13px; font-family: inherit; }
    .modal .row { margin-top: 12px; display: flex; gap: 8px; align-items: center; }
    .pstate { margin-top: 10px; font-size: 12.5px; min-height: 18px; line-height: 1.5;
              white-space: pre-wrap; word-break: break-all; }
    .pstate.run { color: #4b5563; }
    .pstate.ok  { color: #047857; font-weight: 600; }
    .pstate.bad { color: #b91c1c; font-weight: 600; }
    .pdiag { margin-top: 10px; padding: 9px 11px; background: #f9fafb; border: 1px dashed #d1d5db;
             border-radius: 8px; font-family: ui-monospace, Menlo, Consolas, monospace;
             font-size: 11.5px; color: #374151; white-space: pre-wrap; word-break: break-all;
             line-height: 1.6; }
    `;

    /* ============================================================
     * 取数（沿用已跑过 20+ 批的 v1 逻辑）
     * ============================================================ */
    function getVueCtx() {
        const wrapper = PAGE.querySelector('.sta-delivery-service-wrapper');
        return (wrapper && wrapper.__vue__) ? wrapper.__vue__ : null;
    }

    function getOptions(vueCtx) {
        const detail = vueCtx.placementOptionDetail;
        let options = Array.isArray(vueCtx.placementOptionList)
            ? vueCtx.placementOptionList.slice() : [];
        options = options.map(o => {
            const needFill = detail && o.placementOptionId === detail.placementOptionId
                && (!o.shipmentInformationList || !o.shipmentInformationList.length
                    || !o.packingBoxInfoList || !o.packingBoxInfoList.length);
            return needFill ? Object.assign({}, o, {
                shipmentInformationList: detail.shipmentInformationList,
                packingBoxInfoList: detail.packingBoxInfoList
            }) : o;
        }).filter(o => o && Array.isArray(o.shipmentInformationList) && o.shipmentInformationList.length);
        if (!options.length && detail
            && Array.isArray(detail.shipmentInformationList) && detail.shipmentInformationList.length) {
            options = [detail];
        }
        return options;
    }

    function buildA(options) {
        return options.map(option => {
            const cfgFee = (option.fees || []).find(f => String(f.target).includes('入库配置费'));
            return {
                optionId: option.placementOptionId || '',
                shipmentCount: option.shipmentCount,
                planName: `${option.shipmentCount}个货件`,
                placementFee: cfgFee ? Number(cfgFee.amount) : (Number(option.feeCount) || 0),
                placementFeeCurrency: cfgFee ? cfgFee.code : 'USD',
                shipments: option.shipmentInformationList.map(s => {
                    const boxInfo = (option.packingBoxInfoList || []).find(b => b.shipmentId === s.shipmentId);
                    const boxCount = boxInfo
                        ? boxInfo.shipmentPackingList.reduce((n, p) => n + (Number(p.total) || 0), 0) : 0;
                    return {
                        region: s.postalCodeMark,
                        warehouseCode: s.wareHouseId,
                        shipmentId: s.shipmentId || '',
                        weight: Number(s.weightCount),
                        weightUnit: s.weightUnit,
                        volume: Number(s.volumeCount),
                        volumeUnit: s.lengthUnit,
                        boxCount
                    };
                })
            };
        });
    }

    /* ============================================================
     * 分仓快照：建仓后方案就固定了，完成态页面读不到候选数据，
     * 所以在创建页点过「计算」后自动把方案存下来，事后回退用。
     * 结构差异说明：创建页是多个候选（placementOptionList），
     * 建仓后是唯一固定的货件组合——回放时只取「当时选定的那个方案」，
     * 不去解析完成态页面的新结构。
     * ============================================================ */
    const SNAP_KEY = 'lx_freight_plans_snapshot';
    const SNAP_TTL = 24 * 3600 * 1000;   // 24 小时后当没有
    let lastSnapKey = '';

    function loadSnapshot() {
        const s = GM_getValue(SNAP_KEY, null);
        if (!s || !Array.isArray(s.plans) || !s.plans.length) return null;
        if (Date.now() - s.at > SNAP_TTL) return null;
        return s;
    }

    /* 每 800ms 轮询里调：分仓数据出现/变化时自动存一份（用户不点按钮也存） */
    function maybeSnapshot() {
        const vueCtx = getVueCtx();
        if (!vueCtx) return;
        const options = vueCtx.placementOptionList;
        if (!Array.isArray(options) || !options.length) return;
        const detail = vueCtx.placementOptionDetail;
        // 变化指纹：各候选的 id/货件数/箱组数 + 当前选定项，变了才重新构建和写盘
        const key = options.map(o => (o && o.placementOptionId) + ':'
            + ((o && o.shipmentInformationList) || []).length + ':'
            + ((o && o.packingBoxInfoList) || []).length).join('|')
            + '#' + (detail && detail.placementOptionId);
        if (key === lastSnapKey) return;
        const plans = buildA(getOptions(vueCtx));
        if (!plans.length) return;
        lastSnapKey = key;
        try {
            GM_setValue(SNAP_KEY, {
                at: Date.now(),
                picked: detail ? detail.placementOptionId : null,
                plans: plans
            });
        } catch (e) { /* 快照写失败不致命，顶多回退不了 */ }
    }

    /* 从快照里挑「创建时选定的方案」；选定项丢了就退回分仓数最多的分仓方案 */
    function pickSnapPlan(snap) {
        const plans = snap.plans || [];
        if (snap.picked) {
            const hit = plans.find(p => p.optionId === snap.picked);
            if (hit) return hit;
        }
        return plans.find(p => p.shipmentCount > 1) || plans[0];
    }

    function snapshotTime(ts) {
        const d = new Date(ts);
        const p = n => String(n).padStart(2, '0');
        return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    /* ============================================================
     * 本地桥（只做一件事：取报价配置）
     * ============================================================ */
    function gmGet(url, headers, timeout) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET', url, headers: headers || {}, timeout: timeout || 15000,
                onload: resolve,
                onerror: () => reject(new Error('连不上本地桥（127.0.0.1:32145）')),
                ontimeout: () => reject(new Error('本地桥响应超时'))
            });
        });
    }

    function gmPost(url, body) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST', url,
                headers: { 'Content-Type': 'application/json; charset=UTF-8' },
                data: JSON.stringify(body), timeout: 15000,
                onload: resolve,
                onerror: () => reject(new Error('连不上本地桥')),
                ontimeout: () => reject(new Error('本地桥响应超时'))
            });
        });
    }

    function authHeaders() {
        const token = GM_getValue(TOKEN_KEY, '');
        const h = { Accept: 'application/json', 'X-Local-Bridge-Client': CLIENT_ID };
        if (token) h.Authorization = 'Bearer ' + token;
        return h;
    }

    function parseHeaderBlock(raw, name) {
        if (!raw) return null;
        const m = raw.match(new RegExp('^' + name + ':\\s*(.+)$', 'im'));
        return m ? m[1].trim() : null;
    }

    const BridgeError = { needPair: false, message: '' };

    async function fetchConfig(force) {
        BridgeError.needPair = false;
        BridgeError.message = '';
        const cache = GM_getValue(CFG_CACHE, null);
        const headers = authHeaders();
        if (cache && cache.etag && !force) headers['If-None-Match'] = cache.etag;
        const r = await gmGet(`${BRIDGE}/v2/configs/${CFG_ID}`, headers, 20000);
        if (r.status === 304 && cache) {
            return { cfg: JSON.parse(cache.cfg), etag: cache.etag, at: cache.at, notModified: true };
        }
        if (r.status === 401 || r.status === 403) {
            BridgeError.needPair = true;
            let msg = '本地桥未授权';
            try { msg = JSON.parse(r.responseText).error.message || msg; } catch (e) { }
            BridgeError.message = msg;
            throw new Error(msg);
        }
        if (r.status !== 200) {
            let msg = `配置读取失败 HTTP ${r.status}`;
            try {
                const j = JSON.parse(r.responseText);
                if (j.error) msg = j.error.code === 'CONFIG_NOT_PUBLISHED'
                    ? '报价配置还没发布到桥（跑一次 export_plugin_config.py --publish）'
                    : (j.error.message || msg);
            } catch (e) { }
            throw new Error(msg);
        }
        const body = JSON.parse(r.responseText);
        const doc = body.config;
        if (!doc || !doc.data) throw new Error('配置结构不对，缺 data');
        const cfg = Object.assign({}, doc.data, {
            publication_id: doc.publication_id,
            revision: doc.revision,
            effective_at: doc.effective_at,
            expires_at: doc.expires_at
        });
        if (!cfg.providers) throw new Error('配置里没有 providers');
        const etag = parseHeaderBlock(r.responseHeaders, 'etag') || null;
        try {
            GM_setValue(CFG_CACHE, { etag, at: Date.now(), cfg: JSON.stringify(cfg) });
        } catch (e) {
            console.warn('[物流比价] 配置缓存写入失败，下次会重新拉取', e);
        }
        return { cfg, etag, at: Date.now(), notModified: false };
    }

    async function doPair(code) {
        let r;
        try {
            r = await gmPost(`${BRIDGE}/v2/pair`, { client_id: CLIENT_ID, pairing_code: code });
        } catch (e) {
            throw new Error('请求没发到桥：' + e.message
                + '。检查：① 桥是否在跑（node bridge-cli.cjs health）'
                + '；② 油猴脚本是否允许访问 127.0.0.1');
        }
        if (r.status !== 200) {
            let ec = '', em = '';
            try {
                const j = JSON.parse(r.responseText);
                ec = (j.error && j.error.code) || '';
                em = (j.error && j.error.message) || '';
            } catch (e) { em = String(r.responseText || '').slice(0, 120); }
            throw new Error('配对失败 HTTP ' + r.status
                + (ec ? ' [' + ec + ']' : '')
                + (em ? '：' + em : '')
                + ((r.status === 401 || r.status === 403)
                    ? '。配对码只能用一次、10 分钟内有效，请重新生成一个。'
                    : ''));
        }
        let j;
        try { j = JSON.parse(r.responseText); } catch (e) {
            throw new Error('配对返回不是 JSON：' + String(r.responseText || '').slice(0, 120));
        }
        if (!j.token) throw new Error('配对成功但响应里没有 token');
        GM_setValue(TOKEN_KEY, j.token);
        BridgeError.needPair = false;
        BridgeError.message = '';
        return j;
    }

    /* ============================================================
     * UI 骨架
     * ============================================================ */
    const host = document.createElement('div');
    host.className = 'root';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${CSS}</style>
    <div class="bar" style="display:none">
      <span class="dot" id="dot"></span>
      <button class="btn main" id="go">⚡ 分析物流方案</button>
      <button class="btn ghost mini" id="save">存 HTML</button>
      <button class="btn ghost mini" id="copy">JSON</button>
      <span class="st" id="st"></span>
    </div>
    <div class="mask" id="mask">
      <div class="modal" id="pairview">
        <h3>首次使用需要配对一次</h3>
        <p>在命令行执行下面这行，拿到一次性配对码：</p>
        <code>node bridge-cli.cjs client pair-code userscript.lingxing.automation.v2</code>
        <p>把配对码粘到下面（10 分钟内有效、只能用一次），之后就不用再弄了。</p>
        <input id="pcode" placeholder="粘贴配对码（32 位）" autocomplete="off" spellcheck="false" />
        <div class="row">
          <button class="btn main" id="pgo">完成配对</button>
          <button class="btn ghost mini" id="pdiag">自检</button>
          <button class="btn ghost mini" id="pclose" style="margin-left:auto">关闭</button>
        </div>
        <div id="pstate" class="pstate"></div>
        <div id="pdiagout" class="pdiag" style="display:none"></div>
      </div>
    </div>
    <div class="toast" id="toast"></div>`;
    document.documentElement.appendChild(host);

    const $ = id => shadow.getElementById(id);
    const barEl = shadow.querySelector('.bar');

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g,
            c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    let toastTimer = null;
    function toast(text) {
        const t = $('toast');
        t.textContent = text;
        t.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
    }

    /* ============================================================
     * 状态
     * ============================================================ */
    let cfg = null;
    let cfgAt = 0;
    let lastPlans = null;
    let lastInput = null;       // 最近一次分析的输入（存 HTML 直接复用）
    let provider = GM_getValue(PROVIDER_KEY, '') || '';

    async function ensureConfig(force) {
        const r = await fetchConfig(force);
        cfg = r.cfg;
        cfgAt = r.at;
        if (!provider || !cfg.providers[provider]) provider = cfg.default_provider;
        return r;
    }

    /* ============================================================
     * 生成分析页
     * ============================================================ */
    function stamp() {
        const d = new Date();
        const p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    function buildInput(plans) {
        const split = plans.find(p => p.shipmentCount > 1) || plans[0];
        const merges = plans.filter(p => p !== split);
        const whs = (split.shipments || []).map(s => s.warehouseCode).join(' / ');
        return {
            provider: provider || cfg.default_provider,
            split: { shipments: split.shipments || [] },
            merges: merges,
            meta: {
                title: '分仓物流方案 · ' + stamp(),
                subtitle: split.shipments.length + ' 票分仓（' + whs + '） vs '
                    + merges.length + ' 个合并候选 · 来源：领星创建货件页',
                note: ''
            }
        };
    }

    /* 建仓后固定方案的输入：只有选定的一组货件，没有合并候选可比 */
    function buildSnapshotInput(plan, snap) {
        const shs = plan.shipments || [];
        const whs = shs.map(s => s.warehouseCode).join(' / ');
        return {
            provider: provider || cfg.default_provider,
            split: { shipments: shs },
            merges: [],
            meta: {
                title: '已建仓货件 · 渠道分配',
                subtitle: shs.length + ' 票（' + whs + '）· 建仓时选定的分仓方案 · 快照 ' + snapshotTime(snap.at),
                mode: 'shipment',
                note: '建仓后方案已固定，货件号以领星货件列表为准；若在建新货请先点「计算」刷新快照'
            }
        };
    }

    function pageHtml(input) {
        return FreightPage.build(cfg, input);
    }

    function downloadHtml(html, plans) {
        const split = plans.find(p => p.shipmentCount > 1) || plans[0];
        const d = new Date();
        const p = n => String(n).padStart(2, '0');
        const name = '分仓方案_' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate())
            + '_' + (split.shipments || []).map(s => s.warehouseCode).join('-') + '.html';
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    }

    function openTab(html) {
        const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
        const W = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;
        let w = null;
        try { w = W.open(url, '_blank'); } catch (e) { w = null; }
        if (!w) {
            toast('新标签页被拦了，允许本站弹窗后重试，或点「存 HTML」');
            return null;
        }
        // blob 页的脚本若被站点 CSP 拦掉，标题不会变，给出兜底提示
        setTimeout(() => {
            try {
                if (w.document && w.document.title === '分仓方案对比') {
                    toast('新页面脚本似乎被拦了（空白或没数据），点「存 HTML」另存后双击打开');
                }
            } catch (e) { /* 跨域就不管，正常不会 */ }
        }, 1200);
        return w;
    }

    /* 把消息送进分析页（配置 / 进度 / 错误都走这一条通道） */
    function postToPage(w, msg) {
        try { if (w) w.postMessage(msg, '*'); } catch (e) { /* 页面被关了就算了 */ }
    }

    /* ---------- 底栏状态：让"正在干嘛、多久了"始终可见 ---------- */
    let stTimer = null;
    function status(text) {
        if (stTimer) { clearInterval(stTimer); stTimer = null; }
        $('st').textContent = text || '';
    }
    function statusBusy(base) {
        const t0 = performance.now();
        if (stTimer) clearInterval(stTimer);
        const tick = () => { $('st').textContent = base + ' ' + ((performance.now() - t0) / 1000).toFixed(1) + 's'; };
        tick();
        stTimer = setInterval(tick, 100);
        return t0;
    }

    /* ============================================================
     * 配对弹层
     * ============================================================ */
    function pstate(kind, text) {
        const el = $('pstate');
        el.className = 'pstate ' + kind;
        el.textContent = text;
    }

    function openPairing() {
        $('pairview').style.display = 'block';
        $('mask').classList.add('open');
        setTimeout(() => { const i = $('pcode'); if (i) i.focus(); }, 60);
    }

    function closeMask() { $('mask').classList.remove('open'); }

    $('mask').onclick = (e) => { if (e.target === $('mask')) closeMask(); };

    $('pclose').onclick = () => $('mask').classList.remove('open');

    async function submitPair() {
        const inputEl = $('pcode');
        const goBtn = $('pgo');
        const code = String(inputEl.value || '').replace(/[\s"'`]/g, '');
        if (!code) { pstate('bad', '配对码是空的'); return; }
        if (code.length !== 32) {
            pstate('bad', '配对码应为 32 位，现在 ' + code.length + ' 位。粘错了或者少复制了字符。');
            return;
        }
        goBtn.disabled = true;
        goBtn.textContent = '配对中…';
        pstate('run', '正在请求 127.0.0.1:32145/v2/pair …');
        try {
            await doPair(code);
            pstate('ok', '配对成功，正在打开分析页…');
            inputEl.value = '';
            $('mask').classList.remove('open');
            await run(lastPlans);
        } catch (e) {
            pstate('bad', String((e && e.message) || e));
            toast('配对失败，原因见弹层');
        } finally {
            goBtn.disabled = false;
            goBtn.textContent = '完成配对';
        }
    }
    $('pgo').onclick = submitPair;
    $('pcode').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); submitPair(); } };
    $('pcode').onpaste = () => setTimeout(() => {
        const n = String($('pcode').value || '').replace(/[\s"'`]/g, '').length;
        if (n === 32) pstate('run', '已粘贴 32 位配对码，点「完成配对」或按回车');
    }, 30);

    $('pdiag').onclick = async () => {
        const out = $('pdiagout');
        out.style.display = 'block';
        out.textContent = '检查中…';
        const lines = [];
        lines.push('脚本版本  v4.0');
        lines.push('client_id  ' + CLIENT_ID);
        lines.push('GM_xmlhttpRequest  ' + (typeof GM_xmlhttpRequest));
        lines.push('本地 token  ' + (GM_getValue(TOKEN_KEY, '') ? '已保存' : '无'));
        try {
            const r = await gmGet(BRIDGE + '/health', {}, 5000);
            lines.push('桥 /health  HTTP ' + r.status + '  '
                + String(r.responseText || '').replace(/\s+/g, ' ').slice(0, 90));
        } catch (e) {
            lines.push('桥 /health  失败：' + e.message);
        }
        try {
            const r2 = await gmGet(BRIDGE + '/v2/configs/' + CFG_ID, authHeaders(), 8000);
            lines.push('读报价配置  HTTP ' + r2.status);
        } catch (e) {
            lines.push('读报价配置  失败：' + e.message);
        }
        out.textContent = lines.join('\n');
    };

    /* ============================================================
     * 主流程
     * ============================================================ */
    /* 只在创建货件页（SendToAmazon，有分仓组件）显示 */
    function pageMode() {
        if (location.href.includes('SendToAmazon') && PAGE.querySelector('.sta-delivery-service-wrapper')) {
            return 'create';
        }
        return null;
    }

    async function run(plans) {
        const btn = $('go');
        btn.disabled = true;
        const t0 = performance.now();
        const steps = [];
        const mark = m => steps.push('+' + ((performance.now() - t0) / 1000).toFixed(2) + 's ' + m);
        let w = null;
        let snapshotMode = null;      // 非 null 时表示建仓后回放快照
        try {
            if (!plans) {
                maybeSnapshot();      // 数据刚出现、轮询还没跑到的场景先补一刀
                const tt = performance.now();
                const vueCtx = getVueCtx();
                const options = vueCtx ? getOptions(vueCtx) : [];
                if (options.length) {
                    plans = buildA(options);
                    mark('读页面分仓数据（' + plans.length + ' 个方案）用时 '
                        + ((performance.now() - tt) / 1000).toFixed(2) + 's');
                } else {
                    // 建仓完成后候选数据没了 → 回退到建仓页快照里选定的方案
                    const snap = loadSnapshot();
                    if (!snap) {
                        toast('页面还没有分仓数据，先点「计算」（或确认 24 小时内建过仓）');
                        return;
                    }
                    plans = [pickSnapPlan(snap)];
                    snapshotMode = snap;
                    mark('建仓后页面无候选数据，回用建仓页快照（' + snapshotTime(snap.at) + '）');
                }
            }
            lastPlans = plans;
            const input = snapshotMode
                ? buildSnapshotInput(plans[0], snapshotMode)
                : buildInput(plans);
            lastInput = input;
            GM_setValue(PROVIDER_KEY, provider);

            // 页面先开：货件数据是现成的，报价配置可以晚一点从本地桥送进来
            const haveCfg = !!cfg;
            mark(haveCfg ? '报价配置已在内存（页面加载时预热过）' : '报价配置还没取，页面先开、配置后送');
            w = openTab(pageHtml(input));
            mark('分析页已打开');
            status('分析页已打开');

            if (!haveCfg) {
                statusBusy('读取报价配置');
                postToPage(w, { type: 'FREIGHT_LOG', text: '从本地桥读取报价配置…' });
                try {
                    await ensureConfig(false);
                    mark('配置到手（' + Math.round(JSON.stringify(cfg).length / 1024) + ' KB）');
                } finally { status('分析页已打开'); }
            }
            postToPage(w, {
                type: 'FREIGHT_CFG', cfg: cfg, provider: provider,
                steps: steps, ms: ((performance.now() - t0) / 1000).toFixed(2)
            });
            $('dot').className = 'dot on';
        } catch (e) {
            mark('失败：' + e.message);
            postToPage(w, { type: 'FREIGHT_ERR', message: e.message, steps: steps });
            $('dot').className = 'dot off';
            if (BridgeError.needPair) { openPairing(); toast('本地桥未配对，先配对一次'); }
            else toast('分析失败：' + e.message);
        } finally {
            btn.disabled = false;
        }
    }

    $('go').onclick = () => run(null);

    // 直接存成本地 HTML（不依赖弹窗，也是长久保留最稳的方式）
    $('save').onclick = async () => {
        const btn = $('save');
        btn.disabled = true;
        try {
            let plans = lastPlans;
            let input = lastInput;
            if (!plans) {
                maybeSnapshot();
                const vueCtx = getVueCtx();
                const options = vueCtx ? getOptions(vueCtx) : [];
                if (options.length) {
                    plans = buildA(options);
                    input = buildInput(plans);
                } else {
                    // 建仓后：把快照方案存成固定渠道分配页
                    const snap = loadSnapshot();
                    if (!snap) { toast('无分仓数据'); return; }
                    plans = [pickSnapPlan(snap)];
                    input = buildSnapshotInput(plans[0], snap);
                }
                lastPlans = plans;
                lastInput = input;
            }
            if (!cfg) await ensureConfig(false);
            downloadHtml(pageHtml(input), plans);
            toast('已保存，双击该文件即可打开');
        } catch (e) {
            if (BridgeError.needPair) { openPairing(); toast('先配对一次'); }
            else toast('保存失败：' + e.message);
        } finally {
            btn.disabled = false;
        }
    };

    // 二级功能：复制分仓 JSON（排障用）
    $('copy').onclick = async () => {
        const vueCtx = getVueCtx();
        if (!vueCtx) { toast('未找到分仓组件'); return; }
        const options = getOptions(vueCtx);
        if (!options.length) { toast('无分仓数据'); return; }
        const A = buildA(options);
        try {
            await navigator.clipboard.writeText(JSON.stringify(A, null, 2));
            toast(`已复制 ${A.length} 个方案`);
        } catch (e) {
            console.log('分仓JSON A =', A);
            toast('复制失败，看控制台');
        }
    };

    /* ============================================================
     * 显示条件 + 预热
     * ============================================================ */
    setInterval(() => {
        const on = !!pageMode();
        barEl.style.display = on ? 'block' : 'none';
        if (on) maybeSnapshot();      // 分仓数据一出现就自动快照，不依赖点按钮
    }, 800);

    let warmed = false;
    async function warm() {
        if (warmed || !pageMode()) return;
        warmed = true;
        try {
            await ensureConfig(false);
            $('dot').className = 'dot on';
        } catch (e) {
            $('dot').className = 'dot off';
        }
    }
    warm();
    setInterval(() => { if (!warmed) warm(); }, 1500);
})();
