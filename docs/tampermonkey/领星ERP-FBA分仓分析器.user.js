// ==UserScript==
// @name         领星ERP-FBA分仓分析器 (V4.8 决策增强版)
// @namespace    http://tampermonkey.net/
// @version      4.8
// @description  集成了加权评分决策模型。在报告页增加“时间价值”滑块，支持按(价格+时效*系数)动态排序，自动高亮最优、最省、最快渠道。
// @author       Your Assistant
// @match        *://erp.lingxing.com/*
// @require      https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // =================================================================================
    // 1. 核心状态管理
    // =================================================================================
    const state = {
        currentDetail: null,
        rateMap: {},
        hasRates: false,
        cacheTime: null
    };
    const STORAGE_KEY = 'lx_fba_rates_v4_8_cache';

    const ZONE_MAPPING = {
        "WEST": ["ONT8", "LGB8", "LAX9", "SBD1", "SBD2", "GYR2", "GYR3", "LAS1", "SMF3", "SCK4", "PHX7", "PHX5", "FAT2", "OAK3", "SJC7", "XLX7", "PSP3", "IUSJ", "IUSQ"],
        "CENTRAL": ["IND9", "MDW2", "MEM1", "FTW1", "DFW6", "HOU8", "SAT1", "ORD2", "STL4", "MQJ1", "FWA4", "CMH2", "CMH3", "DET1", "DET2"],
        "EAST": ["ABE8", "TEB9", "AVP1", "CLT2", "BWI4", "PHL4", "RIC1", "JAX3", "RDU4", "GSP1", "SWF1", "ACY2", "TTN2", "ALB1", "BOS7"]
    };

    // =================================================================================
    // 2. 样式注入 (控制面板)
    // =================================================================================
    function addControlPanelStyle() {
        const css = `
            .lx-control-panel {
                position: fixed; bottom: 160px; right: 30px; z-index: 9999;
                background: white; padding: 10px; border-radius: 8px;
                box-shadow: 0 4px 15px rgba(0,0,0,0.1); border: 1px solid #ebeef5;
                display: flex; flex-direction: column; gap: 6px;
                font-family: sans-serif; transition: all 0.3s; width: 140px;
            }
            .lx-control-panel:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,0.15); }
            .lx-cache-info { font-size: 11px; color: #909399; text-align: center; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .lx-cache-info.active { color: #67c23a; font-weight: bold; }
            .lx-btn { padding: 6px 10px; border-radius: 4px; border: none; cursor: pointer; font-size: 12px; font-weight: 500; display: flex; align-items: center; justify-content: center; gap: 5px; transition: background 0.2s; text-decoration: none; }
            .lx-btn-primary { background: #4f46e5; color: #fff; } /* Indigo-600 */
            .lx-btn-primary:hover { background: #4338ca; }
            .lx-btn-success { background: #10b981; color: #fff; } /* Emerald-500 */
            .lx-btn-success:hover { background: #059669; }
            .lx-file-input { display: none; }
        `;
        const styleNode = document.createElement('style');
        styleNode.appendChild(document.createTextNode(css));
        document.head.appendChild(styleNode);
    }

    // =================================================================================
    // 3. 业务逻辑 (Excel解析 & 数据处理)
    // =================================================================================

    function formatTime(timestamp) {
        if (!timestamp) return '';
        const date = new Date(timestamp);
        return `${date.getMonth() + 1}-${date.getDate()} ${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`;
    }

    function loadCachedRates() {
        const cached = localStorage.getItem(STORAGE_KEY);
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                if (parsed.data && parsed.timestamp) {
                    state.rateMap = parsed.data;
                    state.cacheTime = parsed.timestamp;
                } else {
                    state.rateMap = parsed;
                    state.cacheTime = null;
                }
                state.hasRates = Object.keys(state.rateMap).length > 0;
                updateUIStatus();
            } catch (e) { console.error('读取缓存失败', e); }
        }
    }

    function calculateAvgTime(text) {
        if (!text) return 999;
        const nums = text.match(/\d+(\.\d+)?/g);
        if (!nums || nums.length === 0) return 999;
        const validNums = nums.map(n => parseFloat(n)).filter(n => n > 0 && n < 100);
        if (validNums.length === 0) return 999;
        if (validNums.length === 1) return validNums[0];
        const avg = (validNums[0] + validNums[1]) / 2;
        return parseFloat(avg.toFixed(1));
    }

    function handleFileUpload(e) {
        const file = e.target.files[0];
        if (!file) return;
        const statusEl = document.getElementById('lx-cache-info');
        if(statusEl) statusEl.innerText = "解析中...";

        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                processAllSheets(workbook);
            } catch (err) {
                alert("解析Excel失败，请检查文件格式");
                console.error(err);
                updateUIStatus();
            }
        };
        reader.readAsArrayBuffer(file);
        e.target.value = '';
    }

    function processAllSheets(workbook) {
        let totalCount = 0;
        const newMap = {};
        const addRate = (whCode, rateObj) => {
            const code = whCode.toUpperCase().trim();
            if (!newMap[code]) newMap[code] = [];
            newMap[code].push(rateObj);
            totalCount++;
        };

        workbook.SheetNames.forEach(sheetName => {
            if (!/美国|WE|美森|美东|美西|美中/i.test(sheetName)) return;
            const worksheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            if (!rows || rows.length < 2) return;

            let headerRowIndex = -1, whColIndex = -1, priceColIndex = -1;
            for (let i = 0; i < Math.min(rows.length, 20); i++) {
                const row = rows[i];
                const rowStr = row.map(c => String(c)).join(' ');
                const wIndex = row.findIndex(cell => /仓库|地址|FBA|代码|Destination|国家|区域|分区|邮编/i.test(String(cell)));
                let pIndex = row.findIndex(cell => /100KG\+|100kg\+|101KG\+/i.test(String(cell)));
                if (pIndex === -1) pIndex = row.findIndex(cell => /71KG\+/i.test(String(cell)));
                if (pIndex === -1) pIndex = row.findIndex(cell => /21KG\+|21kg\+/i.test(String(cell)));
                if (pIndex === -1 && /价格|单价/i.test(rowStr)) pIndex = row.findIndex(cell => /价格|单价|Price/i.test(String(cell)));

                if (wIndex !== -1 && pIndex !== -1) {
                    headerRowIndex = i;
                    whColIndex = wIndex;
                    priceColIndex = pIndex;
                    break;
                }
            }
            if (headerRowIndex === -1) return;

            let timeColIndex1 = rows[headerRowIndex].findIndex(cell => /时效|Time|Days/i.test(String(cell)));
            let timeColIndex2 = -1;
            if (timeColIndex1 !== -1) {
                const restRow = rows[headerRowIndex].slice(timeColIndex1 + 1);
                const offset = restRow.findIndex(cell => /时效|Time|Days/i.test(String(cell)));
                if (offset !== -1) timeColIndex2 = timeColIndex1 + 1 + offset;
            }

            let lastValidTime = '';
            for (let i = headerRowIndex + 1; i < rows.length; i++) {
                const row = rows[i];
                const rawWh = row[whColIndex];
                const rawPrice = row[priceColIndex];
                if (!rawWh || rawPrice == null) continue;

                let priceStr = String(rawPrice).replace(/[^\d.]/g, '');
                const price = parseFloat(priceStr);
                if (isNaN(price) || price <= 0) continue;

                let timeText = '';
                if (timeColIndex1 !== -1) {
                    let t1 = row[timeColIndex1] || '';
                    if (!t1 && lastValidTime) t1 = lastValidTime;
                    else if (t1) lastValidTime = t1;
                    let t2 = (timeColIndex2 !== -1) ? (row[timeColIndex2] || '') : '';
                    if (t1 && t2) timeText = `${t1} + ${t2}`;
                    else timeText = t1 || t2;
                }
                if (!timeText && (String(rawWh).includes('天') || String(rawWh).includes('时效'))) {
                    const match = String(rawWh).match(/(\d+[-]\d+|\d+)\s*天/);
                    if (match) timeText = match[0];
                }
                if (!timeText) {
                    const timeCell = row.find(c => String(c).includes('天') || String(c).includes('Workdays'));
                    if (timeCell) timeText = timeCell;
                }
                if (!timeText) timeText = '待确认';
                const avgTime = calculateAvgTime(timeText);

                const channelColIndex = rows[headerRowIndex].findIndex(cell => /渠道/i.test(String(cell)));
                let channelName = channelColIndex !== -1 ? row[channelColIndex] : sheetName;
                if (!channelName) channelName = sheetName;
                if (sheetName.includes('WE') || sheetName.includes('快递')) {
                    const rawWhStr = String(rawWh).split(/[\n\r]/)[0];
                    if (!channelName.includes(rawWhStr)) channelName = `${channelName} - ${rawWhStr}`;
                }

                const whStr = String(rawWh).toUpperCase();
                const rateData = { price, time: timeText, avgTime, channel: channelName, sheet: sheetName };

                if (sheetName.includes('WE') || whStr.includes('UPS') || whStr.includes('DHL')) {
                    addRate('ALL_US', rateData);
                } else if (whStr.includes('美西') || whStr.includes('8-9') || whStr.includes('8.9')) {
                    ZONE_MAPPING.WEST.forEach(wh => addRate(wh, rateData));
                } else if (whStr.includes('美中') || whStr.includes('4-7') || whStr.includes('4.5.6.7')) {
                    ZONE_MAPPING.CENTRAL.forEach(wh => addRate(wh, rateData));
                } else if (whStr.includes('美东') || whStr.includes('0-3') || whStr.includes('0.1.2.3')) {
                    ZONE_MAPPING.EAST.forEach(wh => addRate(wh, rateData));
                } else {
                    const whList = whStr.split(/[\/、,，\s\n]+/);
                    whList.forEach(code => {
                        let cleanCode = code.trim();
                        if (cleanCode.length >= 3 && cleanCode.length <= 8 && /[A-Z0-9]/.test(cleanCode)) {
                            addRate(cleanCode, rateData);
                        }
                    });
                }
            }
        });

        if (totalCount > 0) {
            state.rateMap = newMap;
            state.hasRates = true;
            state.cacheTime = Date.now();
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ timestamp: state.cacheTime, data: newMap }));
            updateUIStatus();
            alert(`✅ 导入成功！共提取 ${totalCount} 条报价。`);
        } else {
            updateUIStatus();
            alert('❌ 未识别到有效数据，请检查Excel格式。');
        }
    }

    // =================================================================================
    // 4. 报告生成 (核心修改部分：注入数据与JS逻辑)
    // =================================================================================
    function fetchCurrentOption() {
        try {
            const wrapper = document.querySelector('.sta-delivery-service-wrapper');
            if (wrapper && wrapper.__vue__) {
                const vueCtx = wrapper.__vue__;
                let detail = vueCtx.placementOptionDetail;
                if ((!detail || !detail.shipmentInformationList) && vueCtx.placementOptionList && vueCtx.placementOptionList.length > 0) {
                    detail = vueCtx.placementOptionList[0];
                }
                state.currentDetail = detail;
                return !!detail;
            }
        } catch(e) { console.error(e); }
        return false;
    }

    function openReportInNewTab() {
        if (!fetchCurrentOption()) {
            alert('⚠️ 未检测到货件数据！请确保已计算出分仓结果。');
            return;
        }
        if (!state.hasRates && !confirm('⚠️ 暂无报价数据，报告将无法计算运费。是否继续？')) return;

        // 准备注入到 HTML 中的 JSON 数据
        const injectionData = prepareInjectionData(state.currentDetail, state.rateMap);
        const htmlContent = generateReportHTML(state.currentDetail, injectionData);

        const newWindow = window.open('', '_blank');
        if (newWindow) {
            newWindow.document.write(htmlContent);
            newWindow.document.close();
        } else {
            alert('❌ 弹窗被拦截！');
        }
    }

    // 将数据预处理为纯 JSON 结构，方便前端 JS 使用
    function prepareInjectionData(detail, rateMap) {
        return detail.shipmentInformationList.map(ship => {
            const wh = ship.wareHouseId ? ship.wareHouseId.toUpperCase() : '未知';
            const weight = parseFloat(ship.weightCount) || 0;
            const count = ship.declareQuantity || 0;

            let channels = [];
            if (Object.keys(rateMap).length > 0) {
                const specificRates = rateMap[wh] || [];
                const generalRates = rateMap['ALL_US'] || [];
                channels = [...specificRates, ...generalRates];

                // 去重
                const uniqueSet = new Set();
                channels = channels.filter(item => {
                    const key = `${item.sheet}-${item.channel}-${item.price}`;
                    if (uniqueSet.has(key)) return false;
                    uniqueSet.add(key);
                    return true;
                });
            }

            return {
                wh,
                shipmentName: ship.shipmentName || '无货件名',
                weight,
                count,
                channels // 包含 {price, avgTime, time, channel, sheet}
            };
        });
    }

    function generateReportHTML(detail, injectionData) {
        const amazonFee = parseFloat(detail.feeCount) || 0;
        const totalWeight = detail.shipmentInformationList.reduce((acc, cur) => acc + (parseFloat(cur.weightCount) || 0), 0);
        const now = new Date().toLocaleString();
        const jsonString = JSON.stringify(injectionData).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

        return `
            <!DOCTYPE html>
            <html lang="zh-CN">
            <head>
                <meta charset="UTF-8">
                <title>FBA智能决策 - ${detail.placementOptionId || ''}</title>
                <style>
                    :root { --primary: #4f46e5; --primary-light: #e0e7ff; --success: #10b981; --success-light: #d1fae5; --purple: #9333ea; --purple-light: #f3e8ff; --slate-50: #f8fafc; --slate-100: #f1f5f9; --slate-200: #e2e8f0; --slate-500: #64748b; --slate-800: #1e293b; }
                    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f8fafc; margin: 0; padding: 20px; color: var(--slate-800); }
                    .container { max-width: 1000px; margin: 0 auto; }

                    /* Header */
                    .header { background: white; padding: 20px 24px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
                    .header h1 { margin: 0; font-size: 20px; color: #111; display: flex; align-items: center; gap: 8px; }
                    .header p { margin: 4px 0 0; color: var(--slate-500); font-size: 13px; }
                    .stat-box { text-align: right; }
                    .stat-val { font-size: 20px; font-weight: 700; color: #111; }
                    .stat-lbl { font-size: 12px; color: var(--slate-500); }

                    /* Control Panel (Slider) */
                    .controls { background: white; padding: 20px 24px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 24px; border: 1px solid var(--slate-200); }
                    .ctrl-header { display: flex; justify-content: space-between; margin-bottom: 15px; }
                    .ctrl-title { font-weight: 600; font-size: 16px; display: flex; align-items: center; gap: 6px; }
                    .ctrl-val { font-size: 24px; font-weight: 700; color: var(--primary); }
                    .ctrl-val span { font-size: 12px; color: var(--slate-500); font-weight: 400; }
                    input[type=range] { width: 100%; height: 6px; background: var(--slate-200); border-radius: 5px; outline: none; -webkit-appearance: none; cursor: pointer; }
                    input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; background: var(--primary); border-radius: 50%; cursor: pointer; transition: transform 0.1s; }
                    input[type=range]::-webkit-slider-thumb:hover { transform: scale(1.2); }
                    .range-labels { display: flex; justify-content: space-between; margin-top: 8px; font-size: 12px; color: var(--slate-500); font-weight: 500; }

                    /* Cards */
                    .card { background: white; border-radius: 12px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); margin-bottom: 20px; overflow: hidden; border: 1px solid var(--slate-200); }
                    .card-head { background: var(--slate-50); padding: 12px 20px; border-bottom: 1px solid var(--slate-200); display: flex; justify-content: space-between; align-items: center; }
                    .wh-tag { background: var(--slate-200); color: var(--slate-800); padding: 4px 10px; border-radius: 6px; font-weight: 700; font-size: 14px; margin-right: 10px; }
                    .meta { font-size: 13px; color: var(--slate-500); display: flex; gap: 15px; }

                    /* Table */
                    table { width: 100%; border-collapse: collapse; font-size: 13px; }
                    th { text-align: left; padding: 12px 16px; background: white; color: var(--slate-500); font-weight: 600; border-bottom: 1px solid var(--slate-200); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
                    td { padding: 12px 16px; border-bottom: 1px solid var(--slate-100); color: var(--slate-800); vertical-align: middle; }
                    tr:last-child td { border-bottom: none; }

                    /* Visual Aids & Highlighting */
                    tr.best-value { background-color: #eff6ff; /* indigo-50 */ position: relative; }
                    tr.best-value td:first-child { border-left: 3px solid var(--primary); }

                    .badge { display: inline-flex; align-items: center; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; margin-left: 6px; line-height: 1; border: 1px solid transparent; }
                    .badge-best { background: var(--primary-light); color: var(--primary); border-color: #c7d2fe; }
                    .badge-cheap { background: var(--success-light); color: var(--success); border-color: #a7f3d0; }
                    .badge-fast { background: var(--purple-light); color: var(--purple); border-color: #e9d5ff; }

                    .val-cheap { color: var(--success); font-weight: 700; }
                    .val-fast { color: var(--purple); font-weight: 700; }
                    .rank-num { display: inline-block; width: 18px; height: 18px; line-height: 18px; text-align: center; border-radius: 50%; background: var(--slate-200); color: var(--slate-500); font-size: 10px; font-weight: bold; margin-right: 8px; }
                    .best-value .rank-num { background: var(--primary); color: white; }

                    .channel-name { font-weight: 600; display: block; margin-bottom: 2px; }
                    .channel-sub { font-size: 11px; color: var(--slate-500); }
                    .best-value .channel-name { color: #312e81; }
                    .best-value .channel-sub { color: #6366f1; }

                    .empty-msg { text-align: center; padding: 30px; color: var(--slate-500); font-style: italic; }
                </style>
            </head>
            <body>
                <div class="container">
                    <!-- Header -->
                    <div class="header">
                        <div>
                            <h1>📊 FBA 分仓决策分析</h1>
                            <p>生成时间: ${now}</p>
                        </div>
                        <div class="stat-box">
                            <div class="stat-val" style="color:#ef4444">$${amazonFee.toFixed(2)}</div>
                            <div class="stat-lbl">配置费</div>
                        </div>
                        <div class="stat-box" style="margin-left: 30px">
                            <div class="stat-val">${totalWeight.toFixed(2)} kg</div>
                            <div class="stat-lbl">总重量</div>
                        </div>
                    </div>

                    <!-- Controls -->
                    <div class="controls">
                        <div class="ctrl-header">
                            <div class="ctrl-title">
                                ⏱️ 时间价值系数
                                <span style="font-size:12px; color:#64748b; font-weight:400; margin-left:8px;">(加权评分法: 分数 = 运费 + 时效 × 系数)</span>
                            </div>
                            <div class="ctrl-val">
                                ¥<span id="coef-display">0.20</span><span>/天</span>
                            </div>
                        </div>
                        <input type="range" id="coef-slider" min="0" max="1" step="0.05" value="0.2">
                        <div class="range-labels">
                            <span>0 (只看价格)</span>
                            <span style="color:var(--primary); font-weight:bold">0.2 (推荐平衡点)</span>
                            <span>0.5 (急货)</span>
                            <span>1.0 (不计成本)</span>
                        </div>
                    </div>

                    <!-- Content Area -->
                    <div id="shipments-container"></div>
                </div>

                <script>
                    // 1. 获取注入的数据
                    const SHIPMENTS = JSON.parse('${jsonString}');

                    // 2. DOM 元素
                    const container = document.getElementById('shipments-container');
                    const slider = document.getElementById('coef-slider');
                    const display = document.getElementById('coef-display');

                    // 3. 核心渲染逻辑
                    function render(coefficient) {
                        display.innerText = coefficient.toFixed(2);
                        container.innerHTML = ''; // 清空

                        SHIPMENTS.forEach(ship => {
                            // 计算分数并排序
                            let processedChannels = [];

                            if (ship.channels && ship.channels.length > 0) {
                                // 找出极值用于打标
                                const minPrice = Math.min(...ship.channels.map(c => c.price));
                                const minDays = Math.min(...ship.channels.map(c => c.avgTime === 999 ? 9999 : c.avgTime));

                                processedChannels = ship.channels.map(c => {
                                    const daysVal = c.avgTime === 999 ? 100 : c.avgTime; // 无时效按100天算分
                                    const score = c.price + (daysVal * coefficient);
                                    return {
                                        ...c,
                                        score: score,
                                        isCheapest: c.price === minPrice,
                                        isFastest: c.avgTime !== 999 && c.avgTime === minDays
                                    };
                                });

                                // 排序：分数越低越好
                                processedChannels.sort((a, b) => {
                                    const diff = a.score - b.score;
                                    return Math.abs(diff) < 0.01 ? a.price - b.price : diff;
                                });
                            }

                            // 生成表格 HTML
                            let rowsHtml = '';
                            if (processedChannels.length === 0) {
                                rowsHtml = '<tr><td colspan="5" class="empty-msg">⚠️ 该仓库无匹配报价</td></tr>';
                            } else {
                                rowsHtml = processedChannels.map((c, idx) => {
                                    const isBest = idx === 0;
                                    const totalCost = (ship.weight * c.price).toFixed(2);

                                    // 徽章 HTML
                                    let badges = '';
                                    if (isBest) badges += '<span class="badge badge-best">综合推荐</span>';
                                    if (c.isCheapest) badges += '<span class="badge badge-cheap">最省</span>';
                                    if (c.isFastest) badges += '<span class="badge badge-fast">最快</span>';

                                    // 样式类
                                    const rowClass = isBest ? 'best-value' : '';
                                    const priceClass = c.isCheapest ? 'val-cheap' : '';
                                    const timeClass = c.isFastest ? 'val-fast' : '';

                                    return \`
                                        <tr class="\${rowClass}">
                                            <td width="35%">
                                                <div style="display:flex; align-items:center;">
                                                    <span class="rank-num">\${idx + 1}</span>
                                                    <div>
                                                        <span class="channel-name">\${c.channel} \${badges}</span>
                                                        <span class="channel-sub">\${c.sheet}</span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td width="20%">\${c.time}</td>
                                            <td width="10%" class="\${timeClass}">
                                                \${c.avgTime === 999 ? '-' : c.avgTime + '天'}
                                            </td>
                                            <td width="15%" class="\${priceClass}">¥\${c.price}</td>
                                            <td width="20%" style="font-weight:bold">¥\${totalCost}</td>
                                        </tr>
                                    \`;
                                }).join('');
                            }

                            // 组装卡片
                            const cardHtml = \`
                                <div class="card">
                                    <div class="card-head">
                                        <div style="display:flex; align-items:center;">
                                            <span class="wh-tag">\${ship.wh}</span>
                                            <span style="font-weight:600; color:#334155">\${ship.shipmentName}</span>
                                        </div>
                                        <div class="meta">
                                            <span>📦 \${ship.weight.toFixed(2)} kg</span>
                                            <span>📊 \${ship.count} pcs</span>
                                        </div>
                                    </div>
                                    <table>
                                        <thead>
                                            <tr>
                                                <th>物流渠道</th>
                                                <th>时效描述</th>
                                                <th>预估</th>
                                                <th>单价</th>
                                                <th>总运费</th>
                                            </tr>
                                        </thead>
                                        <tbody>\${rowsHtml}</tbody>
                                    </table>
                                </div>
                            \`;
                            container.insertAdjacentHTML('beforeend', cardHtml);
                        });
                    }

                    // 4. 事件监听
                    slider.addEventListener('input', (e) => {
                        render(parseFloat(e.target.value));
                    });

                    // 5. 初始渲染 (默认 0.2)
                    render(0.2);

                </script>
            </body>
            </html>
        `;
    }

    // =================================================================================
    // 5. 初始化 UI
    // =================================================================================
    function updateUIStatus() {
        const el = document.getElementById('lx-cache-info');
        if (!el) return;
        if (state.hasRates) {
            const timeStr = formatTime(state.cacheTime);
            el.innerHTML = `报价表: ${timeStr}`;
            el.classList.add('active');
        } else {
            el.innerHTML = `暂无报价数据`;
            el.classList.remove('active');
        }
    }

    function init() {
        addControlPanelStyle();
        loadCachedRates();

        const panel = document.createElement('div');
        panel.className = 'lx-control-panel';
        panel.innerHTML = `
            <div id="lx-cache-info" class="lx-cache-info">读取中...</div>
            <label class="lx-btn lx-btn-success">
                📂 导入报价
                <input type="file" class="lx-file-input" accept=".xlsx, .xls" />
            </label>
            <button class="lx-btn lx-btn-primary" id="lx-gen-report">
                🚀 决策分析
            </button>
        `;

        panel.querySelector('input').addEventListener('change', handleFileUpload);
        panel.querySelector('#lx-gen-report').onclick = openReportInNewTab;
        panel.style.display = 'none';
        document.body.appendChild(panel);

        updateUIStatus();

        setInterval(() => {
            const wrapper = document.querySelector('.sta-delivery-service-wrapper');
            const shouldShow = wrapper && window.location.href.includes('SendToAmazon');
            panel.style.display = shouldShow ? 'flex' : 'none';
        }, 1000);
    }

    init();

})();