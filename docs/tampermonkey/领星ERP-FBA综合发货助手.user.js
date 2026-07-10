// ==UserScript==
// @name         领星ERP-FBA综合发货助手 (清关发票 + 箱唛提取)
// @namespace    http://tampermonkey.net/
// @version      3.2
// @description  (V3.2) 修复发票生成模块严重的数据丢失问题，完整还原报关上下文。
// @author       Your Assistant & User
// @match        *://erp.lingxing.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      *
// @require      https://cdn.jsdelivr.net/npm/exceljs@4.3.0/dist/exceljs.min.js
// ==/UserScript==

(function () {
  "use strict";

  // =================================================================================
  // [1] 全局配置 (Configuration)
  // =================================================================================
  const CONFIG = {
    BUILT_IN_TEMPLATES: [
      {
        name: "云冠清关发票模板.xlsx",
        url: "https://raw.githubusercontent.com/huangtuhao/hth123321/refs/heads/master/docs/tampermonkey/发票模板/云冠清关发票模板.xlsx",
      },
      {
        name: "佰通清关发票模板.xlsx",
        url: "https://raw.githubusercontent.com/huangtuhao/hth123321/refs/heads/master/docs/tampermonkey/发票模板/佰通清关发票模板.xlsx",
      },
      {
        name: "良逊清关发票模板.xlsx",
        url: "https://raw.githubusercontent.com/huangtuhao/hth123321/refs/heads/master/docs/tampermonkey/发票模板/良逊清关发票模板.xls",
      },
    ],
    DEFAULT_BRAND_OPTIONS: ['PlentiVive', 'PicoPandax'],
    STORAGE_KEY: "LX_INVOICE_HELPER_DATA_V1",
    USER_TEMPLATE_KEY: "LX_USER_TEMPLATE_V3_8",
    BUILT_IN_CACHE_KEY: "LX_BUILT_IN_CACHE_V4_3",
    LAST_SELECTED_KEY: "LX_LAST_SELECTED_TEMPLATE_V1",
    CUSTOM_TEMPLATE_IDENTIFIER: "user_custom_template",
    TEMPLATE_SUFFIX: "洛杉矶海卡",
    SHORT_NAME_STORAGE_KEY: "LX_ERP_SHORT_NAME_MAP_V2",
  };

  // =================================================================================
  // [2] 基础设施层 (UI & Utils)
  // =================================================================================
  function addGlobalStyle() {
    const css = ` 
        .lx-master-btn { position: fixed; right: 40px; bottom: 40px; z-index: 9999; padding: 12px 24px; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; box-shadow: 0 4px 15px rgba(64,158,255,0.4); transition: all 0.3s ease; background: linear-gradient(135deg, #409EFF, #3a8ee6); } 
        .lx-master-btn:hover { transform: translateY(-3px); box-shadow: 0 6px 20px rgba(64,158,255,0.6); } 
        .lx-modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.6); z-index: 10000; display: flex; justify-content: center; align-items: center; backdrop-filter: blur(3px); } 
        .lx-modal-content { background-color: #fff; padding: 25px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); width: 90%; max-width: 900px; max-height: 90vh; display: flex; flex-direction: column; } 
        .lx-modal-content.large { max-width: 1200px; }
        .lx-modal-header { font-size: 20px; font-weight: 600; color: #303133; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px solid #EBEEF5; } 
        .lx-modal-body { overflow-y: auto; padding-right: 10px; } 
        .lx-modal-footer { margin-top: 25px; padding-top: 15px; border-top: 1px solid #EBEEF5; display: flex; justify-content: flex-end; gap: 10px; } 
        .lx-modal-btn { padding: 10px 20px; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; transition: background 0.2s; } 
        .lx-modal-btn-primary { background-color: #409EFF; color: white; } 
        .lx-modal-btn-primary:hover { background-color: #66b1ff; }
        .lx-modal-btn-success { background-color: #67C23A; color: white; }
        .lx-modal-btn-success:hover { background-color: #85ce61; }
        .lx-modal-btn-secondary { background-color: #F2F6FC; color: #606266; border: 1px solid #DCDFE6; } 
        .lx-modal-btn-secondary:hover { background-color: #E4E7ED; }
        .lx-modal-btn-warning { background-color: #E6A23C; color: white; } 
        .lx-modal-btn-danger { background-color: #F56C6C; color: white; } 
        .lx-input-table { width: 100%; border-collapse: collapse; font-size: 13px; } 
        .lx-input-table th, .lx-input-table td { padding: 10px; text-align: left; border: 1px solid #EBEEF5; vertical-align: middle; } 
        .lx-input-table thead th { background-color: #F5F7FA; font-weight: 600; position: sticky; top: -1px; z-index: 1; } 
        .lx-input-table input[type="text"], .lx-input-table input[type="number"] { width: 100%; padding: 8px; border: 1px solid #DCDFE6; border-radius: 4px; box-sizing: border-box; transition: border-color 0.2s; } 
        .lx-input-table input:focus { outline: none; border-color: #409EFF; }
        .lx-shipment-list { list-style: none; padding: 0; margin: 0; } 
        .lx-shipment-list li { padding: 12px 10px; border-bottom: 1px solid #F2F6FC; transition: background 0.2s; } 
        .lx-shipment-list li:hover { background-color: #F5F7FA; }
        .lx-shipment-list label { display: flex; align-items: center; cursor: pointer; width: 100%; } 
        .lx-shipment-list input { margin-right: 15px; transform: scale(1.2); } 
        .lx-menu-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; padding: 10px; }
        .lx-menu-card { padding: 30px 20px; border-radius: 10px; border: 1px solid #EBEEF5; text-align: center; cursor: pointer; transition: all 0.3s; background: #fff; }
        .lx-menu-card:hover { transform: translateY(-5px); box-shadow: 0 8px 20px rgba(0,0,0,0.08); border-color: #409EFF; }
        .lx-menu-card h3 { margin: 0 0 10px 0; color: #303133; font-size: 18px; }
        .lx-menu-card p { margin: 0; color: #909399; font-size: 13px; }
        .lx-menu-card.blue:hover h3 { color: #409EFF; }
        .lx-menu-card.green:hover h3 { color: #67C23A; }
        `;
    const styleNode = document.createElement("style");
    styleNode.appendChild(document.createTextNode(css));
    document.head.appendChild(styleNode);
  }

  const UI = {
    createModal(id, title, bodyContent, footerButtons, isLarge = false) {
      this.hideModal(id);
      const overlay = document.createElement("div");
      overlay.className = "lx-modal-overlay";
      overlay.id = id;
      overlay.innerHTML = `<div class="lx-modal-content ${isLarge ? "large" : ""}"><div class="lx-modal-header">${title}</div><div class="lx-modal-body">${bodyContent}</div>${footerButtons ? `<div class="lx-modal-footer">${footerButtons}</div>` : ""}</div>`;
      document.body.appendChild(overlay);
      overlay
        .querySelector(".lx-modal-content")
        .addEventListener("click", (e) => e.stopPropagation());
      return overlay;
    },
    hideModal(id) {
      const el = document.getElementById(id);
      if (el) el.remove();
    },
    showLoading(msg = "处理中...") {
      this.createModal(
        "lx-loading",
        "请稍候",
        `<div style="text-align:center; padding: 40px 0; font-size: 16px; color: #409EFF;">加载中：${msg}</div>`,
      );
    },
    hideLoading() {
      this.hideModal("lx-loading");
    },
    notify: {
      _show(type, msg) {
        const vue = document.querySelector("#app")?.__vue__;
        if (vue && vue.$message) {
          vue.$message[type](msg);
        } else {
          alert(msg);
        }
      },
      success(msg) {
        this._show("success", msg);
      },
      error(msg) {
        this._show("error", msg);
      },
      warning(msg) {
        this._show("warning", msg);
      },
      info(msg) {
        this._show("info", msg);
      },
    },
  };

  const SharedUtils = {
    async fetchImage(url) {
      if (!url) return null;
      return new Promise((resolve) => {
        GM_xmlhttpRequest({
          method: "GET",
          url: url,
          responseType: "arraybuffer",
          onload: (res) => resolve(res.status === 200 ? res.response : null),
          onerror: () => resolve(null),
        });
      });
    },
    generateFilename(shipmentName, fbaId) {
      const anchorMatch = shipmentName.match(/([A-Z0-9]{3,5})-(FBA[A-Z0-9]+)/);
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      if (!anchorMatch) return `${fbaId}-报关清关信息-${dateStr}.xlsx`;
      const dest = anchorMatch[1];
      const prefix = shipmentName.substring(0, anchorMatch.index);
      let suffix = shipmentName.substring(
        anchorMatch.index + anchorMatch[0].length,
      );
      const method = suffix.startsWith("-") ? suffix.substring(1) : suffix;
      const dateMatch = prefix.match(/(\d{6})/);
      if (dateMatch) {
        let product = prefix.substring(dateMatch.index + dateMatch[0].length);
        product = product.startsWith("-") ? product.substring(1) : product;
        if (product.trim() && method.trim()) {
          return `${fbaId}-报关清关信息-${dateStr}-${product}-${dest}-${method}.xlsx`;
        }
      }
      return `${fbaId}-报关清关信息-${dateStr}.xlsx`;
    },
  };

  // =================================================================================
  // [3] 数据服务层 (Data Service)
  // =================================================================================
  const DataService = {
    async getPageContext() {
      try {
        const vueInstance = document.querySelector(".sta-detail").__vue__;
        if (!vueInstance) throw new Error("无法找到 Vue 实例。");
        const localTaskId = new URLSearchParams(window.location.search).get(
          "localTaskId",
        );
        if (localTaskId && !vueInstance.info) {
          await vueInstance.getDetail(localTaskId);
        }
        const globalInfo = vueInstance.info;
        const shipmentList =
          document.querySelector("#pane-3 .info-container")?.__vue__
            ?.shipmentList ||
          document.querySelector("#pane-3 .sta-delivery-service-wrapper")
            ?.__vue__?.shipmentList;
        if (!globalInfo || !shipmentList || shipmentList.length === 0) {
          throw new Error("请确认已切换到第3步“配送服务”或“发货计划”已生成。");
        }
        return { globalInfo, shipmentList, vueInstance };
      } catch (e) {
        UI.notify.error(e.message);
        return null;
      }
    },
    async getPackingDetails(shipment, vueInstance) {
      try {
        const res = await vueInstance.$gwPost(
          "/amz-sta-server/inbound-packing/getShipmentPackingDetail",
          {
            shipmentId: shipment.shipmentId,
            inboundPlanId: shipment.inboundPlanId,
            sid: shipment.sid || vueInstance.info.sid,
          },
        );
        if (res.code === 1 && res.data) return res.data;
        throw new Error(res.msg || "API返回无数据");
      } catch (err) {
        console.error("装箱数据获取失败:", err);
        UI.notify.error(
          `获取货件 ${shipment.shipmentConfirmationId} 装箱详情失败`,
        );
        return null;
      }
    },
    async getProductDetails(globalInfo, vueInstance) {
      if (!vueInstance?.$gateAxios) throw new Error("未找到请求客户端");
      const items = globalInfo.inboundPlanItemVOS || [];
      if (items.length === 0) return new Map();
      const promises = items.map(async (item, i) => {
        const seq = encodeURIComponent(`/api/product/info$$${i + 1}`);
        try {
          const res = await vueInstance.$gateAxios.get(
            `/api/product/info?id=${item.productId}&req_time_sequence=${seq}`,
          );
          if (res.data.code === 1 && res.data.info)
            return { id: item.productId, details: res.data.info };
        } catch (e) {}
        return { id: item.productId, details: null };
      });
      const results = await Promise.all(promises);
      const map = new Map();
      results.forEach((r) => {
        if (r.details) map.set(r.id, r.details);
      });
      return map;
    },
  };

  // =================================================================================
  // [4] 模块 A: 清关发票生成 (Invoice Module)
  // =================================================================================
  const InvoiceModule = {
    templateHelpers: {
      arrayBufferToBase64(buffer) {
        let binary = "";
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
      },
      runPreprocessor(scriptContent, rawContext) {
        return new Promise((resolve) => {
          if (
            !scriptContent ||
            typeof scriptContent !== "string" ||
            !scriptContent.trim().startsWith("// js-script")
          ) {
            resolve(rawContext);
            return;
          }
          try {
            const processor = new Function(
              "context",
              `${scriptContent}\nreturn context;`,
            );
            // 深拷贝数据，但保留原有的 helpers 引用避免丢失
            const cloned = JSON.parse(JSON.stringify(rawContext));
            if (rawContext.helpers) cloned.helpers = rawContext.helpers;
            resolve(processor(cloned));
          } catch (e) {
            console.error("A1预处理报错:", e);
            resolve(rawContext);
          }
        });
      },
      getProperty(obj, path) {
        if (typeof path !== "string") return obj ? obj[path] : undefined;
        return path.split(".").reduce((o, k) => (o || {})[k], obj);
      },
      evaluateInScope(expr, scope) {
        try {
          return new Function(
            ...Object.keys(scope),
            `'use strict'; return (${expr});`,
          )(...Object.values(scope));
        } catch (e) {
          return "";
        }
      },
      evaluateExpression(expr, scope) {
        if (typeof expr !== "string" || !expr.includes("{{")) return expr;
        const singleMatch = expr.trim().match(/^{{(.*)}}$/);
        if (singleMatch)
          return this.evaluateInScope(singleMatch[1].trim(), scope);
        return expr.replace(/{{(.*?)}}/g, (m, exp) => {
          const v = this.evaluateInScope(exp.trim(), scope);
          return v == null ? "" : v;
        });
      },
    },
    downloadTemplateFromBase64(base64, filename = "模板.xlsx") {
      try {
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);

        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }

        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });

        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");

        a.href = url;
        a.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
        document.body.appendChild(a);
        a.click();

        setTimeout(() => {
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
        }, 0);

        UI.notify.success(`已下载模板：${a.download}`);
      } catch (e) {
        console.error("模板下载失败:", e);
        UI.notify.error("模板下载失败：缓存数据可能已损坏");
      }
    },
    selectShipment(shipmentList) {
      return new Promise((resolve) => {
        let listHtml = `<label style="margin-bottom:15px;display:block;border-bottom:1px solid #eee;padding-bottom:10px;"><input type="checkbox" id="lx-select-all" checked> <strong>全选 / 全不选</strong></label><ul class="lx-shipment-list">`;
        shipmentList.forEach((s, i) => {
          listHtml += `<li><label><input type="checkbox" name="lx-shipment-cb" value="${i}" checked><div><strong>${s.shipmentConfirmationId}</strong> (${s.warehouseId})<br><small style="color:#909399;">SKU: ${s.mskuCount} 款 | 总箱数: ${s.boxQuantity}</small></div></label></li>`;
        });
        listHtml += "</ul>";

        const footer = `<button id="lx-inv-cancel" class="lx-modal-btn lx-modal-btn-secondary">取消</button><button id="lx-inv-next" class="lx-modal-btn lx-modal-btn-primary">下一步</button>`;
        const modal = UI.createModal(
          "lx-inv-sel-modal",
          "第一步：选择要导出的货件",
          listHtml,
          footer,
        );

        const allCb = document.getElementById("lx-select-all");
        const itemCbs = modal.querySelectorAll('input[name="lx-shipment-cb"]');
        allCb.onchange = (e) =>
          itemCbs.forEach((cb) => (cb.checked = e.target.checked));
        itemCbs.forEach(
          (cb) =>
            (cb.onchange = () =>
              (allCb.checked = Array.from(itemCbs).every((i) => i.checked))),
        );

        document.getElementById("lx-inv-cancel").onclick = () => {
          UI.hideModal("lx-inv-sel-modal");
          resolve(null);
        };
        document.getElementById("lx-inv-next").onclick = () => {
          const selected = Array.from(itemCbs)
            .filter((cb) => cb.checked)
            .map((cb) => shipmentList[parseInt(cb.value)]);
          if (selected.length === 0)
            return UI.notify.warning("请至少选择一个货件");
          UI.hideModal("lx-inv-sel-modal");
          resolve(selected);
        };
      });
    },

    async selectTemplate() {
      return new Promise(async (resolve) => {
        const lastSel = await GM_getValue(
          CONFIG.LAST_SELECTED_KEY,
          CONFIG.BUILT_IN_TEMPLATES[0]?.name,
        );
        const userTpl = await GM_getValue(CONFIG.USER_TEMPLATE_KEY);
        let opts = "";
        CONFIG.BUILT_IN_TEMPLATES.forEach((t) => {
          opts += `<option value="${t.name}" ${t.name === lastSel ? "selected" : ""}>${t.name}</option>`;
        });
        if (userTpl?.data) {
          opts += `<option value="${CONFIG.CUSTOM_TEMPLATE_IDENTIFIER}" ${lastSel === CONFIG.CUSTOM_TEMPLATE_IDENTIFIER ? "selected" : ""}>${userTpl.name} (自定义)</option>`;
        }

        const html = `
                    <p style="color:#606266; font-size:14px; margin-bottom:10px;">请选择渲染报关单的 Excel 模板：</p>
                    <div style="display:flex; gap:10px; margin-bottom: 20px;">
                        <select id="lx-tpl-select" style="flex:1; padding:8px; border-radius:4px; border:1px solid #DCDFE6;">${opts}</select>
                        <div id="lx-tpl-actions"></div>
                    </div>
                    <button id="lx-upload-btn" class="lx-modal-btn lx-modal-btn-secondary" style="width:100%;">+ 上传新的自定义模板 (.xlsx)</button>
                    <input type="file" id="lx-file-input" style="display:none;" accept=".xlsx">`;
        const footer = `<button id="lx-tpl-cancel" class="lx-modal-btn lx-modal-btn-secondary">取消</button><button id="lx-tpl-next" class="lx-modal-btn lx-modal-btn-primary">确认并加载</button>`;

        const modal = UI.createModal(
          "lx-tpl-modal",
          "第二步：选择发票模板",
          html,
          footer,
        );
        const select = document.getElementById("lx-tpl-select");
        const actions = document.getElementById("lx-tpl-actions");

        const updateBtns = () => {
          actions.innerHTML = "";

          if (select.value === CONFIG.CUSTOM_TEMPLATE_IDENTIFIER) {
            const downloadCustomBtn = document.createElement("button");
            downloadCustomBtn.innerText = "下载当前模板";
            downloadCustomBtn.className = "lx-modal-btn lx-modal-btn-primary";
            downloadCustomBtn.onclick = async () => {
              const t = await GM_getValue(CONFIG.USER_TEMPLATE_KEY);
              if (!t?.data) {
                UI.notify.warning("当前没有可下载的自定义模板");
                return;
              }

              this.downloadTemplateFromBase64(
                t.data,
                t.name || "自定义模板.xlsx",
              );
            };
            actions.appendChild(downloadCustomBtn);

            const delBtn = document.createElement("button");
            delBtn.innerText = "删除";
            delBtn.className = "lx-modal-btn lx-modal-btn-danger";
            delBtn.style.marginLeft = "8px";
            delBtn.onclick = async () => {
              if (confirm("删除自定义模板？")) {
                await GM_setValue(CONFIG.USER_TEMPLATE_KEY, null);
                UI.notify.success("已删除");
                UI.hideModal("lx-tpl-modal");
                resolve(this.selectTemplate());
              }
            };
            actions.appendChild(delBtn);
          } else {
            const downloadCacheBtn = document.createElement("button");
            downloadCacheBtn.innerText = "下载/生成缓存";
            downloadCacheBtn.className = "lx-modal-btn lx-modal-btn-primary";
            downloadCacheBtn.onclick = async () => {
              const cfg = CONFIG.BUILT_IN_TEMPLATES.find(
                (t) => t.name === select.value,
              );
              if (!cfg) {
                UI.notify.error("未找到当前模板配置");
                return;
              }

              const cache = await GM_getValue(CONFIG.BUILT_IN_CACHE_KEY, {});
              let cachedBase64 = cache[cfg.url];

              if (!cachedBase64) {
                UI.showLoading(`当前模板未缓存，正在下载：${cfg.name}`);
                const buf = await SharedUtils.fetchImage(cfg.url);
                UI.hideLoading();

                if (!buf) {
                  UI.notify.error("模板下载失败，无法生成缓存文件");
                  return;
                }

                cachedBase64 = this.templateHelpers.arrayBufferToBase64(buf);
                cache[cfg.url] = cachedBase64;
                await GM_setValue(CONFIG.BUILT_IN_CACHE_KEY, cache);

                UI.notify.success("模板已下载并写入缓存");
              }

              this.downloadTemplateFromBase64(cachedBase64, cfg.name);
            };
            actions.appendChild(downloadCacheBtn);

            const updBtn = document.createElement("button");
            updBtn.innerText = "强制更新";
            updBtn.className = "lx-modal-btn lx-modal-btn-warning";
            updBtn.style.marginLeft = "8px";
            updBtn.onclick = async () => {
              const cache = await GM_getValue(CONFIG.BUILT_IN_CACHE_KEY, {});
              const cfg = CONFIG.BUILT_IN_TEMPLATES.find(
                (t) => t.name === select.value,
              );

              if (cfg && cache[cfg.url]) {
                delete cache[cfg.url];
                await GM_setValue(CONFIG.BUILT_IN_CACHE_KEY, cache);
                UI.notify.success("缓存已清空，下次将重新下载");
              } else {
                UI.notify.info("当前模板暂无缓存，无需清空");
              }
            };
            actions.appendChild(updBtn);
          }
        };
        select.onchange = updateBtns;
        updateBtns();

        document.getElementById("lx-upload-btn").onclick = () =>
          document.getElementById("lx-file-input").click();
        document.getElementById("lx-file-input").onchange = (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = async (ev) => {
            const base64 = ev.target.result.split(",")[1];
            await GM_setValue(CONFIG.USER_TEMPLATE_KEY, {
              name: file.name,
              data: base64,
            });
            await GM_setValue(
              CONFIG.LAST_SELECTED_KEY,
              CONFIG.CUSTOM_TEMPLATE_IDENTIFIER,
            );
            UI.hideModal("lx-tpl-modal");
            UI.notify.success("上传成功");
            resolve(this.selectTemplate());
          };
          reader.readAsDataURL(file);
        };

        document.getElementById("lx-tpl-cancel").onclick = () => {
          UI.hideModal("lx-tpl-modal");
          resolve(null);
        };
        document.getElementById("lx-tpl-next").onclick = async () => {
          const val = select.value;
          await GM_setValue(CONFIG.LAST_SELECTED_KEY, val);
          if (val === CONFIG.CUSTOM_TEMPLATE_IDENTIFIER) {
            const t = await GM_getValue(CONFIG.USER_TEMPLATE_KEY);
            UI.hideModal("lx-tpl-modal");
            resolve(t?.data);
            return;
          }
          const cfg = CONFIG.BUILT_IN_TEMPLATES.find((t) => t.name === val);
          const cache = await GM_getValue(CONFIG.BUILT_IN_CACHE_KEY, {});
          if (cache[cfg.url]) {
            UI.hideModal("lx-tpl-modal");
            resolve(cache[cfg.url]);
            return;
          }

          UI.showLoading(`正在下载模板...`);
          const buf = await SharedUtils.fetchImage(cfg.url);
          if (buf) {
            const b64 = this.templateHelpers.arrayBufferToBase64(buf);
            cache[cfg.url] = b64;
            await GM_setValue(CONFIG.BUILT_IN_CACHE_KEY, cache);
            UI.hideLoading();
            UI.hideModal("lx-tpl-modal");
            resolve(b64);
          } else {
            UI.hideLoading();
            UI.notify.error("模板下载失败");
          }
        };
      });
    },

    async showConfirmModal(shipments, globalInfo, productMap) {
      const savedData = await GM_getValue(CONFIG.STORAGE_KEY, {});
      const allItems = [];
      let rows = "";

      shipments.forEach((s) => {
        s.itemList.forEach((i) => {
          const pItem = globalInfo.inboundPlanItemVOS.find(
            (p) => p.sku === i.sku,
          );
          if (!pItem) return;
          const pDetail = productMap.get(pItem.productId) || {};
          const sData = savedData[pItem.sku] || {};
          const boxCount = Math.round(i.quantity / pItem.quantityInBox) || 0;
          if (boxCount === 0) return;

          const declaration = pDetail.product_declaration_list || {};
          const clearance = pDetail.product_clearance_list || {};

          const item = {
            shipment: s,
            planItem: pItem,
            fbaId: s.shipmentConfirmationId,
            boxCount,
            refId: s.amazonReferenceId,
            grossWeightPerBox: pItem.weight,
            pcsPerBox: pItem.quantityInBox,
            productWeight: (pItem.weight / pItem.quantityInBox).toFixed(4),
            product: pDetail,
            declaration: declaration,
            clearance: clearance,
            nameCn: pDetail.bg_customs_export_name || pItem.productName,
            hscode:
              sData.hscode ||
              clearance.customs_clearance_hs_code ||
              declaration.customs_declaration_hs_code ||
              pDetail.bg_export_hs_code ||
              "",
            price:
              sData.price ||
              clearance.customs_clearance_price ||
              declaration.customs_import_price ||
              pDetail.bg_customs_import_price ||
              "0.00",
            material:
              sData.material ||
              clearance.customs_clearance_material ||
              pDetail.cg_product_material ||
              "",
            usage: sData.usage || clearance.customs_clearance_usage || "",
            brand: sData.brand || pDetail.brand_name || "",
            model: sData.model || pDetail.model || pItem.sku,
          };
          allItems.push(item);
        });
      });

      allItems.forEach((itm, idx) => {
        rows += `<tr data-index="${idx}"><td>${itm.fbaId.slice(0, 12)}...</td><td>${itm.planItem.sku}</td><td>${itm.nameCn}</td>
                <td><input type="text" value="${itm.hscode}" data-f="hscode"></td><td><input type="number" step="0.01" value="${itm.price}" data-f="price"></td>
                <td><input type="text" value="${itm.material}" data-f="material"></td><td><input type="text" value="${itm.usage}" data-f="usage"></td>
                <td><input type="text" value="${itm.brand}" data-f="brand"></td><td><input type="text" value="${itm.model}" data-f="model"></td></tr>`;
      });

      const batchBtn = (field) =>
        `<br><a href="javascript:void(0)" class="lx-batch-btn" data-batch="${field}" style="font-size:12px; font-weight:normal; color:#409EFF; text-decoration:none; display:inline-block; margin-top:4px;">[批量修改]</a>`;

      // 新增：提取 CONFIG 中的品牌配置，生成下拉框 HTML
      const brandOptionsHtml = CONFIG.DEFAULT_BRAND_OPTIONS.map(b => `<option value="${b}">${b}</option>`).join('');
      const brandBatchSelect = `<br><select id="lx-batch-brand" style="margin-top:4px; padding:2px 4px; font-size:12px; border:1px solid #409EFF; border-radius:3px; color:#409EFF; outline:none; cursor:pointer; background: transparent;"><option value="" disabled selected>[批量选择]</option>${brandOptionsHtml}</select>`;

      const html = `<div style="max-height:55vh;overflow:auto;"><table class="lx-input-table">
                <thead><tr>
                    <th style="vertical-align: top;">FBA</th><th style="vertical-align: top;">SKU</th><th style="vertical-align: top;">品名</th>
                    <th style="vertical-align: top;">HSCODE${batchBtn("hscode")}</th><th style="vertical-align: top;">单价($)${batchBtn("price")}</th>
                    <th style="vertical-align: top;">材质${batchBtn("material")}</th><th style="vertical-align: top;">用途${batchBtn("usage")}</th>
                    <th style="vertical-align: top;">品牌${brandBatchSelect}</th><th style="vertical-align: top;">型号${batchBtn("model")}</th>
                </tr></thead><tbody>${rows}</tbody></table></div>`;

      const footer = `<button id="lx-cfm-cancel" class="lx-modal-btn lx-modal-btn-secondary">取消</button><button id="lx-cfm-go" class="lx-modal-btn lx-modal-btn-success">💾 保存并生成 Excel</button>`;

      return new Promise((resolve) => {
        const modal = UI.createModal(
          "lx-cfm-modal",
          "第三步：补充并确认报关资料",
          html,
          footer,
          true,
        );

        modal.querySelectorAll(".lx-batch-btn").forEach((btn) => {
          btn.onclick = (e) => {
            const field = e.target.dataset.batch;
            const fieldName =
              e.target.parentElement.childNodes[0].textContent.trim();
            const newVal = prompt(
              `请输入要批量应用到所有行的【${fieldName}】的值：\n(留空将清空该列)`,
            );
            if (newVal !== null) {
              modal
                .querySelectorAll(`input[data-f="${field}"]`)
                .forEach((input) => (input.value = newVal.trim()));
              UI.notify.success(`已将【${fieldName}】批量修改完毕`);
            }
          };
        });

        // 新增：品牌下拉框的批量应用事件
        const brandSelect = modal.querySelector("#lx-batch-brand");
        if (brandSelect) {
            brandSelect.onchange = (e) => {
                const newVal = e.target.value;
                if (newVal) {
                    // 覆盖所有品牌输入框
                    modal.querySelectorAll('input[data-f="brand"]').forEach(input => input.value = newVal);
                    UI.notify.success(`已将【品牌】批量修改为: ${newVal}`);
                    // 自动重置回默认的 "[批量选择]" 状态，方便下次重选
                    e.target.value = ""; 
                }
            };
        }

        document.getElementById("lx-cfm-cancel").onclick = () => {
          UI.hideModal("lx-cfm-modal");
          resolve(null);
        };
        document.getElementById("lx-cfm-go").onclick = async () => {
          const newData = await GM_getValue(CONFIG.STORAGE_KEY, {});
          modal.querySelectorAll("tbody tr").forEach((tr) => {
            const itm = allItems[tr.dataset.index];
            const fields = [
              "hscode",
              "price",
              "material",
              "usage",
              "brand",
              "model",
            ];

            // 1. 保存输入框里的值
            fields.forEach((f) => {
              const val = tr.querySelector(`[data-f="${f}"]`).value.trim();
              itm[f] = val;
              if (!newData[itm.planItem.sku]) newData[itm.planItem.sku] = {};
              newData[itm.planItem.sku][f] = val;
            });

            // 2. 【核心修复】强制将界面修改的值，同步覆盖回底层的原始属性中
            // 防止模板中写的是 {{item.product.brand_name}} 而导致读不到手动修改的值
            if (itm.product) {
              itm.product.brand_name = itm.brand;
              itm.product.model = itm.model;
              itm.product.bg_customs_import_price = itm.price;
              itm.product.bg_export_hs_code = itm.hscode;
              itm.product.cg_product_material = itm.material;
            }
            if (itm.clearance) {
              itm.clearance.customs_clearance_hs_code = itm.hscode;
              itm.clearance.customs_clearance_price = itm.price;
              itm.clearance.customs_clearance_material = itm.material;
              itm.clearance.customs_clearance_usage = itm.usage;
            }
            if (itm.declaration) {
              itm.declaration.customs_declaration_hs_code = itm.hscode;
              itm.declaration.customs_import_price = itm.price;
            }
          });

          await GM_setValue(CONFIG.STORAGE_KEY, newData);
          UI.hideModal("lx-cfm-modal");
          resolve(allItems);
        };
      });
    },

    async generateExcel(base64, items, globalInfo, vueInstance) {
      // 核心修复2：还原 helpers 方法，供A1预处理脚本使用
      const helpers = {
        convertToKg: (value, sourceUnit) => {
          const num = parseFloat(value);
          if (isNaN(num)) return 0;
          if (!sourceUnit || typeof sourceUnit !== "string") return num;
          const unit = sourceUnit.toLowerCase().trim();
          const factors = {
            g: 0.001,
            gram: 0.001,
            grams: 0.001,
            克: 0.001,
            kg: 1,
            kilogram: 1,
            kilograms: 1,
            千克: 1,
            公斤: 1,
            lb: 0.453592,
            lbs: 0.453592,
            pound: 0.453592,
            pounds: 0.453592,
            磅: 0.453592,
            oz: 0.0283495,
            ounce: 0.0283495,
            ounces: 0.0283495,
            盎司: 0.0283495,
          };
          return factors[unit] !== undefined ? num * factors[unit] : num;
        },
      };

      const buf = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer;
      const grouped = items.reduce((acc, i) => {
        (acc[i.fbaId] = acc[i.fbaId] || {
          s: i.shipment,
          items: [],
        }).items.push(i);
        return acc;
      }, {});

      for (const fbaId in grouped) {
        const { s: shipment, items: groupItems } = grouped[fbaId];
        UI.showLoading(`正在处理 ${fbaId} - 获取装箱...`);
        const packData = await DataService.getPackingDetails(
          shipment,
          vueInstance,
        );
        if (!packData) continue;

        UI.showLoading(`正在处理 ${fbaId} - 分析装箱算法...`);
        const skuMap = new Map(groupItems.map((i) => [i.planItem.sku, i]));

        // 核心修复3：必须从 skuMap 中映射所有的 skuItems 属性到 boxItems 中！
        const boxItems = packData.shipmentPackingVOS.map((item) => ({
          ...item,
          ...skuMap.get(item.sku),
        }));

        const boxesMap = new Map();
        boxItems.forEach((item) => {
          if (!boxesMap.has(item.boxId)) {
            // 核心修复4：补全箱子的详细信息
            boxesMap.set(item.boxId, {
              id: item.boxId,
              name: item.boxName,
              weight: item.weight,
              length: item.length,
              width: item.width,
              height: item.height,
              dimensions: `${item.length}*${item.width}*${item.height}`,
              contents: [],
            });
          }
          boxesMap.get(item.boxId).contents.push({
            sku: item.sku,
            msku: item.msku,
            fnsku: item.fnsku,
            quantity: item.quantityInBox,
            picUrl: item.url,
            ...skuMap.get(item.sku),
          });
        });
        const boxes = Array.from(boxesMap.values());

        const mergedBoxes = [];
        const mergedBoxItems = [];
        const groups = new Map();
        boxes.forEach((b) => {
          const cHash = JSON.stringify(
            [...b.contents]
              .sort((x, y) => x.sku.localeCompare(y.sku))
              .map((c) => ({ sku: c.sku, q: c.quantity })),
          );
          const pHash = `W${b.weight}L${b.length}W${b.width}H${b.height}`;
          const fHash = `${cHash}|${pHash}`;
          if (!groups.has(fHash)) groups.set(fHash, []);
          groups.get(fHash).push(b);
        });

        const getNum = (id) => parseInt(id.match(/(\d+)$/)?.[0] || "-1");
        for (const g of groups.values()) {
          g.sort((x, y) => getNum(x.id) - getNum(y.id));
          let cur = [g[0]];
          for (let i = 1; i < g.length; i++) {
            if (getNum(g[i].id) === getNum(g[i - 1].id) + 1) cur.push(g[i]);
            else {
              processGrp(cur);
              cur = [g[i]];
            }
          }
          processGrp(cur);
        }

        function processGrp(sub) {
          if (!sub.length) return;
          const rep = sub[0];
          const c = sub.length;
          const cId = c <= 1 ? rep.id : `${rep.id}-${getNum(rep.id) + c - 1}`;
          mergedBoxes.push({
            count: c,
            totalWeight: rep.weight * c,
            name: sub.map((b) => b.id).join(","),
            ...rep,
          });

          // 核心修复5：从富含所有商品信息的 boxItems 中过滤，而不是原始的 packingData
          const itemsInRepBox = boxItems.filter((i) => i.boxId === rep.id);
          itemsInRepBox.forEach((i) =>
            mergedBoxItems.push({ ...i, boxId: cId, boxCount: c }),
          );
        }

        UI.showLoading(`正在处理 ${fbaId} - 渲染 Excel...`);
        // 核心修复6：还原上下文中丢失的 boxItems, totalWeight 与 helpers
        const ctx = {
          shipment: {
            id: packData.shipmentId,
            totalBoxNum: boxes.length,
            totalWeight: boxes
              .reduce((sum, box) => sum + box.weight, 0)
              .toFixed(2),
            address: shipment.address,
            warehouseId: shipment.warehouseId,
          },
          rawShipment: shipment,
          boxes,
          boxItems,
          skuItems: groupItems,
          globalInfo,
          mergedBoxes,
          mergedBoxItems,
          helpers,
        };

        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf);
        const ws = wb.worksheets[0];
        const pre = ws.getCell("A1").value;
        const finalCtx = await this.templateHelpers.runPreprocessor(pre, ctx);
        if (typeof pre === "string" && pre.startsWith("// js-script"))
          ws.getCell("A1").value = null;

        let block = null;
        ws.eachRow((row, rn) => {
          row.eachCell((cell) => {
            const v =
              typeof cell.value === "object" ? cell.value?.text : cell.value;
            if (typeof v === "string") {
              const m = v.match(/^{{#each\s+([\w.]+)(?:\s+as\s+(\w+))?}}$/);
              if (m)
                block = {
                  start: rn,
                  arr: m[1],
                  alias: m[2] || "item",
                  rows: [],
                };
              else if (block && !block.end && v.trim() === "{{/each}}")
                block.end = rn;
            }
          });
        });

        ws.eachRow((row, rn) => {
          if (block && rn >= block.start && rn <= block.end) return;
          row.eachCell((cell) => {
            if (typeof cell.value === "string")
              cell.value = this.templateHelpers.evaluateExpression(
                cell.value,
                finalCtx,
              );
          });
        });

        if (block && block.end) {
          for (let i = block.start + 1; i < block.end; i++) {
            const r = ws.getRow(i);
            const rm = { height: r.height, cells: [] };
            r.eachCell(
              { includeEmpty: true },
              (c, cn) =>
                (rm.cells[cn] = {
                  v: c.value,
                  s: JSON.parse(JSON.stringify(c.style)),
                }),
            );
            block.rows.push(rm);
          }
          const arr =
            this.templateHelpers.getProperty(finalCtx, block.arr) || [];
          const pics = new Set();
          const inserts = [];

          arr.forEach((itm) => {
            const scope = { ...finalCtx, [block.alias]: itm };
            block.rows.forEach((rm) => {
              const rowD = [];
              rm.cells.forEach((cm, cn) => {
                const v = typeof cm.v === "object" ? cm.v?.text : cm.v;
                const imgM =
                  typeof v === "string" ? v.match(/^{{@(.*)}}$/) : null;
                if (imgM) {
                  const u = this.templateHelpers.evaluateInScope(
                    imgM[1],
                    scope,
                  );
                  if (u) pics.add(u);
                  rowD[cn] = u;
                } else
                  rowD[cn] = this.templateHelpers.evaluateExpression(v, scope);
              });
              inserts.push(rowD);
            });
          });

          UI.showLoading(`正在处理 ${fbaId} - 下载图片 (${pics.size}张)...`);
          const imgBufs = new Map();
          for (const url of pics) {
            const b = await SharedUtils.fetchImage(url);
            if (b) imgBufs.set(url, b);
          }

          ws.spliceRows(block.start, block.end - block.start + 1, ...inserts);

          let offset = 0;
          arr.forEach((itm) => {
            block.rows.forEach((rm) => {
              const row = ws.getRow(block.start + offset);
              row.height = rm.height;
              rm.cells.forEach((cm, cn) => {
                const cell = row.getCell(cn);
                cell.style = cm.s;
                const v = typeof cm.v === "object" ? cm.v?.text : cm.v;
                if (typeof v === "string" && v.match(/^{{@(.*)}}$/)) {
                  const u = cell.value;
                  const ib = imgBufs.get(u);
                  if (ib) {
                    try {
                      const iId = wb.addImage({
                        buffer: ib,
                        extension: "jpeg",
                      });
                      ws.addImage(iId, {
                        tl: { col: cn - 1, row: row.number - 1 },
                        br: { col: cn, row: row.number },
                      });
                      cell.value = null;
                    } catch (e) {}
                  }
                }
              });
              offset++;
            });
          });
        }

        const outBuf = await wb.xlsx.writeBuffer();
        const blob = new Blob([outBuf], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = SharedUtils.generateFilename(shipment.shipmentName, fbaId);
        a.click();
        window.URL.revokeObjectURL(url);
        UI.notify.success(`发票 ${a.download} 生成成功！`);
      }
    },

    async run(contextData) {
      try {
        const shipments = await this.selectShipment(contextData.shipmentList);
        if (!shipments) return;
        const tpl = await this.selectTemplate();
        if (!tpl) return;

        UI.showLoading("正在获取产品报关与图片信息...");
        const pMap = await DataService.getProductDetails(
          contextData.globalInfo,
          contextData.vueInstance,
        );
        UI.hideLoading();

        const finalItems = await this.showConfirmModal(
          shipments,
          contextData.globalInfo,
          pMap,
        );
        if (finalItems) {
          await this.generateExcel(
            tpl,
            finalItems,
            contextData.globalInfo,
            contextData.vueInstance,
          );
        }
      } catch (e) {
        console.error(e);
        UI.notify.error("生成失败: " + e.message);
      } finally {
        UI.hideLoading();
      }
    },
  };

  // =================================================================================
  // [5] 模块 B: 箱唛文本提取 (Label Extract Module)
  // =================================================================================
  const LabelModule = {
    async run(contextData) {
      const shortMap = await GM_getValue(CONFIG.SHORT_NAME_STORAGE_KEY, {});
      const allItemsMap = new Map();
      contextData.shipmentList.forEach((shipment) => {
        (shipment.itemList || []).forEach((item) => {
          if (!allItemsMap.has(item.sku)) {
            allItemsMap.set(item.sku, item);
          }
        });
      });
      const list = Array.from(allItemsMap.values());

      if (!list.length) return UI.notify.warning("当前计划无商品");

      let rows = "";
      list.forEach((p) => {
        const def = shortMap[p.sku] || p.productName;
        rows += `<tr><td style="font-size:12px;color:#606266;"><b>${p.sku}</b><br>${p.productName}</td><td><input type="text" data-sku="${p.sku}" value="${def.replace(/"/g, "&quot;")}"></td></tr>`;
      });

      const body = `<p style="color:#909399;font-size:13px;">编辑商品简称。系统将自动记录，并在结果页生成易读的箱唛文本。</p>
                          <div style="max-height:50vh;overflow:auto;"><table class="lx-input-table"><thead><tr><th width="60%">SKU信息</th><th>定义简称</th></tr></thead><tbody>${rows}</tbody></table></div>`;
      const footer = `<button id="lx-lbl-cancel" class="lx-modal-btn lx-modal-btn-secondary">取消</button><button id="lx-lbl-go" class="lx-modal-btn lx-modal-btn-success">生成文本</button>`;

      const modal = UI.createModal(
        "lx-lbl-modal",
        "定义箱唛简称",
        body,
        footer,
      );
      document.getElementById("lx-lbl-cancel").onclick = () =>
        UI.hideModal("lx-lbl-modal");
      document.getElementById("lx-lbl-go").onclick = async () => {
        const newMap = {};
        modal.querySelectorAll("input[data-sku]").forEach((inp) => {
          if (inp.value.trim()) newMap[inp.dataset.sku] = inp.value.trim();
        });
        await GM_setValue(CONFIG.SHORT_NAME_STORAGE_KEY, newMap);
        UI.hideModal("lx-lbl-modal");

        UI.showLoading("正在获取所有货件装箱明细...");
        try {
          const promises = contextData.shipmentList.map((s) =>
            DataService.getPackingDetails(s, contextData.vueInstance),
          );
          const allPack = await Promise.all(promises);
          this.renderOutput(contextData, allPack, newMap);
        } catch (e) {
          UI.notify.error(e.message);
        } finally {
          UI.hideLoading();
        }
      };
    },

    renderOutput({ globalInfo, shipmentList, vueInstance }, allPack, shortMap) {
      let names = [];
      let details = "";
      shipmentList.forEach((s, idx) => {
        const pVos = allPack[idx]?.shipmentPackingVOS;
        if (!pVos) return;

        const counts = new Map();
        pVos.forEach((b) => {
          if (!counts.has(b.sku)) counts.set(b.sku, 0);
          counts.set(b.sku, counts.get(b.sku) + 1);
        });
        const summary = Array.from(counts.entries())
          .map(([sku, c]) => `${shortMap[sku] || sku}${c}箱`)
          .join(" ");

        const shop = globalInfo.sellerName
          .replace(/-[A-Z]{2,}(\s*-\s*\S+)?$/, "")
          .trim();
        const creator =
          globalInfo.createByName ||
          vueInstance.$store?.state?.userName ||
          "未知";
        const date = new Date()
          .toLocaleDateString("zh-CN", {
            year: "2-digit",
            month: "2-digit",
            day: "2-digit",
          })
          .replace(/\//g, "");
        const dest = s.warehouseId;
        const fba = s.shipmentConfirmationId;
        names.push(
          `${shop}-${creator}-${date}-${summary}-${dest}-${fba}-${CONFIG.TEMPLATE_SUFFIX}`,
        );

        details += `${dest}-${fba}-${CONFIG.TEMPLATE_SUFFIX}\n`;
        let cur = null;
        pVos.forEach((b, i) => {
          const n = parseInt(b.boxId.match(/U(\d+)$/)[1]);
          if (!cur) cur = { sku: b.sku, s: n, e: n };
          else if (b.sku === cur.sku) cur.e = n;
          else {
            details += `${cur.s}-${cur.e}：${shortMap[cur.sku] || cur.sku}\n`;
            cur = { sku: b.sku, s: n, e: n };
          }
          if (i === pVos.length - 1)
            details += `${cur.s}-${cur.e}：${shortMap[cur.sku] || cur.sku}\n`;
        });
        details += `\n`;
      });
      this.openTab(names, details.trim());
    },

    openTab(names, details) {
      const namesHtml = names
        .map(
          (n, i) =>
            `<div style="display:flex;margin-bottom:10px;"><input type="text" id="n-${i}" value="${n}" style="flex:1;padding:10px;border:1px solid #dcdfe6;border-radius:4px 0 0 4px;"><button onclick="copy('n-${i}')" style="padding:0 20px;background:#409eff;color:#fff;border:none;border-radius:0 4px 4px 0;cursor:pointer;">复制</button></div>`,
        )
        .join("");
      const win = window.open("", "_blank");
      win.document.write(`
                <html><head><title>装箱文本结果</title><style>
                body{font-family:system-ui;background:#f5f7fa;padding:40px;margin:0;}
                .box{background:#fff;padding:30px;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.1);max-width:1000px;margin:0 auto;}
                h2{color:#303133;margin-top:0;}
                textarea{width:100%;height:400px;padding:15px;border:1px solid #dcdfe6;border-radius:4px;box-sizing:border-box;font-family:monospace;resize:vertical;}
                .toast{position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#67c23a;color:#fff;padding:12px 25px;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.1);opacity:0;transition:all .3s;z-index:9999;}
                .toast.show{top:40px;opacity:1;}
                </style></head><body>
                <div class="box">
                    <h2>📦 货件命名</h2>${namesHtml || "<p>无数据</p>"}
                    <h2 style="margin-top:30px;">📝 箱唛明细</h2>
                    <textarea id="dtl">${details}</textarea>
                    <button onclick="copy('dtl')" style="margin-top:15px;padding:12px 25px;background:#67c23a;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:15px;font-weight:bold;">一键复制箱唛明细</button>
                </div>
                <script>
                let timer;
                function showToast(msg) {
                    document.querySelectorAll('.toast').forEach(e=>e.remove()); clearTimeout(timer);
                    const t = document.createElement('div'); t.className='toast'; t.innerText=msg; document.body.appendChild(t);
                    setTimeout(()=>t.classList.add('show'),10);
                    timer = setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.remove(),300); }, 2000);
                }
                function copy(id) { document.getElementById(id).select(); document.execCommand('copy'); showToast('复制成功！'); }
                </script>
                </body></html>
            `);
      win.document.close();
    },
  };

  // =================================================================================
  // [6] 核心调度器 (Controller)
  // =================================================================================
  const AppController = {
    init() {
      addGlobalStyle();

      const btn = document.createElement("button");
      btn.innerText = "🚀 FBA 综合助手";
      btn.className = "lx-master-btn";
      btn.style.display = "none";
      btn.onclick = () => this.showMenu();
      document.body.appendChild(btn);

      const checkPage = () => {
        const url = window.location.href;
        btn.style.display = [
          "/erp/msupply/SendToAmazonDetail",
          "/erp/msupply/AddSendToAmazon",
          "/erp/msupply/editSendToAmazon",
        ].some((v) => url.includes(v))
          ? "block"
          : "none";
      };

      const _push = history.pushState;
      history.pushState = function (...a) {
        const r = _push.apply(this, a);
        window.dispatchEvent(new Event("lx_url_change"));
        return r;
      };
      window.addEventListener("lx_url_change", checkPage);
      window.addEventListener("popstate", checkPage);

      const ob = new MutationObserver(() => {
        if (document.querySelector(".sta-detail")) {
          checkPage();
          ob.disconnect();
        }
      });
      ob.observe(document.body, { childList: true, subtree: true });
      checkPage();
    },

    async showMenu() {
      const html = `
                <div class="lx-menu-cards">
                    <div class="lx-menu-card blue" id="lx-btn-inv">
                        <div style="font-size:36px;margin-bottom:15px;">📊</div>
                        <h3>生成清关发票</h3>
                        <p>带图片、合并箱子并导出 Excel</p>
                    </div>
                    <div class="lx-menu-card green" id="lx-btn-lbl">
                        <div style="font-size:36px;margin-bottom:15px;">📝</div>
                        <h3>提取箱唛明细</h3>
                        <p>自动简称、生成发货结构化文本</p>
                    </div>
                </div>
            `;
      const footer = `<button id="lx-menu-cancel" class="lx-modal-btn lx-modal-btn-secondary" style="width: 100%;">关闭</button>`;

      UI.createModal("lx-main-menu", "🚀 请选择 FBA 处理工具", html, footer);
      document.getElementById("lx-menu-cancel").onclick = () =>
        UI.hideModal("lx-main-menu");

      document.getElementById("lx-btn-inv").onclick = async () => {
        UI.hideModal("lx-main-menu");
        const ctx = await DataService.getPageContext();
        if (ctx) InvoiceModule.run(ctx);
      };

      document.getElementById("lx-btn-lbl").onclick = async () => {
        UI.hideModal("lx-main-menu");
        const ctx = await DataService.getPageContext();
        if (ctx) LabelModule.run(ctx);
      };
    },
  };

  AppController.init();
})();
