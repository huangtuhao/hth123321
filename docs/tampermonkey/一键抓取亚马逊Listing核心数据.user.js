// ==UserScript==
// @name         Amazon Listing Data Extractor (PlentiVive Special)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  一键抓取亚马逊 Listing 核心数据：标题、五点、参数、图片。支持 VEDALIO 等竞品分析。
// @author       Gemini Collaborator
// @match        *://www.amazon.com/dp/*
// @match        *://www.amazon.com/*/dp/*
// @grant        GM_setClipboard
// @grant        GM_addStyle
// ==/UserScript==

(function() {
    'use strict';

    // 1. 样式注入：创建一个专业的悬浮面板
    GM_addStyle(`
        #plenti-extractor {
            position: fixed; top: 100px; right: 20px; z-index: 9999;
            background: #1e1e2d; color: #fff; padding: 15px;
            border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.3);
            font-family: sans-serif; width: 180px; border: 1px solid #444;
        }
        .plenti-btn {
            background: #6366f1; color: white; border: none; padding: 10px;
            width: 100%; border-radius: 6px; cursor: pointer; font-weight: bold;
            transition: background 0.3s;
        }
        .plenti-btn:hover { background: #4f46e5; }
        .plenti-info { font-size: 11px; margin-top: 8px; color: #aaa; line-height: 1.4; }
    `);

    // 2. 创建 UI 元素
    const panel = document.createElement('div');
    panel.id = 'plenti-extractor';
    panel.innerHTML = `
        <div style="font-size: 14px; margin-bottom: 10px; font-weight: bold;">Listing Architect</div>
        <button class="plenti-btn" id="copy-json">复制 JSON 数据</button>
        <div class="plenti-info">包含：标题、五点、Technical Specs、图片 URL。</div>
    `;
    document.body.appendChild(panel);

    // 3. 核心提取逻辑
    function extractData() {
        const data = {};

        // 提取 ASIN
        const asinMatch = window.location.href.match(/\/dp\/([A-Z0-9]{10})/);
        data.asin = asinMatch ? asinMatch[1] : "Unknown";

        // 提取标题
        data.title = document.querySelector('#productTitle')?.innerText.trim() || "";

        // 提取五点描述 (Bullet Points)
        const bulletElements = document.querySelectorAll('#feature-bullets ul li:not(.a-hidden) span.a-list-item');
        data.bullets = Array.from(bulletElements).map(el => el.innerText.trim()).filter(t => t.length > 0);

        // 提取 Technical Details 表格
        const specs = {};
        const specRows = document.querySelectorAll('.prodDetTable tr, #productDetails_techSpec_section_1 tr');
        specRows.forEach(row => {
            const key = row.querySelector('th')?.innerText.trim();
            const val = row.querySelector('td')?.innerText.trim();
            if (key && val) specs[key] = val.replace(/\u200e/g, ""); // 清理特殊字符
        });
        data.tech_specs = specs;

        // 提取主图及附图 URL
        const images = [];
        const thumbElements = document.querySelectorAll('#altImages ul li.a-spacing-small img');
        thumbElements.forEach(img => {
            const url = img.src.replace(/\._AC_.*_\./, '._AC_SL1500_.'); // 转换为高清大图
            if (!images.includes(url)) images.push(url);
        });
        data.image_urls = images;

        return data;
    }

    // 4. 绑定点击事件
    document.getElementById('copy-json').addEventListener('click', () => {
        const listingData = extractData();
        GM_setClipboard(JSON.stringify(listingData, null, 2));
        const btn = document.getElementById('copy-json');
        btn.innerText = '✅ 已复制！';
        btn.style.background = '#10b981';
        setTimeout(() => {
            btn.innerText = '复制 JSON 数据';
            btn.style.background = '#6366f1';
        }, 2000);
    });

})();