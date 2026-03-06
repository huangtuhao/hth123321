// ==UserScript==
// @name         Amazon Review Scraper - Stealth Pro
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  优化版：模拟真人行为，增加随机延迟、长时休息及进度保存功能，降低封号风险。
// @author       Gemini Optimizer
// @match        https://www.amazon.com/*
// @match        https://www.amazon.co.jp/*
// @match        https://www.amazon.de/*
// @match        https://www.amazon.co.uk/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function() {
    'use strict';

    // ================= 1. 安全配置 (Stealth Config) =================
    const CONFIG = {
        minDelay: 4000,       // 最小延迟 4秒
        maxDelay: 9000,       // 最大延迟 9秒
        breakEvery: 6,        // 每爬取 X 页进行一次大休息
        breakDuration: 25000, // 大休息持续时间 (25秒左右)
        maxRetry: 3,          // 失败重试次数
    };

    let state = {
        isRunning: false,
        isPaused: false,
        asinList: [],
        currentAsinIndex: 0,
        currentPage: 1,
        results: [],
        pageCounter: 0 // 用于计算大休息
    };

    // ================= 2. UI 增强 =================
    function createUI() {
        if (document.getElementById('amz-scraper-panel')) return;
        const div = document.createElement('div');
        div.id = 'amz-scraper-panel';
        div.innerHTML = `
            <div style="background: #131921; color: #ff9900; padding: 12px; border-radius: 8px 8px 0 0; font-weight: bold; display: flex; justify-content: space-between;">
                <span>Amazon Scraper (Stealth Mode)</span>
                <span id="amz-close-btn" style="cursor: pointer;">×</span>
            </div>
            <div style="padding: 15px; display: flex; flex-direction: column; gap: 10px;">
                <textarea id="amz-asin-input" rows="4" placeholder="输入ASIN，每行一个" style="width:100%; font-size:12px;"></textarea>
                <div>
                    <label style="font-size:12px;">目标评论数/ASIN:</label>
                    <input type="number" id="amz-limit-input" value="100" style="width: 60px;">
                </div>
                <div id="amz-status-area" style="height: 150px; background: #f3f3f3; font-family: monospace; font-size: 11px; overflow-y: auto; padding: 5px; border: 1px solid #ddd;"></div>
                <div style="display: flex; gap: 5px;">
                    <button id="amz-start-btn" style="flex: 2; background: #ffd814; border: 1px solid #fcd200; border-radius: 5px; padding: 8px; cursor: pointer;">开始执行</button>
                    <button id="amz-clear-btn" style="flex: 1; background: #fff; border: 1px solid #adb1b8; border-radius: 5px; cursor: pointer;">清空缓存</button>
                </div>
                <button id="amz-export-btn" style="width: 100%; padding: 8px; background: #232f3e; color: white; border-radius: 5px; cursor: pointer;">导出 CSV</button>
                <button id="amz-resume-btn" style="display: none; background: #007185; color: white; padding: 10px; border: none; border-radius: 5px; cursor: pointer;">检测到正常，点击继续</button>
            </div>
        `;

        GM_addStyle(`
            #amz-scraper-panel { position: fixed; top: 70px; right: 20px; width: 320px; background: white; border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.3); z-index: 99999; font-family: 'Amazon Ember', Arial; }
            .log-item { border-bottom: 1px solid #eee; padding: 2px 0; }
            .log-warn { color: #c45500; font-weight: bold; }
        `);

        document.body.appendChild(div);
        document.getElementById('amz-start-btn').onclick = startTask;
        document.getElementById('amz-export-btn').onclick = exportToCSV;
        document.getElementById('amz-clear-btn').onclick = clearCache;
        document.getElementById('amz-close-btn').onclick = () => div.style.display = 'none';
        document.getElementById('amz-resume-btn').onclick = resumeTask;

        // 初始化加载缓存
        loadProgress();
    }

    // ================= 3. 核心行为优化 =================

    async function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // 增加随机波动
    function getRandomDelay() {
        return Math.floor(Math.random() * (CONFIG.maxDelay - CONFIG.minDelay)) + CONFIG.minDelay;
    }

    async function requestWithRetry(url, retries = 0) {
        try {
            // 模拟 Referer
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Cache-Control': 'no-cache'
                }
            });

            if (response.status === 403 || response.status === 503) {
                log("访问被拒 (403/503)，可能遭遇验证码或限流", "log-warn");
                return { status: 'blocked' };
            }
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const text = await response.text();
            if (text.includes("sp-cc-container") || text.includes("captcha")) {
                return { status: 'blocked' };
            }

            return { status: 'ok', data: text };
        } catch (e) {
            if (retries < CONFIG.maxRetry) {
                log(`请求失败，${retries + 1}次重试中...`);
                await sleep(5000);
                return requestWithRetry(url, retries + 1);
            }
            return { status: 'error', message: e.message };
        }
    }

    async function processLoop() {
        if (!state.isRunning || state.isPaused) return;

        if (state.currentAsinIndex >= state.asinList.length) {
            log("🎉 所有任务已完成！");
            state.isRunning = false;
            saveProgress();
            return;
        }

        const asin = state.asinList[state.currentAsinIndex];
        const target = parseInt(document.getElementById('amz-limit-input').value) || 100;

        // 检查当前 ASIN 是否已爬够
        const currentAsinResults = state.results.filter(r => r.ASIN === asin);
        if (currentAsinResults.length >= target) {
            log(`ASIN ${asin} 已达到目标数量，跳过.`);
            state.currentAsinIndex++;
            state.currentPage = 1;
            saveProgress();
            await sleep(getRandomDelay());
            processLoop();
            return;
        }

        // 模拟大休息机制
        state.pageCounter++;
        if (state.pageCounter % CONFIG.breakEvery === 0) {
            const extraWait = CONFIG.breakDuration + Math.random() * 10000;
            log(`☕ 为了安全，触发长时休息：${Math.round(extraWait/1000)}秒...`, "log-warn");
            await sleep(extraWait);
        }

        // 执行请求
        const url = `${window.location.origin}/product-reviews/${asin}/?reviewerType=all_reviews&sortBy=recent&pageNumber=${state.currentPage}`;
        log(`正在请求: ASIN ${asin} | 第 ${state.currentPage} 页`);

        const result = await requestWithRetry(url);

        if (result.status === 'blocked') {
            handleCaptcha(url);
            return;
        }

        if (result.status === 'ok') {
            const parser = new DOMParser();
            const doc = parser.parseFromString(result.data, 'text/html');
            const reviews = parseReviews(doc, asin);

            if (reviews.length === 0) {
                log(`ASIN ${asin} 已无更多评论。`);
                state.currentAsinIndex++;
                state.currentPage = 1;
            } else {
                state.results.push(...reviews);
                state.currentPage++;
                log(`✅ 成功获取 ${reviews.length} 条评论 (累计: ${state.results.length})`);
            }

            saveProgress();
            await sleep(getRandomDelay());
            processLoop();
        } else {
            log(`❌ 无法处理 URL: ${result.message}`, "log-warn");
        }
    }

    // ================= 4. 数据解析与存储 =================

    function parseReviews(doc, asin) {
        const list = [];
        const blocks = doc.querySelectorAll('[data-hook="review"]');
        blocks.forEach(block => {
            try {
                list.push({
                    ASIN: asin,
                    Date: block.querySelector('[data-hook="review-date"]')?.innerText.trim() || '',
                    Rating: block.querySelector('[data-hook="review-star-rating"]')?.innerText.split(' ')[0] || '',
                    Title: block.querySelector('[data-hook="review-title"]')?.innerText.trim() || '',
                    Body: block.querySelector('[data-hook="review-body"]')?.innerText.trim().slice(0, 500) || '',
                });
            } catch (e) {}
        });
        return list;
    }

    function saveProgress() {
        GM_setValue('amz_scraper_state', JSON.stringify({
            asinList: state.asinList,
            currentAsinIndex: state.currentAsinIndex,
            currentPage: state.currentPage,
            results: state.results
        }));
    }

    function loadProgress() {
        const saved = GM_getValue('amz_scraper_state');
        if (saved) {
            const parsed = JSON.parse(saved);
            state.asinList = parsed.asinList || [];
            state.currentAsinIndex = parsed.currentAsinIndex || 0;
            state.currentPage = parsed.currentPage || 1;
            state.results = parsed.results || [];
            document.getElementById('amz-asin-input').value = state.asinList.join('\n');
            log(`恢复进度: 已保存 ${state.results.length} 条数据。`);
        }
    }

    function clearCache() {
        if(confirm("确定要清空所有已爬取的数据和进度吗？")) {
            GM_setValue('amz_scraper_state', null);
            state.results = [];
            state.currentAsinIndex = 0;
            state.currentPage = 1;
            log("缓存已清空。");
        }
    }

    // ================= 5. 控制逻辑 =================

    function startTask() {
        const input = document.getElementById('amz-asin-input').value;
        state.asinList = input.split('\n').map(s => s.trim()).filter(s => s.length > 5);
        if (state.asinList.length === 0) return alert("请输入有效的 ASIN");

        state.isRunning = true;
        document.getElementById('amz-start-btn').innerText = "正在运行...";
        document.getElementById('amz-start-btn').disabled = true;
        processLoop();
    }

    function handleCaptcha(url) {
        state.isPaused = true;
        log("⚠️ 遇到验证码或频率限制！请在弹出的新窗口中手动验证。", "log-warn");
        document.getElementById('amz-resume-btn').style.display = 'block';
        window.open(url, '_blank');
    }

    function resumeTask() {
        state.isPaused = false;
        document.getElementById('amz-resume-btn').style.display = 'none';
        log("▶️ 尝试继续运行...");
        processLoop();
    }

    function log(msg, className = "") {
        const area = document.getElementById('amz-status-area');
        const d = new Date();
        const time = `${d.getHours()}:${d.getMinutes()}:${d.getSeconds()}`;
        area.innerHTML += `<div class="log-item ${className}">[${time}] ${msg}</div>`;
        area.scrollTop = area.scrollHeight;
    }

    function exportToCSV() {
        if (state.results.length === 0) return alert("没有数据可导出");
        const headers = ["ASIN", "Date", "Rating", "Title", "Body"];
        let csv = "\uFEFF" + headers.join(",") + "\n";
        state.results.forEach(r => {
            csv += headers.map(h => `"${(r[h] || '').replace(/"/g, '""')}"`).join(",") + "\n";
        });
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `amazon_reviews_${new Date().getTime()}.csv`;
        a.click();
    }

    // 初始化按钮
    (function init() {
        const btn = document.createElement('div');
        btn.innerText = 'Scraper';
        btn.style.cssText = `position: fixed; bottom: 20px; right: 20px; background: #232f3e; color: #ff9900; padding: 10px; border-radius: 50%; cursor: pointer; z-index: 99999; font-size: 10px; font-weight: bold; border: 2px solid #ff9900;`;
        btn.onclick = createUI;
        document.body.appendChild(btn);
    })();

})();