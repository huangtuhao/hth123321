// ==UserScript==
// @name         领星ERP-分仓JSON一键复制
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  领星创建货件页：一键分析物流方案（本地比价引擎实时算，页面内出推荐/五档对照/逐仓渠道时效）；保留原「复制分仓JSON」。
// @author       You
// @match        *://erp.lingxing.com/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      127.0.0.1
// @connect      localhost
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ================= 配置 =================
    const BASE = 'http://127.0.0.1:32146';   // 本地比价服务（serve.py）

    // ================= 样式（Shadow DOM 内，避免与领星 CSS 打架）=================
    const CSS = `
    * { box-sizing: border-box; }
    .root { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
            color: #111827; font-size: 13px; line-height: 1.55; }
    .bar { position: fixed; right: 26px; bottom: 108px; display: flex; gap: 8px; align-items: center;
           padding: 8px 10px; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
           box-shadow: 0 6px 24px rgba(15,23,42,.14); z-index: 2147483000; }
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

    .drawer { position: fixed; top: 0; right: 0; width: min(860px, 96vw); height: 100vh;
              background: #fff; box-shadow: -12px 0 40px rgba(15,23,42,.16);
              display: none; flex-direction: column; z-index: 2147483001; }
    .drawer.open { display: flex; }
    .head { display: flex; align-items: center; gap: 10px; padding: 14px 18px;
            border-bottom: 1px solid #eef0f3; }
    .head h3 { margin: 0; font-size: 15px; font-weight: 700; letter-spacing: .2px; }
    .head .sp { flex: 1; }
    .close { border: none; background: #f3f4f6; width: 28px; height: 28px; border-radius: 7px;
             cursor: pointer; font-size: 16px; line-height: 1; color: #6b7280; }
    .close:hover { background: #e5e7eb; }

    .metabar { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 18px; background: #fafbfc;
               border-bottom: 1px solid #eef0f3; align-items: center; }
    .tag { background: #fff; border: 1px solid #e5e7eb; border-radius: 999px; padding: 3px 9px;
           font-size: 11.5px; color: #374151; }
    .tag b { color: #111827; font-variant-numeric: tabular-nums; }
    .tag.warn { background: #fffbeb; border-color: #fde68a; color: #92400e; }
    .tag.ok { background: #ecfdf5; border-color: #a7f3d0; color: #065f46; }
    .sel { margin-left: auto; font-size: 12px; padding: 4px 8px; border: 1px solid #d1d5db;
           border-radius: 7px; background: #fff; color: #374151; }

    .body { flex: 1; overflow: auto; padding: 16px 18px 28px; }
    .empty { padding: 40px 10px; text-align: center; color: #6b7280; font-size: 13px; }
    .spin { width: 18px; height: 18px; border: 2px solid #e5e7eb; border-top-color: #4f46e5;
            border-radius: 50%; animation: sp .7s linear infinite; display: inline-block;
            vertical-align: -3px; margin-right: 8px; }
    @keyframes sp { to { transform: rotate(360deg); } }

    .rec { border: 1px solid #d1fae5; background: linear-gradient(180deg,#f0fdf4,#fff);
           border-radius: 12px; padding: 14px 16px; margin-bottom: 14px; }
    .rec .lab { font-size: 11.5px; color: #047857; font-weight: 700; letter-spacing: .4px; }
    .rec .top { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-top: 4px; }
    .rec .name { font-size: 16px; font-weight: 700; }
    .rec .money { font-size: 24px; font-weight: 800; color: #047857; font-variant-numeric: tabular-nums; }
    .rec .sub { color: #4b5563; font-size: 12.5px; }
    .rec .flag { margin-top: 10px; padding: 8px 10px; border-radius: 8px; font-size: 12.5px; }
    .rec .flag.warn { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; }
    .rec .flag.error { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; }
    .rec .measured { margin-top: 8px; font-size: 12px; color: #6b7280; }

    .sec { margin: 18px 0 8px; font-size: 12px; font-weight: 700; color: #6b7280; letter-spacing: .5px;
           text-transform: uppercase; }
    .tblwrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
    table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    th { text-align: left; font-weight: 600; color: #6b7280; background: #f9fafb; padding: 7px 8px;
         border-bottom: 1px solid #e5e7eb; white-space: nowrap; font-size: 11.5px; }
    td { padding: 8px; border-bottom: 1px solid #f1f3f5; vertical-align: middle; }
    tr.best td { background: #f0fdf4; }
    tr.cheap td { background: #f5f3ff; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .pill { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 11px; }
    .pill.kp { background: #eff6ff; color: #1d4ed8; }
    .pill.ep { background: #fff7ed; color: #c2410c; }
    .pill.na { background: #f3f4f6; color: #6b7280; }
    .pill.best { background: #10b981; color: #fff; font-weight: 700; }

    details.plan { border: 1px solid #eef0f3; border-radius: 10px; margin-bottom: 8px; overflow: hidden; }
    details.plan > summary { cursor: pointer; padding: 9px 12px; font-size: 12.5px; font-weight: 600;
                             background: #fcfcfd; list-style: none; display: flex; gap: 10px; align-items: center; }
    details.plan > summary::-webkit-details-marker { display: none; }
    details.plan > summary:hover { background: #f7f8fa; }
    details.plan[open] > summary { border-bottom: 1px solid #eef0f3; }
    .inner { padding: 4px 8px 10px; }

    ul.adv { margin: 6px 0 0; padding-left: 18px; }
    ul.adv li { margin: 4px 0; font-size: 12.5px; color: #374151; }
    .kv { display: flex; gap: 8px; margin: 6px 0; font-size: 12.5px; }
    .kv .k { color: #6b7280; flex: none; width: 74px; }

    .foot { border-top: 1px solid #eef0f3; padding: 10px 18px; display: flex; gap: 8px;
            align-items: center; background: #fff; }
    .foot .btn { flex: none; }
    .foot .note { font-size: 11.5px; color: #9ca3af; flex: 1; min-width: 0;
                  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .err { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; border-radius: 10px;
           padding: 12px 14px; font-size: 12.5px; }
    .err code { background: #fff; border: 1px solid #fecaca; padding: 1px 5px; border-radius: 4px; }
    .link { color: #4f46e5; cursor: pointer; text-decoration: underline; font-weight: 600; }
    `;

    // ================= 取数（沿用 v1，已被历批验证）=================
    // ⚠️ 带 @grant 的脚本可能跑在沙箱里，此时 `document` 拿不到页面的 Vue 实例属性
    //    （隔离世界只共享 DOM 结构，不共享挂在 DOM 上的 JS 属性）。
    //    unsafeWindow.document 才是页面世界的 document，__vue__ 在这里读得到。
    const PAGE = (typeof unsafeWindow !== 'undefined' && unsafeWindow.document)
        ? unsafeWindow.document : document;

    function getVueCtx() {
        const wrapper = PAGE.querySelector('.sta-delivery-service-wrapper');
        return (wrapper && wrapper.__vue__) ? wrapper.__vue__ : null;
    }

    function getOptions(vueCtx) {
        const detail = vueCtx.placementOptionDetail;
        let options = Array.isArray(vueCtx.placementOptionList)
            ? vueCtx.placementOptionList.slice()
            : [];

        options = options.map(o => {
            const needFill = detail && o.placementOptionId === detail.placementOptionId
                && (!o.shipmentInformationList || !o.shipmentInformationList.length
                    || !o.packingBoxInfoList || !o.packingBoxInfoList.length);
            return needFill ? Object.assign({}, o, {
                shipmentInformationList: detail.shipmentInformationList,
                packingBoxInfoList: detail.packingBoxInfoList
            }) : o;
        }).filter(o => o
            && Array.isArray(o.shipmentInformationList)
            && o.shipmentInformationList.length);

        if (!options.length && detail
            && Array.isArray(detail.shipmentInformationList)
            && detail.shipmentInformationList.length) {
            options = [detail];
        }
        return options;
    }

    function buildA(options) {
        return options.map(option => {
            const cfgFee = (option.fees || [])
                .find(f => String(f.target).includes('入库配置费'));
            return {
                shipmentCount: option.shipmentCount,
                planName: `${option.shipmentCount}个货件`,
                placementFee: cfgFee ? Number(cfgFee.amount) : (Number(option.feeCount) || 0),
                placementFeeCurrency: cfgFee ? cfgFee.code : 'USD',
                shipments: option.shipmentInformationList.map(s => {
                    const boxInfo = (option.packingBoxInfoList || [])
                        .find(b => b.shipmentId === s.shipmentId);
                    const boxCount = boxInfo
                        ? boxInfo.shipmentPackingList.reduce(
                            (n, p) => n + (Number(p.total) || 0), 0)
                        : 0;
                    return {
                        region: s.postalCodeMark,
                        warehouseCode: s.wareHouseId,
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

    // ================= 本地服务调用 =================
    function api(path, payload, timeout) {
        timeout = timeout || 60000;
        const isGet = payload === undefined;
        const send = (opts) => {
            if (typeof GM_xmlhttpRequest === 'function') {
                GM_xmlhttpRequest(Object.assign({ method: isGet ? 'GET' : 'POST', url: BASE + path,
                    timeout, responseType: 'json' }, opts));
            } else {
                // 兜底：服务端已对领星来源放行 CORS
                fetch(BASE + path, {
                    method: isGet ? 'GET' : 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: isGet ? undefined : JSON.stringify(payload),
                    signal: AbortSignal.timeout(timeout)
                }).then(async r => {
                    const d = await r.json().catch(() => null);
                    opts.onload && opts.onload({ status: r.status, response: d });
                }).catch(e => opts.onerror && opts.onerror(e));
            }
        };
        return new Promise((resolve, reject) => {
            send({
                headers: isGet ? {} : { 'Content-Type': 'application/json' },
                data: isGet ? undefined : JSON.stringify(payload),
                onload: r => {
                    let d = r.response;
                    if (!d && r.responseText) { try { d = JSON.parse(r.responseText); } catch (e) {} }
                    if (r.status >= 200 && r.status < 300 && d) resolve(d);
                    else reject(new Error((d && d.error) || ('HTTP ' + r.status)));
                },
                onerror: () => reject(new Error('NOCONN')),
                ontimeout: () => reject(new Error('TIMEOUT'))
            });
        });
    }

    // ================= UI 骨架 =================
    const host = PAGE.createElement('div');
    host.id = 'lx-quote-host';
    host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483000;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${CSS}</style>
    <div class="root">
      <div class="bar" style="pointer-events:auto">
        <span class="dot" id="dot" title="本地比价服务"></span>
        <button class="btn main" id="go">⚡ 分析物流方案</button>
        <button class="btn ghost" id="copy">📋 JSON</button>
      </div>
      <div class="drawer" id="drawer" style="pointer-events:auto">
        <div class="head">
          <h3>物流方案分析</h3>
          <span class="pill kp" id="eng" style="display:none"></span>
          <div class="sp"></div>
          <button class="close" id="close" title="关闭">×</button>
        </div>
        <div class="metabar" id="metabar"></div>
        <div class="body" id="body"><div class="empty">点「⚡ 分析物流方案」开始</div></div>
        <div class="foot">
          <span class="note" id="footNote">卡派=入仓天数，快递派=提取工作日，两者不可直接比</span>
          <button class="btn ghost mini" id="rep">生成完整报告</button>
          <button class="btn ghost mini" id="repAi">+ AI 解读</button>
        </div>
      </div>
    </div>`;
    PAGE.documentElement.appendChild(host);

    const $ = (id) => shadow.getElementById(id);
    const drawer = $('drawer'), bodyEl = $('body'), metaEl = $('metabar');

    let lastPlans = null;       // 最近一次的 A 格式数据（换交期时复用）
    let lastRes = null;
    let curMaxTransit = '';

    const esc = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const fmt = (n) => (n == null || isNaN(n)) ? '—'
        : Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
    const fmt2 = (n) => (n == null || isNaN(n)) ? '—' : Number(n).toFixed(2);

    function toast(text, cls) {
        const b = $('go');
        const old = b.textContent;
        b.textContent = text;
        if (cls) b.style.background = cls;
        setTimeout(() => { b.textContent = old; b.style.background = ''; }, 2200);
    }

    function showErr(e) {
        const noc = String(e.message || e) === 'NOCONN';
        bodyEl.innerHTML = `<div class="err">
          ${noc ? '连不上本地比价服务（127.0.0.1:32146）。' : '分析失败：' + esc(e.message || e)}
          <div style="margin-top:8px">
            ${noc ? `启动方式：双击 <code>C:\\workbuddy\\物流报价比价\\启动比价服务.cmd</code>
                     （黑窗口别关，可最小化）` : ''}
          </div>
          <div style="margin-top:8px"><span class="link" id="retry">重试</span></div>
        </div>`;
        const r = shadow.getElementById('retry');
        if (r) r.onclick = () => run(lastPlans);
    }

    // ================= 渲染 =================
    function renderMeta(m) {
        const q = m.quote || {};
        const stale = q.stale
            ? `<span class="tag warn">⚠️ 报价表 ${esc((q.generatedAt || '').slice(5, 10))} · ${q.ageDays} 天前，建议刷新</span>`
            : `<span class="tag ok">报价表 ${esc((q.generatedAt || '').slice(5, 10))}</span>`;
        metaEl.innerHTML = `
          <span class="tag">总重 <b>${fmt(m.kg)}</b> KG</span>
          <span class="tag">体积 <b>${m.cbm}</b> M³</span>
          <span class="tag">计费重 <b>${fmt(m.billKg)}</b> KG</span>
          <span class="tag">比重 <b>${m.density || '—'}</b> kg/m³</span>
          <span class="tag">${esc(m.provider)}</span>
          ${stale}
          <select class="sel" id="mt">
            <option value="">交期不限</option>
            <option value="35">≤35 天</option>
            <option value="30">≤30 天</option>
            <option value="25">≤25 天</option>
            <option value="20">≤20 天</option>
          </select>`;
        const mt = shadow.getElementById('mt');
        mt.value = curMaxTransit;
        mt.onchange = () => { curMaxTransit = mt.value; run(lastPlans); };
    }

    function renderRec(rec, m) {
        if (!rec) return '';
        const flag = rec.flag
            ? `<div class="flag ${rec.flag.level === 'error' ? 'error' : 'warn'}">${esc(rec.flag.text)}</div>` : '';
        const meas = rec.measured
            ? `<div class="measured">实测校正：${esc(rec.measured.code)} 中位 <b>${rec.measured.p50} 天</b>`
              + `（p80 ${rec.measured.p80}，n=${rec.measured.n}）${esc(rec.measured.note || '')}</div>` : '';
        const lead = (rec.lead != null && rec.lead > 0)
            ? `领先第二名 <b>¥${fmt(rec.lead)}</b>（${fmt2(rec.leadPct)}%） · ` : '';
        return `<div class="rec">
          <div class="lab">★ 推荐方案</div>
          <div class="top">
            <span class="name">${esc(rec.shortName || rec.name)}</span>
            <span class="money">¥${fmt(rec.total)}</span>
          </div>
          <div class="sub">${lead}时效 ${esc(rec.transitText)} · 运费 ¥${fmt(rec.freight)} · 配置费 $${fmt(rec.feeUsd)}</div>
          ${flag}${meas}
        </div>`;
    }

    function renderPlans(plans) {
        const rows = plans.map(p => {
            const cls = p.isCheapest ? 'best' : '';
            const tag = p.isCheapest ? '<span class="pill best">最优</span>' : '';
            return `<tr class="${cls}">
              <td>${esc(p.shortName)}${tag}</td>
              <td class="num">¥${fmt(p.freight)}</td>
              <td class="num">${p.feeUsd ? '$' + fmt(p.feeUsd) : '—'}</td>
              <td class="num"><b>¥${fmt(p.total)}</b></td>
              <td class="num">${p.diff > 0 ? '+¥' + fmt(p.diff) : (p.diff === 0 ? '—' : '')}</td>
              <td>${esc(p.transitText)}</td>
              <td class="num">${p.unitPrice ? fmt2(p.unitPrice) : '—'}</td>
            </tr>`;
        }).join('');
        return `<div class="sec">方案对照（包税口径）</div>
        <div class="tblwrap"><table>
          <thead><tr>
            <th>方案</th><th class="num">运费</th><th class="num">配置费</th>
            <th class="num">合计</th><th class="num">比最优</th><th>时效</th><th class="num">元/kg</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table></div>`;
    }

    function renderDetail(detail) {
        const blocks = detail.map(d => {
            const rows = d.rows.map(x => {
                const pill = x.mode === '卡派' ? '<span class="pill kp">卡派</span>'
                    : x.mode === '快递派' ? '<span class="pill ep">快递派</span>'
                    : `<span class="pill na">${esc(x.mode)}</span>`;
                return `<tr>
                  <td><b>${esc(x.wh)}</b><div style="color:#9ca3af;font-size:11px">${esc(x.state || '')} ${esc(x.zip || '')}</div></td>
                  <td class="num">${fmt(x.kg)}</td>
                  <td class="num">${x.cbm != null ? x.cbm : '—'}</td>
                  <td class="num">${x.boxes != null ? x.boxes : '—'}</td>
                  <td>${pill}<div style="font-size:11px;color:#4b5563;margin-top:2px">${esc(x.channel)}</div></td>
                  <td class="num">${x.price ? fmt2(x.price) : '—'}</td>
                  <td class="num">${x.billKg ? fmt(x.billKg) : '—'}</td>
                  <td class="num"><b>¥${fmt(x.charge)}</b></td>
                  <td>${esc(x.transit)}</td>
                </tr>`;
            }).join('');
            const fee = d.feeUsd ? ` · 配置费 $${fmt(d.feeUsd)}` : '';
            return `<details class="plan">
              <summary>
                <span>${esc(d.plan)}</span>
                <span style="margin-left:auto;font-weight:700">¥${fmt(d.total)}</span>
                <span style="color:#9ca3af;font-weight:400">运费 ¥${fmt(d.subtotal)}${fee}</span>
              </summary>
              <div class="inner">
                <div class="tblwrap"><table>
                  <thead><tr>
                    <th>仓</th><th class="num">KG</th><th class="num">M³</th><th class="num">箱</th>
                    <th>渠道</th><th class="num">单价</th><th class="num">计费重</th>
                    <th class="num">运费</th><th>时效</th>
                  </tr></thead>
                  <tbody>${rows}</tbody>
                </table></div>
              </div>
            </details>`;
        }).join('');
        return `<div class="sec">逐仓明细（点击展开）</div>${blocks}`;
    }

    function renderNotes(res) {
        let h = '';
        if (res.advice && res.advice.length) {
            h += `<div class="sec">判断依据</div><ul class="adv">`
                + res.advice.map(a => `<li>${esc(a)}</li>`).join('') + `</ul>`;
        }
        if (res.confirm && res.confirm.length) {
            h += `<div class="sec">下单前要确认</div>`
                + res.confirm.map(c => `<div class="kv"><span class="k">${esc(c.t)}</span><span>${esc(c.d)}</span></div>`).join('');
        }
        if (res.meta && res.meta.warnings && res.meta.warnings.length) {
            h += `<div class="sec">数据提示</div><ul class="adv">`
                + res.meta.warnings.map(w => `<li>${esc(w)}</li>`).join('') + `</ul>`;
        }
        return h;
    }

    function render(res) {
        lastRes = res;
        renderMeta(res.meta);
        bodyEl.innerHTML = renderRec(res.recommend, res.meta)
            + renderPlans(res.plans)
            + renderDetail(res.detail)
            + renderNotes(res)
            + `<div style="margin-top:16px;color:#9ca3af;font-size:11.5px">
                 引擎 ${res.meta.elapsedMs} ms · 报价源 ${esc(res.meta.quoteFile)} ·
                 已剔除 ${res.meta.untaxedSkipped} 条不包税渠道</div>`;
    }

    // ================= 主流程 =================
    async function run(plans) {
        if (!plans) {
            const vueCtx = getVueCtx();
            if (!vueCtx) { toast('❌ 未找到分仓组件'); return; }
            const options = getOptions(vueCtx);
            if (!options.length) { toast('❌ 无分仓数据，请先计算'); return; }
            plans = buildA(options);
            lastPlans = plans;
        }
        drawer.classList.add('open');
        metaEl.innerHTML = '';
        bodyEl.innerHTML = `<div class="empty"><span class="spin"></span>正在比价…</div>`;
        $('go').disabled = true;
        try {
            const payload = { plans, options: {} };
            if (curMaxTransit) payload.options.maxTransit = Number(curMaxTransit);
            const res = await api('/api/analyze', payload, 45000);
            $('dot').className = 'dot on';
            render(res);
        } catch (e) {
            $('dot').className = 'dot off';
            showErr(e);
        } finally {
            $('go').disabled = false;
        }
    }

    $('go').onclick = () => run(lastPlans);
    $('close').onclick = () => drawer.classList.remove('open');

    $('copy').onclick = async () => {
        const vueCtx = getVueCtx();
        if (!vueCtx) { toast('❌ 未找到分仓组件'); return; }
        const options = getOptions(vueCtx);
        if (!options.length) { toast('❌ 无分仓数据'); return; }
        const A = buildA(options);
        try {
            await navigator.clipboard.writeText(JSON.stringify(A, null, 2));
            toast(`✅ 已复制 ${A.length} 个方案`);
        } catch (e) {
            console.log('分仓JSON A =', A);
            toast('⚠️ 复制失败，看控制台');
        }
    };

    async function report(withAi) {
        const btn = withAi ? $('repAi') : $('rep');
        if (!lastPlans) { toast('先分析一次'); return; }
        const old = btn.textContent;
        btn.disabled = true;
        btn.textContent = withAi ? 'AI 解读中…（约1分钟）' : '生成中…';
        $('footNote').textContent = '正在生成，请勿关闭页面…';
        try {
            const r = await api('/api/report', {
                plans: lastPlans,
                options: { maxTransit: curMaxTransit ? Number(curMaxTransit) : undefined, ai: !!withAi }
            }, withAi ? 340000 : 200000);
            if (r.ok && r.html) {
                $('footNote').innerHTML = `<span class="link" id="op" title="${esc(r.html)}">报告已生成 · 点此打开</span>`
                    + (withAi && !r.ai ? '（AI 未成功，用模板结论）' : '');
                const op = shadow.getElementById('op');
                if (op) op.onclick = () => api('/api/open', { file: r.html }, 10000).catch(() => {});
            } else {
                $('footNote').textContent = '生成失败：' + (r.error || '未知错误');
            }
        } catch (e) {
            $('footNote').textContent = '生成失败：' + (e.message || e);
        } finally {
            btn.disabled = false;
            btn.textContent = old;
        }
    }
    $('rep').onclick = () => report(false);
    $('repAi').onclick = () => report(true);

    // ================= 健康检查 =================
    let up = null;
    async function ping() {
        try {
            const h = await api('/health', undefined, 4000);
            const newUp = !!h.ok;
            if (newUp !== up) {
                up = newUp;
                $('dot').className = 'dot ' + (up ? 'on' : 'off');
                $('dot').title = up
                    ? `本地服务在线 · 报价表 ${(h.quote || {}).generatedAt || ''}`
                    : '本地比价服务未启动';
            }
        } catch (e) {
            up = false;
            $('dot').className = 'dot off';
            $('dot').title = '本地比价服务未启动（双击 启动比价服务.cmd）';
        }
    }

    // ================= 显示条件 =================
    setInterval(() => {
        const show = location.href.includes('SendToAmazon')
            && !!PAGE.querySelector('.sta-delivery-service-wrapper');
        host.style.display = show ? 'block' : 'none';
    }, 1000);

    ping();
    setInterval(ping, 30000);
})();
