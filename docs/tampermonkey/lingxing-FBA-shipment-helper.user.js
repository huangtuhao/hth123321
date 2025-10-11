// ==UserScript==
// @name         Lingxing FBA Shipment Helper
// @namespace    http://tampermonkey.net/
// @version      2.5
// @description  (V2.5) 完美体验版，为结果页的复制操作实现自定义Toast提示，彻底告别alert。
// @author       Your Assistant & You
// @match        *://erp.lingxing.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function() {
    'use strict';

    // --- 用户可配置区域 ---
    const TEMPLATE_SUFFIX = '洛杉矶海卡'; // 请在此处修改您需要的固定后缀
    const SHORT_NAME_STORAGE_KEY = 'LX_ERP_SHORT_NAME_MAP_V2'; // 用于存储简称的数据库键名
    // --- 配置区域结束 ---


    // =================================================================================
    // 样式注入 (CSS for Modals and Button)
    // =================================================================================
    function addGlobalStyle() {
        const css = `
            .lx-helper-btn {
                position: fixed;
                bottom: 40px;
                right: 40px;
                z-index: 9999;
                padding: 12px 20px;
                background-color: #409EFF;
                color: white;
                border: none;
                border-radius: 8px;
                font-size: 16px;
                cursor: pointer;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                transition: all 0.2s ease-in-out;
            }
            .lx-helper-btn:hover {
                background-color: #66b1ff;
                transform: translateY(-2px);
            }
            .lx-modal-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0, 0, 0, 0.6);
                z-index: 10000;
                display: flex;
                justify-content: center;
                align-items: center;
            }
            .lx-modal-content {
                background-color: #fff;
                padding: 25px;
                border-radius: 10px;
                box-shadow: 0 5px 20px rgba(0,0,0,0.2);
                width: 90%;
                max-width: 900px;
                max-height: 90vh;
                display: flex;
                flex-direction: column;
            }
            .lx-modal-header {
                font-size: 22px;
                font-weight: 600;
                color: #303133;
                margin-bottom: 20px;
                padding-bottom: 15px;
                border-bottom: 1px solid #DCDFE6;
            }
            .lx-modal-body {
                overflow-y: auto;
                padding-right: 15px; /* for scrollbar */
            }
            .lx-modal-footer {
                margin-top: 25px;
                padding-top: 15px;
                border-top: 1px solid #DCDFE6;
                display: flex;
                justify-content: flex-end;
            }
            .lx-modal-btn {
                padding: 10px 20px;
                border: none;
                border-radius: 5px;
                cursor: pointer;
                font-size: 14px;
                margin-left: 10px;
            }
            .lx-modal-btn-primary {
                background-color: #409EFF;
                color: white;
            }
            .lx-modal-btn-secondary {
                background-color: #E9E9EB;
                color: #606266;
            }
            .lx-input-table { width: 100%; border-collapse: collapse; }
            .lx-input-table th, .lx-input-table td {
                padding: 12px;
                text-align: left;
                border-bottom: 1px solid #EBEEF5;
            }
            .lx-input-table th { background-color: #FAFAFA; font-weight: 600; }
            .lx-input-table td:first-child { max-width: 350px; word-wrap: break-word; font-size: 12px; color: #606266; }
            .lx-input-table input {
                width: 100%;
                padding: 8px;
                border: 1px solid #DCDFE6;
                border-radius: 4px;
            }
        `;
        const styleNode = document.createElement('style');
        styleNode.type = 'text/css';
        styleNode.appendChild(document.createTextNode(css));
        document.head.appendChild(styleNode);
    }


    // =================================================================================
    // 弹窗与通知模块 (Modal & Notification Module)
    // =================================================================================
    const modal = {
        create(id, title, bodyContent, footerButtons) {
            const existingModal = document.getElementById(id);
            if (existingModal) existingModal.remove();
            const overlay = document.createElement('div');
            overlay.className = 'lx-modal-overlay';
            overlay.id = id;
            const content = document.createElement('div');
            content.className = 'lx-modal-content';
            const header = document.createElement('div');
            header.className = 'lx-modal-header';
            header.innerText = title;
            const body = document.createElement('div');
            body.className = 'lx-modal-body';
            body.innerHTML = bodyContent;
            content.appendChild(header);
            content.appendChild(body);
            if (footerButtons) {
                const footer = document.createElement('div');
                footer.className = 'lx-modal-footer';
                footer.innerHTML = footerButtons;
                content.appendChild(footer);
            }
            overlay.appendChild(content);
            document.body.appendChild(overlay);
            return overlay;
        },
        showLoading() {
            this.create('lx-loading-modal', '正在处理中...', '<div style="text-align:center; padding: 40px 0;">请稍候，正在从服务器获取所有装箱数据...</div>');
        },
        hide(id) {
            const el = document.getElementById(id);
            if (el) el.remove();
        },
        hideLoading() {
            this.hide('lx-loading-modal');
        }
    };

    const notify = {
        _showMessage(type, message) {
            try {
                const vueInstance = document.querySelector('#app')?.__vue__;
                if (vueInstance && vueInstance.$message) {
                    vueInstance.$message[type](message);
                } else {
                    alert(message);
                }
            } catch (e) {
                console.error("Notification system failed, falling back to alert.", e);
                alert(message);
            }
        },
        info(message) { this._showMessage('info', message); },
        warning(message) { this._showMessage('warning', message); },
        error(message) { this._showMessage('error', message); }
    };


    // =================================================================================
    // 核心功能模块 (Core Logic)
    // =================================================================================
    const mainApp = {
        async fetchInitialData() {
            try {
                const vueInstance = document.querySelector('.sta-detail').__vue__;
                if (!vueInstance) throw new Error("无法找到 Vue 实例。");

                if (!vueInstance.info) {
                    await vueInstance.getDetail(new URLSearchParams(window.location.search).get('localTaskId'));
                }

                const globalInfo = vueInstance.info;
                const shipmentList = document.querySelector('#pane-3 .info-container')?.__vue__?.shipmentList;

                if (!globalInfo || !shipmentList) {
                    throw new Error("无法获取 globalInfo 或 shipmentList，可能未切换到第三步。");
                }
                return { vueInstance, globalInfo, shipmentList };
            } catch (e) {
                console.error('获取页面初始数据失败:', e);
                notify.error('请确认已经切换到第3步："配送服务"，如果未切换，请点击头部"配送服务"文字进行切换');
                return null;
            }
        },

        async fetchPackingDetails(vueInstance, shipment) {
            try {
                const { code, msg, data } = await vueInstance.$gwPost("/amz-sta-server/inbound-packing/getShipmentPackingDetail", {
                    shipmentId: shipment.shipmentId,
                    inboundPlanId: shipment.inboundPlanId,
                    sid: shipment.sid
                });
                if (code === 1 && data) {
                    return data.shipmentPackingVOS || [];
                } else {
                    throw new Error(`货件 ${shipment.shipmentId} 的装箱数据请求失败: ${msg || '未知错误'}`);
                }
            } catch (error) {
                 console.error(`调用 $gwPost 失败 for ${shipment.shipmentId}:`, error);
                 throw error;
            }
        },

        async handleShortNames(initialData) {
            let shortNameMap = await GM_getValue(SHORT_NAME_STORAGE_KEY, {});
            const productList = initialData.shipmentList?.[0]?.itemList || [];

            if (productList.length === 0) {
                notify.warning("当前计划中未找到任何商品。");
                return;
            }

            let tableRows = '';
            productList.forEach(product => {
                const { sku, productName } = product;
                const defaultValue = shortNameMap[sku] || productName;
                tableRows += `
                    <tr>
                        <td><b>SKU:</b> ${sku}<br>${productName}</td>
                        <td><input type="text" data-sku="${sku}" value="${defaultValue.replace(/"/g, '&quot;')}"></td>
                    </tr>`;
            });

            const body = `<p style="margin-bottom: 15px; color: #909399;">请检查或修改以下商品的简称。系统会默认填入您上次保存的简称或完整品名。</p>
                          <table class="lx-input-table">
                            <thead><tr><th>商品信息</th><th>简称</th></tr></thead>
                            <tbody>${tableRows}</tbody>
                          </table>`;
            const footer = `<button id="lx-cancel-btn" class="lx-modal-btn lx-modal-btn-secondary">取消</button>
                            <button id="lx-save-btn" class="lx-modal-btn lx-modal-btn-primary">保存并生成结果</button>`;
            const inputModal = modal.create('lx-shortname-modal', '编辑商品简称', body, footer);

            document.getElementById('lx-cancel-btn').onclick = () => modal.hide('lx-shortname-modal');

            document.getElementById('lx-save-btn').onclick = async () => {
                let updatedShortNameMap = {};
                inputModal.querySelectorAll('input[data-sku]').forEach(input => {
                    const sku = input.dataset.sku;
                    const shortName = input.value.trim();
                    if (shortName) {
                        updatedShortNameMap[sku] = shortName;
                    }
                });
                await GM_setValue(SHORT_NAME_STORAGE_KEY, updatedShortNameMap);
                modal.hide('lx-shortname-modal');

                modal.showLoading();
                try {
                    const packingPromises = initialData.shipmentList.map(s => this.fetchPackingDetails(initialData.vueInstance, s));
                    const allPackingDetails = await Promise.all(packingPromises);
                    this.generateFinalOutput(initialData, allPackingDetails, updatedShortNameMap);
                } catch (error) {
                    notify.error("处理失败: " + error.message);
                } finally {
                    modal.hideLoading();
                }
            };
        },

        generateFinalOutput(initialData, allPackingDetails, shortNameMap) {
            const { globalInfo, shipmentList } = initialData;
            let shipmentNamesArray = [];
            let packingDetailsOutput = '';
            shipmentList.forEach((shipment, index) => {
                const packingVos = allPackingDetails[index];
                if (!packingVos || packingVos.length === 0) return;
                const aggregatedBoxCounts = new Map();
                packingVos.forEach(box => {
                    if (!aggregatedBoxCounts.has(box.sku)) {
                        aggregatedBoxCounts.set(box.sku, { count: 0 });
                    }
                    aggregatedBoxCounts.get(box.sku).count += 1;
                });
                const contentSummary = Array.from(aggregatedBoxCounts.entries())
                    .map(([sku, data]) => {
                        const shortName = shortNameMap[sku] || sku;
                        return `${shortName}${data.count}箱`;
                    })
                    .join(' ');
                const shopName = globalInfo.sellerName.replace(/-[A-Z]{2,}(\s*-\s*\S+)?$/, '').trim();
                const creatorName = globalInfo.createByName || document.querySelector('#app')?.__vue__?.$store?.state?.userName;
                const date = new Date().toLocaleDateString('zh-CN', { year: '2-digit', month: '2-digit', day: '2-digit' }).replace(/\//g, '');
                const destination = shipment.warehouseId;
                const confirmationId = shipment.shipmentConfirmationId;
                const singleShipmentName = `${shopName}-${creatorName}-${date}-${contentSummary}-${destination}-${confirmationId}-${TEMPLATE_SUFFIX}`;
                shipmentNamesArray.push(singleShipmentName);
                packingDetailsOutput += `${destination}-${confirmationId}-${TEMPLATE_SUFFIX}\n`;
                let currentGroup = null;
                packingVos.forEach((box, boxIndex) => {
                    const boxNum = parseInt(box.boxId.match(/U(\d+)$/)[1]);
                    if (!currentGroup) {
                        currentGroup = { sku: box.sku, start: boxNum, end: boxNum };
                    } else if (box.sku === currentGroup.sku) {
                        currentGroup.end = boxNum;
                    } else {
                        const shortName = shortNameMap[currentGroup.sku] || currentGroup.sku;
                        packingDetailsOutput += `${currentGroup.start}-${currentGroup.end}：${shortName}\n`;
                        currentGroup = { sku: box.sku, start: boxNum, end: boxNum };
                    }
                    if (boxIndex === packingVos.length - 1) {
                         const shortName = shortNameMap[currentGroup.sku] || currentGroup.sku;
                         packingDetailsOutput += `${currentGroup.start}-${currentGroup.end}：${shortName}\n`;
                    }
                });
                 packingDetailsOutput += `\n`;
            });
            this.showResultsInNewTab(shipmentNamesArray, packingDetailsOutput.trim());
        },

        // 修改点：为结果页注入Toast通知的CSS和JS
        showResultsInNewTab(namesArray, details) {
            let namesHtml = '';
            if (namesArray.length > 0) {
                namesArray.forEach((name, index) => {
                    namesHtml += `
                        <div class="input-group">
                            <input type="text" id="shipment-name-${index}" value="${name.replace(/"/g, '&quot;')}">
                            <button class="btn-copy" onclick="copyText('shipment-name-${index}')">复制</button>
                        </div>
                    `;
                });
            } else {
                namesHtml = '<p>没有找到有效的货件命名。</p>';
            }
            const newTab = window.open('', '_blank');
            newTab.document.write(`
                <!DOCTYPE html>
                <html lang="zh-CN">
                <head>
                    <meta charset="UTF-8">
                    <title>生成结果</title>
                    <style>
                        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; background-color: #f4f5f7; margin: 0; padding: 20px; }
                        .container { max-width: 1200px; margin: 0 auto; background-color: #fff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
                        h1 { font-size: 24px; color: #333; border-bottom: 1px solid #eee; padding-bottom: 15px; margin-top: 0; }
                        h2 { font-size: 18px; color: #555; margin-top: 30px; }
                        textarea, input[type="text"] { width: 100%; padding: 10px; border: 1px solid #dcdfe6; border-radius: 4px; font-family: monospace; font-size: 14px; line-height: 1.6; box-sizing: border-box; }
                        textarea { resize: vertical; }
                        button { padding: 10px 15px; font-size: 14px; cursor: pointer; border-radius: 4px; border: 1px solid transparent; }
                        .btn-copy { background-color: #409eff; color: white; border-color: #409eff; }
                        .input-group { display: flex; align-items: center; margin-bottom: 10px; }
                        .input-group input { flex-grow: 1; border-top-right-radius: 0; border-bottom-right-radius: 0; }
                        .input-group button { margin-left: -1px; border-top-left-radius: 0; border-bottom-left-radius: 0; }
                        #output-details { min-height: 600px; }
                        
                        /* Toast CSS */
                        .toast-notification {
                            position: fixed;
                            top: 20px;
                            left: 50%;
                            transform: translateX(-50%);
                            background-color: #007aff;
                            color: white;
                            padding: 12px 24px;
                            border-radius: 8px;
                            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                            z-index: 10000;
                            opacity: 0;
                            transition: opacity 0.4s ease, top 0.4s ease;
                            font-size: 14px;
                        }
                        .toast-notification.show {
                            top: 40px;
                            opacity: 1;
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1>生成结果</h1>
                        <h2>货件命名字符串</h2>
                        <div id="shipment-names-container">
                            ${namesHtml}
                        </div>
                        <h2>箱唛详情</h2>
                        <textarea id="output-details">${details}</textarea>
                        <button class="btn-copy" onclick="copyText('output-details')">复制箱唛详情</button>
                    </div>
                    <script>
                        let toastTimer;
                        function showToast(message) {
                            // 清除上一个toast（如果存在）
                            const existingToast = document.querySelector('.toast-notification');
                            if (existingToast) {
                                existingToast.remove();
                                clearTimeout(toastTimer);
                            }

                            const toast = document.createElement('div');
                            toast.className = 'toast-notification';
                            toast.textContent = message;
                            document.body.appendChild(toast);

                            // 触发显示动画
                            setTimeout(() => {
                                toast.classList.add('show');
                            }, 10); // 短暂延迟确保transition生效

                            // 2秒后自动隐藏
                            toastTimer = setTimeout(() => {
                                toast.classList.remove('show');
                                // 动画结束后从DOM中移除
                                setTimeout(() => {
                                    if (toast.parentNode) {
                                        toast.parentNode.removeChild(toast);
                                    }
                                }, 500);
                            }, 2000);
                        }

                        function copyText(elementId) {
                            const element = document.getElementById(elementId);
                            element.select();
                            document.execCommand('copy');
                            // 调用新的toast函数替代alert
                            showToast('已复制到剪贴板！');
                        }
                    <\/script>
                </body>
                </html>
            `);
            newTab.document.close();
        },

        async run() {
            modal.showLoading();
            try {
                const initialData = await this.fetchInitialData();
                modal.hideLoading();

                if (initialData) {
                    await this.handleShortNames(initialData);
                }
            } catch (error) {
                modal.hideLoading();
                console.error("主流程启动失败:", error);
            }
        }
    };


    // =================================================================================
    // 脚本初始化 (Initialization)
    // =================================================================================
    function init() {
        addGlobalStyle();

        console.log('一键生成箱唛信息');

        const mainButton = document.createElement('button');
        mainButton.innerText = '一键生成箱唛信息';
        mainButton.id = 'lx-main-btn';
        mainButton.className = 'lx-helper-btn';
        mainButton.style.display = 'none';
        mainButton.onclick = () => mainApp.run();
        document.body.appendChild(mainButton);

        const isTargetPage = () => {
            const currentUrl = window.location.href;
            return ['/erp/msupply/SendToAmazonDetail', '/erp/msupply/AddSendToAmazon', '/erp/msupply/editSendToAmazon'].some(v => currentUrl.includes(v));
        };

        const toggleButtonVisibility = () => {
            if (isTargetPage()) {
                mainButton.style.display = 'block';
            } else {
                mainButton.style.display = 'none';
            }
        };

        const originalPushState = history.pushState;
        history.pushState = function(...args) {
            const result = originalPushState.apply(this, args);
            window.dispatchEvent(new Event('urlchange'));
            return result;
        };

        window.addEventListener('urlchange', toggleButtonVisibility);
        window.addEventListener('popstate', toggleButtonVisibility);

        toggleButtonVisibility();
    }

    init();

})();