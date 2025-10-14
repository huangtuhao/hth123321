// ==UserScript==
// @name         领星ERP-FBA清关发票生成助手
// @namespace    http://tampermonkey.net/
// @version      3.3
// @description  (V3.3) 图片控制符！引入{{@...}}语法，允许模板自由指定任意URL字段为图片，彻底解耦图片属性名，极大提升模板灵活性。
// @author       Your Assistant & User
// @match        *://erp.lingxing.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      *
// @require      https://cdn.jsdelivr.net/npm/exceljs@4.3.0/dist/exceljs.min.js
// ==/UserScript==

(function() {
    'use strict';

    // --- 配置区域 ---
    const CONFIG = {
        STORAGE_KEY: 'LX_INVOICE_HELPER_DATA_V1',
        TEMPLATE_STORAGE_KEY: 'LX_INVOICE_TEMPLATE_V3_3', // 更新版本号
    };

    // --- UI与通知模块 (保持不变) ---
    function addGlobalStyle() { const css = ` .lx-invoice-helper-btn, .lx-invoice-upload-btn { position: fixed; right: 40px; z-index: 9999; padding: 12px 20px; color: white; border: none; border-radius: 8px; font-size: 16px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.15); transition: all 0.2s ease-in-out; } .lx-invoice-helper-btn { bottom: 100px; background-color: #67C23A; } .lx-invoice-upload-btn { bottom: 165px; background-color: #409EFF; } .lx-invoice-helper-btn:hover { background-color: #85ce61; transform: translateY(-2px); } .lx-invoice-upload-btn:hover { background-color: #66b1ff; transform: translateY(-2px); } .lx-invoice-modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.6); z-index: 10000; display: flex; justify-content: center; align-items: center; } .lx-invoice-modal-content { background-color: #fff; padding: 25px; border-radius: 10px; box-shadow: 0 5px 20px rgba(0,0,0,0.2); width: 95%; max-width: 1200px; max-height: 90vh; display: flex; flex-direction: column; } .lx-invoice-modal-header { font-size: 22px; font-weight: 600; color: #303133; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px solid #DCDFE6; } .lx-invoice-modal-body { overflow-y: auto; padding-right: 15px; } .lx-invoice-modal-footer { margin-top: 25px; padding-top: 15px; border-top: 1px solid #DCDFE6; display: flex; justify-content: flex-end; } .lx-invoice-modal-btn { padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; font-size: 14px; margin-left: 10px; } .lx-invoice-modal-btn-primary { background-color: #67C23A; color: white; } .lx-invoice-modal-btn-secondary { background-color: #E9E9EB; color: #606266; } .lx-invoice-input-table { width: 100%; border-collapse: collapse; font-size: 12px; } .lx-invoice-input-table th, .lx-invoice-input-table td { padding: 8px; text-align: left; border: 1px solid #EBEEF5; vertical-align: middle; } .lx-invoice-input-table thead th { background-color: #FAFAFA; font-weight: 600; position: sticky; top: -1px; z-index: 1; } .lx-invoice-input-table input[type="text"], .lx-invoice-input-table input[type="number"] { width: 100%; padding: 6px; border: 1px solid #DCDFE6; border-radius: 4px; box-sizing: border-box; font-size: 12px; } .lx-shipment-list { list-style: none; padding: 0; margin: 0; } .lx-shipment-list li { padding: 10px; border-bottom: 1px solid #eee; } .lx-shipment-list label { display: flex; align-items: center; cursor: pointer; } .lx-shipment-list input { margin-right: 10px; } `; const styleNode = document.createElement('style'); styleNode.appendChild(document.createTextNode(css)); document.head.appendChild(styleNode); }
    const modal = { create(id, title, bodyContent, footerButtons) { this.hide(id); const overlay = document.createElement('div'); overlay.className = 'lx-invoice-modal-overlay'; overlay.id = id; overlay.innerHTML = `<div class="lx-invoice-modal-content"><div class="lx-invoice-modal-header">${title}</div><div class="lx-invoice-modal-body">${bodyContent}</div>${footerButtons ? `<div class="lx-invoice-modal-footer">${footerButtons}</div>` : ''}</div>`; document.body.appendChild(overlay); overlay.querySelector('.lx-invoice-modal-content').addEventListener('click', e => e.stopPropagation()); return overlay; }, hide(id) { const el = document.getElementById(id); if (el) el.remove(); }, showLoading(message = '请稍候...') { this.create('lx-invoice-loading-modal', '处理中', `<div style="text-align:center; padding: 40px 0;">${message}</div>`); }, hideLoading() { this.hide('lx-invoice-loading-modal'); } };
    const notify = { _showMessage(type, message) { try { const vueInstance = document.querySelector('#app')?.__vue__; if (vueInstance && vueInstance.$message) { vueInstance.$message[type](message); } else { alert(message); } } catch (e) { console.error("Notification system failed, falling back to alert.", e); alert(message); } }, success(message) { this._showMessage('success', message); }, error(message) { this._showMessage('error', message); } };

    // --- 模板引擎辅助函数 (保持不变) ---
    const templateHelpers = {
        runPreprocessor(scriptContent, rawContext) { return new Promise((resolve, reject) => { if (!scriptContent || typeof scriptContent !== 'string' || !scriptContent.trim().startsWith('// js-script')) { resolve(rawContext); return; } try { const processor = new Function('context', `${scriptContent}\nreturn context;`); const result = processor(JSON.parse(JSON.stringify(rawContext))); resolve(result); } catch (error) { reject(new Error(`A1预处理脚本执行失败: ${error.message}`)); } }); },
        getProperty(obj, path) { if (typeof path !== 'string') return obj ? obj[path] : undefined; return path.split('.').reduce((o, k) => (o || {})[k], obj); },
        evaluateInScope(expression, scope) { const scopeKeys = Object.keys(scope); const scopeValues = Object.values(scope); try { const evaluator = new Function(...scopeKeys, `'use strict'; return (${expression});`); return evaluator(...scopeValues); } catch (e) { console.error(`表达式求值失败: "${expression}"`, e); return `[EVAL_ERROR]`; } },
        evaluateExpression(expr, scope) { if (typeof expr !== 'string' || !expr.includes('{{')) return expr; const singleExprMatch = expr.trim().match(/^{{(.*)}}$/); if (singleExprMatch) { return this.evaluateInScope(singleExprMatch[1].trim(), scope); } return expr.replace(/{{(.*?)}}/g, (match, expression) => { const value = this.evaluateInScope(expression.trim(), scope); return value === null || value === undefined ? '' : value; }); }
    };

    // =================================================================================
    // 核心功能模块 (Core Logic)
    // =================================================================================
    const mainApp = {
        // --- fetch... and showConfirmationModal functions remain the same ---
        async fetchPageData() { try { const vueInstance = document.querySelector('.sta-detail').__vue__; if (!vueInstance) throw new Error("无法找到 Vue 实例。"); const localTaskId = new URLSearchParams(window.location.search).get('localTaskId'); if (localTaskId && !vueInstance.info) { await vueInstance.getDetail(localTaskId); } const globalInfo = vueInstance.info; const shipmentList = document.querySelector('#pane-3 .info-container')?.__vue__?.shipmentList; if (!globalInfo || !shipmentList || shipmentList.length === 0) { throw new Error("无法获取发货计划信息或货件列表，请确认已切换到第3步“配送服务”。"); } return { globalInfo, shipmentList, vueInstance }; } catch (e) { console.error('获取页面初始数据失败:', e); notify.error(e.message); return null; } },
        selectShipment(shipmentList) { return new Promise((resolve) => { let listHtml = '<ul class="lx-shipment-list">'; shipmentList.forEach((shipment, index) => { listHtml += `<li><label><input type="checkbox" name="shipment-checkbox" value="${index}"><div><strong>${shipment.shipmentConfirmationId}</strong> (${shipment.warehouseId})<br><small>SKU数量: ${shipment.mskuCount}, 总箱数: ${shipment.boxQuantity}</small></div></label></li>`; }); listHtml += '</ul>'; const footer = `<button id="lx-invoice-cancel-btn" class="lx-invoice-modal-btn lx-invoice-modal-btn-secondary">取消</button><button id="lx-invoice-confirm-btn" class="lx-invoice-modal-btn lx-invoice-modal-btn-primary">下一步</button>`; const selectionModal = modal.create('lx-invoice-selection-modal', '选择要生成发票的货件', listHtml, footer); document.getElementById('lx-invoice-cancel-btn').onclick = () => { modal.hide('lx-invoice-selection-modal'); resolve(null); }; document.getElementById('lx-invoice-confirm-btn').onclick = () => { const selectedIndexes = Array.from(selectionModal.querySelectorAll('input[name="shipment-checkbox"]:checked')).map(cb => parseInt(cb.value)); if (selectedIndexes.length === 0) { notify.error('请至少选择一个货件！'); return; } const selectedShipments = selectedIndexes.map(i => shipmentList[i]); modal.hide('lx-invoice-selection-modal'); resolve(selectedShipments); }; }); },
        async fetchProductDetails(globalInfo, vueInstance) { if (!vueInstance?.$gateAxios) { throw new Error("无法找到页面的HTTP请求客户端(vueInstance.$gateAxios)。"); } const productItems = globalInfo.inboundPlanItemVOS || []; if (productItems.length === 0) return new Map(); const promises = productItems.map(async (item, index) => { const sequenceNumber = index + 1; const reqTimeSequence = encodeURIComponent(`/api/product/info$$${sequenceNumber}`); const url = `/api/product/info?id=${item.productId}&req_time_sequence=${reqTimeSequence}`; try { const response = await vueInstance.$gateAxios.get(url); const data = response.data; if (data.code === 1 && data.info) { return { productId: item.productId, details: data.info }; } else { console.warn(`获取产品 ${item.sku} (ID: ${item.productId}) 详情失败: ${data.msg}`); return { productId: item.productId, details: null }; } } catch (error) { console.error(`请求产品 ${item.sku} (ID: ${item.productId}) 数据时发生网络错误:`, error); return { productId: item.productId, details: null }; } }); const results = await Promise.all(promises); const productDetailsMap = new Map(); results.forEach(result => { if (result && result.details) { productDetailsMap.set(result.productId, result.details); } }); return productDetailsMap; },
        async showConfirmationModal(selectedShipments, globalInfo, productDetailsMap, vueInstance) {
            const savedData = await GM_getValue(CONFIG.STORAGE_KEY, {});
            let tableRowsHtml = '';
            const allInvoiceItems = [];
            selectedShipments.forEach(shipment => {
                shipment.itemList.forEach(itemInShipment => {
                    const planItem = globalInfo.inboundPlanItemVOS.find(p => p.sku === itemInShipment.sku);
                    if (!planItem) return;
                    const productDetail = productDetailsMap.get(planItem.productId) || {};
                    const savedItemData = savedData[planItem.sku] || {};
                    const boxCount = Math.round(itemInShipment.quantity / planItem.quantityInBox);
                    if (boxCount === 0) return;
                    
                    const invoiceItem = {
                        shipment: shipment, planItem: planItem, fbaId: shipment.shipmentConfirmationId, refId: shipment.amazonReferenceId, boxCount: boxCount, grossWeightPerBox: planItem.weight, pcsPerBox: planItem.quantityInBox, productWeight: (planItem.weight / planItem.quantityInBox).toFixed(4),
                        product: productDetail, declaration: productDetail.product_declaration_list || {}, clearance: productDetail.product_clearance_list || {},
                    };

                    Object.assign(invoiceItem, {
                        nameCn: productDetail.bg_customs_export_name || planItem.productName,
                        hscode: savedItemData.hscode || invoiceItem.clearance.customs_clearance_hs_code || invoiceItem.declaration.customs_declaration_hs_code || productDetail.bg_export_hs_code || '',
                        price: savedItemData.price || invoiceItem.clearance.customs_clearance_price || invoiceItem.declaration.customs_import_price || productDetail.bg_customs_import_price || '0.00',
                        material: savedItemData.material || invoiceItem.clearance.customs_clearance_material || productDetail.cg_product_material || '',
                        usage: savedItemData.usage || invoiceItem.clearance.customs_clearance_usage || '',
                        brand: savedItemData.brand || productDetail.brand_name || '',
                        model: savedItemData.model || productDetail.model || planItem.sku,
                    });
                    
                    allInvoiceItems.push(invoiceItem);
                });
            });

            allInvoiceItems.forEach((item, index) => {
                tableRowsHtml += `<tr data-index="${index}"><td title="${item.fbaId}">${item.fbaId.slice(0,15)}...</td><td>${item.planItem.sku}</td><td>${item.nameCn}</td><td><input type="text" value="${item.hscode}" data-field="hscode"></td><td><input type="number" step="0.01" value="${item.price}" data-field="price"></td><td><input type="text" value="${item.material}" data-field="material"></td><td><input type="text" value="${item.usage}" data-field="usage"></td><td><input type="text" value="${item.brand}" data-field="brand"></td><td><input type="text" value="${item.model}" data-field="model"></td></tr>`;
            });
            const tableHtml = `<p style="margin-bottom: 15px; color: #909399;">请检查或补充以下报关信息...</p><div style="max-height: 50vh; overflow: auto;"><table class="lx-invoice-input-table"><thead><tr><th>FBA编号</th><th>SKU</th><th>中文品名</th><th>HSCODE</th><th>单价(USD)</th><th>材质</th><th>用途</th><th>品牌</th><th>规格型号</th></tr></thead><tbody>${tableRowsHtml}</tbody></table></div>`;

            return new Promise(resolve => {
                const footer = `<button id="lx-invoice-cancel-final-btn" class="lx-invoice-modal-btn lx-invoice-modal-btn-secondary">取消</button><button id="lx-invoice-generate-btn" class="lx-invoice-modal-btn lx-invoice-modal-btn-primary">保存并生成文件</button>`;
                const confirmModal = modal.create('lx-invoice-confirm-modal', '确认报关信息', tableHtml, footer);
                document.getElementById('lx-invoice-cancel-final-btn').onclick = () => { modal.hide('lx-invoice-confirm-modal'); resolve(null); };
                document.getElementById('lx-invoice-generate-btn').onclick = async () => {
                    const newSavedData = await GM_getValue(CONFIG.STORAGE_KEY, {});
                    confirmModal.querySelectorAll('tbody tr').forEach(tr => {
                        const index = parseInt(tr.dataset.index);
                        const sku = allInvoiceItems[index].planItem.sku;
                        const hscode = tr.querySelector('[data-field="hscode"]').value.trim();
                        const price = tr.querySelector('[data-field="price"]').value.trim();
                        const material = tr.querySelector('[data-field="material"]').value.trim();
                        const usage = tr.querySelector('[data-field="usage"]').value.trim();
                        const brand = tr.querySelector('[data-field="brand"]').value.trim();
                        const model = tr.querySelector('[data-field="model"]').value.trim();
                        Object.assign(allInvoiceItems[index], { hscode, price, material, usage, brand, model });
                        if (!newSavedData[sku]) newSavedData[sku] = {};
                        Object.assign(newSavedData[sku], { hscode, price, material, usage, brand, model });
                    });
                    await GM_setValue(CONFIG.STORAGE_KEY, newSavedData);
                    modal.hide('lx-invoice-confirm-modal');
                    resolve({ skuItems: allInvoiceItems, globalInfo, vueInstance });
                };
            });
        },
        async fetchImage(url) { if (!url) return null; return new Promise((resolve) => { GM_xmlhttpRequest({ method: 'GET', url: url, responseType: 'arraybuffer', onload: function(response) { if (response.status === 200) { resolve(response.response); } else { console.warn(`下载图片失败: ${url}, 状态: ${response.status}`); resolve(null); } }, onerror: function(error) { console.error(`下载图片时发生网络错误: ${url}`, error); resolve(null); } }); }); },
        async fetchPackingDetails(shipment, vueInstance) { if (!vueInstance.$gwPost) { const errorMsg = "无法在Vue实例上找到 $gwPost 方法，脚本可能需要更新。"; notify.error(errorMsg); throw new Error(errorMsg); } const payload = { shipmentId: shipment.shipmentId, inboundPlanId: shipment.inboundPlanId, sid: vueInstance.info.sid, }; try { console.log("正在使用 $gwPost 调用 /amz-sta-server/inbound-packing/getShipmentPackingDetail", payload); const response = await vueInstance.$gwPost("/amz-sta-server/inbound-packing/getShipmentPackingDetail", payload); if (response.code === 1 && response.data) { console.log(`成功获取货件 ${shipment.shipmentConfirmationId} 的装箱详情`, response.data); return response.data; } else { throw new Error(response.msg || 'API返回数据无效'); } } catch (error) { console.error(`使用 $gwPost 获取货件 ${shipment.shipmentConfirmationId} 装箱详情失败:`, error); notify.error(`获取装箱详情失败: ${error.message}`); return null; } },
        
        // 【V3.3 图片控制符】
        async processTemplateAndDownload({ skuItems, globalInfo, vueInstance }) {
            const templateBase64 = await GM_getValue(CONFIG.TEMPLATE_STORAGE_KEY);
            if (!templateBase64) { return notify.error("请先上传发票模板！"); }
            
            const templateBuffer = Uint8Array.from(atob(templateBase64), c => c.charCodeAt(0)).buffer;

            const groupedByFbaId = skuItems.reduce((acc, item) => {
                (acc[item.fbaId] = acc[item.fbaId] || { shipment: item.shipment, skuItems: [] }).skuItems.push(item);
                return acc;
            }, {});

            for (const fbaId in groupedByFbaId) {
                const { shipment, skuItems: groupSkuItems } = groupedByFbaId[fbaId];
                
                modal.showLoading(`(1/4) 获取货件 ${fbaId} 装箱数据...`);
                const packingData = await this.fetchPackingDetails(shipment, vueInstance);
                if (!packingData) { modal.hideLoading(); continue; }

                modal.showLoading(`(2/4) 构建数据上下文...`);
                const skuItemsMap = new Map(groupSkuItems.map(item => [item.planItem.sku, item]));
                const boxItems = packingData.shipmentPackingVOS.map(item => ({ ...item, ...skuItemsMap.get(item.sku) }));
                const boxesMap = new Map();
                boxItems.forEach(item => {
                    if (!boxesMap.has(item.boxId)) {
                        boxesMap.set(item.boxId, { id: item.boxId, name: item.boxName, weight: item.weight, length: item.length, width: item.width, height: item.height, dimensions: `${item.length}*${item.width}*${item.height}`, contents: [] });
                    }
                    boxesMap.get(item.boxId).contents.push({ sku: item.sku, msku: item.msku, fnsku: item.fnsku, quantity: item.quantityInBox, picUrl: item.url, ...skuItemsMap.get(item.sku) });
                });
                const boxes = Array.from(boxesMap.values());
                const initialContext = { shipment: { id: packingData.shipmentId, totalBoxNum: boxes.length, totalWeight: boxes.reduce((sum, box) => sum + box.weight, 0).toFixed(2), address: shipment.address, warehouseId: shipment.warehouseId }, boxes: boxes, boxItems: boxItems, skuItems: groupSkuItems, globalInfo: globalInfo };

                const workbook = new ExcelJS.Workbook();
                await workbook.xlsx.load(templateBuffer);
                const worksheet = workbook.worksheets[0];
                const preprocessorScript = worksheet.getCell('A1').value;
                let finalContext;
                try {
                    finalContext = await templateHelpers.runPreprocessor(preprocessorScript, initialContext);
                    if (preprocessorScript && typeof preprocessorScript === 'string' && preprocessorScript.trim().startsWith('// js-script')) {
                        worksheet.getCell('A1').value = null;
                    }
                } catch(e) { notify.error(e.message); modal.hideLoading(); return; }

                modal.showLoading(`(3/4) 渲染静态内容...`);
                
                let eachBlock = null;
                const eachRegex = /^{{#each\s+([\w.]+)(?:\s+as\s+(\w+))?}}$/;
                worksheet.eachRow((row, rowNumber) => {
                    row.eachCell((cell) => {
                        if (typeof cell.value !== 'string') return;
                        const cellValue = cell.value.trim();
                        if (!eachBlock) {
                            const startMatch = cellValue.match(eachRegex);
                            if (startMatch) {
                                eachBlock = { startRow: rowNumber, arrayName: startMatch[1], alias: startMatch[2] || 'item', templateRows: [] };
                            }
                        } else if (!eachBlock.endRow) {
                            if (cellValue === '{{/each}}') { eachBlock.endRow = rowNumber; }
                        }
                    });
                });

                worksheet.eachRow((row, rowNumber) => {
                    if (eachBlock && rowNumber >= eachBlock.startRow && rowNumber <= eachBlock.endRow) return;
                    row.eachCell(cell => {
                        if (cell.value && typeof cell.value === 'string') {
                            cell.value = templateHelpers.evaluateExpression(cell.value, finalContext);
                        }
                    });
                });
                
                if (eachBlock && eachBlock.endRow) {
                    // --- 渲染流程重构 ---
                    // 1. 准备数据
                    for (let i = eachBlock.startRow + 1; i < eachBlock.endRow; i++) {
                        const templateRow = worksheet.getRow(i);
                        const rowModel = { height: templateRow.height, cells: [] };
                        templateRow.eachCell({ includeEmpty: true }, (cell, colNumber) => { rowModel.cells[colNumber] = { value: cell.value, style: JSON.parse(JSON.stringify(cell.style)) }; });
                        eachBlock.templateRows.push(rowModel);
                    }
                    
                    const loopArray = templateHelpers.getProperty(finalContext, eachBlock.arrayName) || [];
                    const picUrls = new Set();
                    const rowsToInsert = [];
                    const imageCellRegex = /^{{@(.*)}}$/; // Regex for the new image syntax

                    loopArray.forEach(currentItem => {
                        const itemScope = { ...finalContext, [eachBlock.alias]: currentItem };
                        eachBlock.templateRows.forEach(rowModel => {
                            const newRowData = [];
                            rowModel.cells.forEach((cellModel, colNumber) => {
                                const cellTemplate = cellModel.value;
                                const imageMatch = typeof cellTemplate === 'string' ? cellTemplate.trim().match(imageCellRegex) : null;
                                let evaluatedValue;

                                if (imageMatch) {
                                    const expression = imageMatch[1].trim();
                                    evaluatedValue = templateHelpers.evaluateInScope(expression, itemScope);
                                    if (evaluatedValue) {
                                        picUrls.add(evaluatedValue);
                                    }
                                } else {
                                    evaluatedValue = templateHelpers.evaluateExpression(cellTemplate, itemScope);
                                }
                                newRowData[colNumber] = evaluatedValue;
                            });
                            rowsToInsert.push(newRowData);
                        });
                    });

                    modal.showLoading(`(4/4) 下载 ${picUrls.size} 张图片并生成Excel...`);
                    const imageBuffers = new Map();
                    for (const url of picUrls) {
                        const buffer = await this.fetchImage(url);
                        if (buffer) imageBuffers.set(url, buffer);
                    }

                    // 2. 结构施工：先删除旧块，再插入新行
                    worksheet.spliceRows(eachBlock.startRow, eachBlock.endRow - eachBlock.startRow + 1, ...rowsToInsert);

                    // 3. 内容填充与装修：在新结构上应用样式和图片
                    let currentRowOffset = 0;
                    loopArray.forEach((currentItem, index) => {
                        eachBlock.templateRows.forEach(rowModel => {
                            const currentRowIndex = eachBlock.startRow + currentRowOffset;
                            const newRow = worksheet.getRow(currentRowIndex);
                            newRow.height = rowModel.height;
                            
                            rowModel.cells.forEach((cellModel, colNumber) => {
                                const newCell = newRow.getCell(colNumber);
                                newCell.style = cellModel.style;
                                
                                const cellTemplate = cellModel.value;
                                const imageMatch = typeof cellTemplate === 'string' ? cellTemplate.trim().match(imageCellRegex) : null;

                                if (imageMatch) {
                                    const picUrl = newCell.value; // URL is already in the cell
                                    const imageBuffer = imageBuffers.get(picUrl);
                                    if (imageBuffer) {
                                        try {
                                            const imageId = workbook.addImage({ buffer: imageBuffer, extension: 'jpeg' });
                                            worksheet.addImage(imageId, {
                                                tl: { col: colNumber - 1, row: currentRowIndex - 1 },
                                                br: { col: colNumber, row: currentRowIndex }
                                            });
                                            newCell.value = null; // Clear the URL text
                                        } catch (imgErr) { console.error("嵌入图片失败:", imgErr); }
                                    }
                                }
                            });
                            currentRowOffset++;
                        });
                    });
                }

                const buffer = await workbook.xlsx.writeBuffer();
                const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${fbaId}-报关清关信息-${new Date().toISOString().slice(0, 10)}.xlsx`;
                a.click();
                window.URL.revokeObjectURL(url);
                notify.success(`发票 ${a.download} 已成功生成！`);
            }
            modal.hideLoading();
        },

        async run() {
            try {
                const template = await GM_getValue(CONFIG.TEMPLATE_STORAGE_KEY);
                if (!template) { return notify.error('请先上传发票模板！'); }
                modal.showLoading('正在获取页面数据...');
                const pageData = await this.fetchPageData();
                if (!pageData) { modal.hideLoading(); return; }
                const selectedShipments = pageData.shipmentList.length > 1 ? await this.selectShipment(pageData.shipmentList) : pageData.shipmentList;
                if (!selectedShipments || selectedShipments.length === 0) { modal.hideLoading(); return; }
                modal.showLoading('正在获取产品详细信息...');
                const productDetailsMap = await this.fetchProductDetails(pageData.globalInfo, pageData.vueInstance);
                modal.hideLoading();
                const finalData = await this.showConfirmationModal(selectedShipments, pageData.globalInfo, productDetailsMap, pageData.vueInstance);
                if (finalData) {
                    await this.processTemplateAndDownload(finalData);
                }
            } catch (error) {
                console.error("生成发票主流程失败:", error);
                notify.error(`操作失败: ${error.message}`);
                modal.hideLoading();
            }
        }
    };

    // --- 脚本初始化 (保持不变) ---
    function init() {
        addGlobalStyle();
        const mainButton = document.createElement('button'); mainButton.innerText = '生成清关发票'; mainButton.className = 'lx-invoice-helper-btn'; mainButton.style.display = 'none'; mainButton.onclick = () => mainApp.run(); document.body.appendChild(mainButton);
        const uploadButton = document.createElement('button'); uploadButton.innerText = '上传发票模板'; uploadButton.className = 'lx-invoice-upload-btn'; uploadButton.style.display = 'none'; document.body.appendChild(uploadButton);
        uploadButton.onclick = () => { const input = document.createElement('input'); input.type = 'file'; input.accept = '.xlsx, .xls'; input.onchange = e => { const file = e.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = async (event) => { const data = event.target.result; const base64 = data.substring(data.indexOf(',') + 1); await GM_setValue(CONFIG.TEMPLATE_STORAGE_KEY, base64); notify.success('模板上传成功并已保存！'); }; reader.readAsDataURL(file); }; input.click(); };
        const isTargetPage = () => { const currentUrl = window.location.href; return ['/erp/msupply/SendToAmazonDetail', '/erp/msupply/AddSendToAmazon', '/erp/msupply/editSendToAmazon'].some(v => currentUrl.includes(v)); };
        const toggleButtonVisibility = () => { const shouldShow = isTargetPage(); mainButton.style.display = shouldShow ? 'block' : 'none'; uploadButton.style.display = shouldShow ? 'block' : 'none'; };
        const originalPushState = history.pushState; history.pushState = function(...args) { originalPushState.apply(this, args); window.dispatchEvent(new Event('urlchange')); }; window.addEventListener('urlchange', toggleButtonVisibility); window.addEventListener('popstate', toggleButtonVisibility);
        const observer = new MutationObserver(() => { if (document.querySelector('.sta-detail')) { toggleButtonVisibility(); observer.disconnect(); } }); observer.observe(document.body, { childList: true, subtree: true });
        toggleButtonVisibility();
    }

    init();
})();