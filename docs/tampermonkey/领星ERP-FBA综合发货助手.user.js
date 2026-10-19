// ==UserScript==
// @name         领星ERP-FBA综合发货助手 (清关发票 + 箱唛提取)
// @namespace    http://tampermonkey.net/
// @version      3.6
// @description  (V3.6) 首页按命名、箱唛、发票排序；所有步骤支持返回主页与右上角关闭，离开后停止后续流程。
// @author       Your Assistant & User
// @match        https://erp.lingxing.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      *
// @require      https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.3.0/exceljs.min.js#sha512-UnrKxsCMN9hFk7M56t4I4ckB4N/2HHi0w/7+B/1JsXIX3DmyBcsGpT3/BsuZMZf+6mAr0vP81syWtfynHJ69JA==
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
        url: "https://raw.githubusercontent.com/huangtuhao/hth123321/e132374901afd25867688f81c5683a7c26fc456b/docs/tampermonkey/发票模板/云冠清关发票模板.xlsx",
        sha256: "3F83FF6B40673B786C69F669B88413E9B04AB0654B8458A90F7BE0CFF7459D95",
      },
      {
        name: "佰通清关发票模板.xlsx",
        url: "https://raw.githubusercontent.com/huangtuhao/hth123321/e132374901afd25867688f81c5683a7c26fc456b/docs/tampermonkey/发票模板/佰通清关发票模板.xlsx",
        sha256: "15818A648C442F9EF06325AE2C0E28FC292D9B892920DB2AD8602CE851F5B747",
      },
      {
        name: "良逊清关发票模板.xlsx",
        url: "https://raw.githubusercontent.com/huangtuhao/hth123321/e132374901afd25867688f81c5683a7c26fc456b/docs/tampermonkey/发票模板/良逊清关发票模板.xlsx",
        sha256: "76AA030DAB0DF9ABB2D08E1252C00324EAACCBC3C70033788F891062511C3041",
      },
      {
        name: "中外通清关发票模板.xlsx",
        url: "https://raw.githubusercontent.com/huangtuhao/hth123321/refs/heads/master/docs/tampermonkey/发票模板/中外通清关发票模板.xlsx",
      },
    ],
    DEFAULT_BRAND_OPTIONS: ["PlentiVive", "PicoPandax"],
    STORAGE_KEY: "LX_INVOICE_HELPER_DATA_V1",
    USER_TEMPLATE_KEY: "LX_USER_TEMPLATE_V3_8",
    BUILT_IN_CACHE_KEY: "LX_BUILT_IN_CACHE_V4_3",
    LAST_SELECTED_KEY: "LX_LAST_SELECTED_TEMPLATE_V1",
    CUSTOM_TEMPLATE_IDENTIFIER: "user_custom_template",
    LOGISTICS_CHANNEL_STORAGE_KEY: "LX_LAST_LOGISTICS_CHANNEL_V1",
    SHORT_NAME_STORAGE_KEY: "LX_ERP_SHORT_NAME_MAP_V2",
    FS_DB_NAME: "LX_FBA_INVOICE_FILE_SYSTEM_V1",
    FS_STORE_NAME: "handles",
    FS_ROOT_KEY: "invoice_output_root",
    FS_PICKER_ID: "lx-fba-invoice-output",
    FS_FOLDER_MAX_LENGTH: 60,
    FS_FILENAME_MAX_LENGTH: 150,
    BOX_LABEL_FILENAME_MAX_LENGTH: 60,
    BOX_LABEL_PRINT_OPTIONS: {
      type: "PackageLabel_Thermal_AK100",
      is_marked: 1,
      hide_ship_from_company_name: 1,
      hide_ship_to_company_name: 0,
      sort_label: false,
      print_sta_name_page: false,
      print_made_in_china: true,
      print_product_num: false,
      print_packing_task_box_no: false,
      print_center_id: false,
      print_fnsku: false,
      print_product_name: true,
      sort_by_packing_task_box: false,
    },
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
        .lx-modal-header { display:flex; align-items:center; justify-content:space-between; gap:12px; font-size: 20px; font-weight: 600; color: #303133; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px solid #EBEEF5; }
        .lx-modal-title { flex:1; min-width:0; }
        .lx-modal-nav { display:flex; align-items:center; gap:10px; flex-shrink:0; }
        .lx-modal-home { border:1px solid #DCDFE6; background:#F5F7FA; color:#606266; border-radius:5px; padding:6px 10px; cursor:pointer; font-size:13px; }
        .lx-modal-close { border:none; background:transparent; color:#909399; border-radius:5px; width:30px; height:30px; font-size:24px; line-height:1; cursor:pointer; }
        .lx-modal-close:hover { color:#F56C6C; background:#FEF0F0; }
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
        .lx-menu-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; padding: 10px; }
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

  function escapeHtml(value) {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return String(value ?? "").replace(/[&<>"']/g, (char) => entities[char]);
  }

  const Workflow = {
    current: null,
    _sequence: 0,
    start(kind) {
      if (this.current) this.current.cancelled = true;
      const flow = { id: ++this._sequence, kind, cancelled: false };
      this.current = flow;
      UI.closeAllModals("replaced");
      return flow;
    },
    isActive(flow) {
      return !flow || (!flow.cancelled && this.current === flow);
    },
    check(flow) {
      if (this.isActive(flow)) return;
      const error = new Error("已离开当前处理步骤");
      error.name = "LXFlowCancelled";
      throw error;
    },
    isCancelled(error) {
      return error?.name === "LXFlowCancelled";
    },
    leave(action, flow) {
      if (flow && this.current !== flow) return;
      if (this.current) this.current.cancelled = true;
      this.current = null;
      UI.closeAllModals(action);
      if (action === "home") return AppController.showMenu();
    },
  };

  const UI = {
    _modals: new Map(),
    createModal(id, title, bodyContent, footerButtons, isLarge = false, options = {}) {
      const { flow = Workflow.current, onDismiss, allowBack = id !== "lx-main-menu" } = options;
      Workflow.check(flow);
      this.hideModal(id);
      const overlay = document.createElement("div");
      overlay.className = "lx-modal-overlay";
      overlay.id = id;
      overlay.innerHTML = `<div class="lx-modal-content ${isLarge ? "large" : ""}"><div class="lx-modal-header"><span class="lx-modal-title">${escapeHtml(title)}</span><div class="lx-modal-nav">${allowBack ? '<button type="button" class="lx-modal-home">返回主页</button>' : ""}<button type="button" class="lx-modal-close" aria-label="关闭弹窗" title="关闭弹窗">×</button></div></div><div class="lx-modal-body">${bodyContent}</div>${footerButtons ? `<div class="lx-modal-footer">${footerButtons}</div>` : ""}</div>`;
      document.body.appendChild(overlay);
      this._modals.set(id, { element: overlay, flow, onDismiss });
      overlay.querySelector(".lx-modal-close").onclick = () => Workflow.leave("close", flow);
      if (allowBack) {
        overlay.querySelector(".lx-modal-home").onclick = () => Workflow.leave("home", flow);
      }
      overlay
        .querySelector(".lx-modal-content")
        .addEventListener("click", (e) => e.stopPropagation());
      return overlay;
    },
    hideModal(id) {
      this._modals.delete(id);
      const el = document.getElementById(id);
      if (el) el.remove();
    },
    closeAllModals(reason) {
      const records = Array.from(this._modals.values());
      this._modals.clear();
      records.forEach(({ element, onDismiss }) => {
        element.remove();
        onDismiss?.(reason);
      });
    },
    showLoading(msg = "处理中...", flow) {
      Workflow.check(flow);
      this.createModal(
        "lx-loading",
        "请稍候",
        `<div style="text-align:center; padding: 40px 0; font-size: 16px; color: #409EFF;">加载中：${escapeHtml(msg)}</div>`,
        undefined,
        false,
        { flow },
      );
    },
    hideLoading(flow) {
      if (flow && this._modals.get("lx-loading")?.flow !== flow) return;
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
      let safeUrl;
      try {
        safeUrl = new URL(String(url), window.location.href);
        if (safeUrl.protocol !== "https:") return null;
      } catch (error) {
        return null;
      }
      return new Promise((resolve) => {
        GM_xmlhttpRequest({
          method: "GET",
          url: safeUrl.href,
          responseType: "arraybuffer",
          onload: (res) => resolve(res.status === 200 ? res.response : null),
          onerror: () => resolve(null),
        });
      });
    },
    generateFilename(shipmentName, fbaId) {
      shipmentName = String(shipmentName || "");
      const anchorMatch = shipmentName.match(/([A-Z0-9]{3,5})-(FBA[A-Z0-9]+)/);
      const now = new Date();
      const pad = (value) => String(value).padStart(2, "0");
      const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
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
    charLength(value) {
      return Array.from(String(value ?? "")).length;
    },
    truncateChars(value, maxLength) {
      return Array.from(String(value ?? "")).slice(0, maxLength).join("");
    },
    formatLocalMMDD(date = new Date()) {
      const pad = (value) => String(value).padStart(2, "0");
      return `${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
    },
    sanitizeWindowsSegment(value, fallback = "未命名", maxLength = 150) {
      // 保留省略号，避免二次清洗时分解成三个点，破坏名称长度限制。
      const clean = (input) =>
        String(input ?? "")
          .split("…").map((part) => part.normalize("NFKC")).join("…")
          .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "")
          .replace(/[<>:"/\\|?*]/g, "-")
          .replace(/\s+/g, " ")
          .trim()
          .replace(/[. ]+$/g, "")
          .replace(/^-+|-+$/g, "");
      let safe = clean(value);
      if (!safe || safe === "." || safe === "..") safe = clean(fallback);
      if (!safe || safe === "." || safe === "..") safe = "未命名";
      if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe)) {
        safe = `_${safe}`;
      }
      if (SharedUtils.charLength(safe) > maxLength) {
        safe = SharedUtils.truncateChars(safe, Math.max(1, maxLength - 1)) + "…";
      }
      return safe;
    },
  };

  const FileHandleStore = {
    _dbPromise: null,
    open() {
      if (this._dbPromise) return this._dbPromise;
      this._dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(CONFIG.FS_DB_NAME, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(CONFIG.FS_STORE_NAME)) {
            db.createObjectStore(CONFIG.FS_STORE_NAME);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("目录记录数据库打开失败"));
        request.onblocked = () => reject(new Error("目录记录数据库被其他页面占用"));
      }).catch((error) => {
        this._dbPromise = null;
        throw error;
      });
      return this._dbPromise;
    },
    async getRoot() {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(CONFIG.FS_STORE_NAME, "readonly");
        const request = tx.objectStore(CONFIG.FS_STORE_NAME).get(CONFIG.FS_ROOT_KEY);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error("读取保存目录失败"));
      });
    },
    async setRoot(handle) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(CONFIG.FS_STORE_NAME, "readwrite");
        tx.objectStore(CONFIG.FS_STORE_NAME).put(handle, CONFIG.FS_ROOT_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("保存目录记录失败"));
        tx.onabort = () => reject(tx.error || new Error("保存目录记录被中止"));
      });
    },
    async clearRoot() {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(CONFIG.FS_STORE_NAME, "readwrite");
        tx.objectStore(CONFIG.FS_STORE_NAME).delete(CONFIG.FS_ROOT_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("清除目录记录失败"));
        tx.onabort = () => reject(tx.error || new Error("清除目录记录被中止"));
      });
    },
  };

  const InvoiceOutputService = {
    _rootHandle: null,
    _readyPromise: null,
    _storageAvailable: true,
    _writeQueue: Promise.resolve(),
    isSupported() {
      return Boolean(
        window.isSecureContext &&
          typeof window.showDirectoryPicker === "function" &&
          typeof indexedDB !== "undefined",
      );
    },
    init() {
      if (this._readyPromise) return this._readyPromise;
      this._readyPromise = (async () => {
        if (!this.isSupported()) return;
        try {
          const handle = await FileHandleStore.getRoot();
          if (
            handle?.kind === "directory" &&
            typeof handle.queryPermission === "function" &&
            typeof handle.requestPermission === "function"
          ) {
            this._rootHandle = handle;
          }
        } catch (error) {
          this._storageAvailable = false;
          console.warn("发票保存目录恢复失败，将仅在本页保留授权:", error);
        }
      })();
      return this._readyPromise;
    },
    async getStatus() {
      await this.init();
      if (!this.isSupported()) {
        return { supported: false, permission: "unsupported", handleName: "" };
      }
      if (!this._rootHandle) {
        return { supported: true, permission: "missing", handleName: "" };
      }
      let permission = "prompt";
      try {
        permission = await this._rootHandle.queryPermission({ mode: "readwrite" });
      } catch (error) {
        permission = "denied";
      }
      return {
        supported: true,
        permission,
        handleName: String(this._rootHandle.name || "已选目录"),
        persistent: this._storageAvailable,
      };
    },
    async chooseRootFromGesture() {
      if (!this.isSupported()) throw new Error("当前浏览器不支持自动保存目录");
      const pickerPromise = window.showDirectoryPicker({
        id: CONFIG.FS_PICKER_ID,
        mode: "readwrite",
        startIn: "documents",
      });
      const handle = await pickerPromise;
      if (handle?.kind !== "directory") throw new Error("没有取得有效目录");
      this._rootHandle = handle;
      try {
        await FileHandleStore.setRoot(handle);
        this._storageAvailable = true;
      } catch (error) {
        this._storageAvailable = false;
        console.warn("目录可在本页使用，但无法长期记住:", error);
      }
      return {
        mode: "filesystem",
        handleName: String(handle.name || "已选目录"),
        persistent: this._storageAvailable,
      };
    },
    prepareForInvoiceFromGesture() {
      if (!this.isSupported()) {
        return Promise.resolve({
          mode: "download",
          reason: "当前浏览器不支持目录写入，将使用普通下载",
        });
      }
      if (!this._rootHandle) return this.chooseRootFromGesture();
      const permissionPromise = this._rootHandle.requestPermission({
        mode: "readwrite",
      });
      return permissionPromise.then((permission) => {
        if (permission !== "granted") {
          const error = new Error("未获得发货目录的写入权限");
          error.code = "DIRECTORY_PERMISSION_DENIED";
          throw error;
        }
        return {
          mode: "filesystem",
          handleName: String(this._rootHandle.name || "已选目录"),
          persistent: this._storageAvailable,
        };
      });
    },
    async forgetRoot() {
      this._rootHandle = null;
      try {
        await FileHandleStore.clearRoot();
      } catch (error) {
        console.warn("清除目录记录失败:", error);
        throw new Error("本页已清除目录，但长期记录删除失败；刷新后可能需要再清除一次");
      }
    },
    buildProductSummaryName(
      stats,
      totalPhysicalBoxes,
      { prefix = "", maxLength = 60, fallback = "箱唛" } = {},
    ) {
      const joinPart = (left, right) => (left ? `${left}--${right}` : right);
      if (!stats.length) return joinPart(prefix, fallback);
      const normalized = stats.map((item) => {
        const label = SharedUtils.sanitizeWindowsSegment(
          item.label,
          item.sku || "未命名商品",
          80,
        );
        return { ...item, label, part: `${label}-${item.boxCount}箱` };
      });
      const fullName = joinPart(prefix, normalized.map((item) => item.part).join("--"));
      const limit = maxLength;
      if (SharedUtils.charLength(fullName) <= limit) return fullName;

      if (normalized.length === 1) {
        const ending = `-${normalized[0].boxCount}箱`;
        const room = Math.max(
          1,
          limit - SharedUtils.charLength(joinPart(prefix, ending)) - 1,
        );
        const label = SharedUtils.truncateChars(normalized[0].label, room) + "…";
        return joinPart(prefix, `${label}${ending}`);
      }

      const suffix = `--等${normalized.length}款-总${totalPhysicalBoxes}箱`;
      let result = prefix;
      let shown = 0;
      for (const item of normalized) {
        const candidate = `${joinPart(result, item.part)}${suffix}`;
        if (SharedUtils.charLength(candidate) > limit) break;
        result = joinPart(result, item.part);
        shown += 1;
      }
      if (shown === 0) {
        const first = normalized[0];
        const ending = `-${first.boxCount}箱`;
        const fixed = `${joinPart(prefix, ending)}${suffix}`;
        const room = Math.max(1, limit - SharedUtils.charLength(fixed) - 1);
        result = joinPart(prefix, `${SharedUtils.truncateChars(first.label, room)}…${ending}`);
      }
      return result + suffix;
    },
    buildBatchFolderName(stats, totalPhysicalBoxes, date = new Date()) {
      return this.buildProductSummaryName(stats, totalPhysicalBoxes, {
        prefix: SharedUtils.formatLocalMMDD(date),
        maxLength: CONFIG.FS_FOLDER_MAX_LENGTH,
        fallback: "发票",
      });
    },
    buildBoxLabelsFilename(stats, totalPhysicalBoxes) {
      return this.buildProductSummaryName(stats, totalPhysicalBoxes, {
        maxLength: CONFIG.BOX_LABEL_FILENAME_MAX_LENGTH,
      }) + ".pdf";
    },
    async beginBatch(folderName, { forceBrowserDownload = false, flow } = {}) {
      Workflow.check(flow);
      await this.init();
      Workflow.check(flow);
      const batch = {
        folderName,
        rootName: String(this._rootHandle?.name || ""),
        directoryHandle: null,
        mode: "download",
        disabledReason: "",
      };
      if (forceBrowserDownload) {
        batch.disabledReason = "本次选择普通下载";
        return batch;
      }
      if (!this.isSupported() || !this._rootHandle) {
        batch.disabledReason = "未授权保存目录";
        return batch;
      }
      try {
        const permission = await this._rootHandle.queryPermission({ mode: "readwrite" });
        Workflow.check(flow);
        if (permission !== "granted") {
          batch.disabledReason = "目录权限已失效";
          return batch;
        }
        batch.directoryHandle = await this._rootHandle.getDirectoryHandle(folderName, {
          create: true,
        });
        Workflow.check(flow);
        batch.mode = "filesystem";
      } catch (error) {
        Workflow.check(flow);
        batch.disabledReason = error?.message || "子目录创建失败";
        console.warn("自动创建发货子目录失败，将改用普通下载:", error);
      }
      return batch;
    },
    withWriteLock(task) {
      if (navigator.locks?.request) {
        return navigator.locks.request(
          "lx-fba-invoice-file-write-v1",
          { mode: "exclusive" },
          task,
        );
      }
      const execution = this._writeQueue.then(task, task);
      this._writeQueue = execution.catch(() => {});
      return execution;
    },
    async filenameExists(directoryHandle, filename) {
      try {
        await directoryHandle.getFileHandle(filename);
        return true;
      } catch (error) {
        if (error?.name === "NotFoundError") return false;
        throw error;
      }
    },
    normalizeExtension(extension) {
      const normalized = String(extension).toLowerCase();
      if (![".xlsx", ".pdf"].includes(normalized)) {
        throw new Error("只允许保存 XLSX 发票或 PDF 箱唛");
      }
      return normalized;
    },
    splitFilename(filename, extension = ".xlsx") {
      const safeExtension = this.normalizeExtension(extension);
      const ending = safeExtension === ".pdf" ? /(?:\.pdf)+$/i : /(?:\.xlsx)+$/i;
      return {
        stem: String(filename).replace(ending, ""),
        extension: safeExtension,
      };
    },
    sanitizeOutputFilename(filename, extension = ".xlsx") {
      const { stem, extension: safeExtension } = this.splitFilename(filename, extension);
      const safeStem = SharedUtils.sanitizeWindowsSegment(
        stem,
        safeExtension === ".pdf" ? "箱唛" : "清关发票",
        safeExtension === ".pdf"
          ? CONFIG.BOX_LABEL_FILENAME_MAX_LENGTH
          : CONFIG.FS_FILENAME_MAX_LENGTH - SharedUtils.charLength(safeExtension),
      );
      return `${safeStem}${safeExtension}`;
    },
    sanitizeXlsxFilename(filename) {
      return this.sanitizeOutputFilename(filename, ".xlsx");
    },
    sanitizePdfFilename(filename) {
      return this.sanitizeOutputFilename(filename, ".pdf");
    },
    async makeUniqueFilename(directoryHandle, requestedName, extension = ".xlsx") {
      const safeName = this.sanitizeOutputFilename(requestedName, extension);
      if (!(await this.filenameExists(directoryHandle, safeName))) return safeName;
      const { stem, extension: safeExtension } = this.splitFilename(safeName, extension);
      for (let index = 2; index < 10000; index++) {
        const ending = `-${index}`;
        const fullLengthLimit = safeExtension === ".pdf"
          ? CONFIG.BOX_LABEL_FILENAME_MAX_LENGTH + SharedUtils.charLength(safeExtension)
          : CONFIG.FS_FILENAME_MAX_LENGTH;
        const room =
          fullLengthLimit -
          SharedUtils.charLength(safeExtension) -
          SharedUtils.charLength(ending);
        const candidate = `${SharedUtils.truncateChars(stem, room)}${ending}${safeExtension}`;
        if (!(await this.filenameExists(directoryHandle, candidate))) return candidate;
      }
      throw new Error("同名文件过多，无法生成安全文件名");
    },
    downloadBlob(blob, filename, extension = ".xlsx") {
      const safeName = this.sanitizeOutputFilename(filename, extension);
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = safeName;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 30000);
      return safeName;
    },
    async saveFile(batch, { blob, filename, fbaId, extension = ".xlsx", flow }) {
      Workflow.check(flow);
      const safeExtension = this.normalizeExtension(extension);
      if (batch.mode === "filesystem" && batch.directoryHandle) {
        try {
          const finalName = await this.withWriteLock(async () => {
            Workflow.check(flow);
            const uniqueName = await this.makeUniqueFilename(
              batch.directoryHandle,
              filename,
              safeExtension,
            );
            Workflow.check(flow);
            let writable = null;
            try {
              const fileHandle = await batch.directoryHandle.getFileHandle(
                uniqueName,
                { create: true },
              );
              Workflow.check(flow);
              writable = await fileHandle.createWritable();
              Workflow.check(flow);
              await writable.write(blob);
              Workflow.check(flow);
              await writable.close();
              return uniqueName;
            } catch (error) {
              if (writable) {
                try {
                  await writable.abort();
                } catch (abortError) {}
              }
              throw error;
            }
          });
          Workflow.check(flow);
          return { fbaId, mode: "filesystem", filename: finalName };
        } catch (error) {
          Workflow.check(flow);
          console.error(`文件 ${fbaId || filename} 写入目录失败:`, error);
          batch.mode = "download";
          batch.disabledReason = error?.message || "写入目录失败";
          const finalName = this.downloadBlob(blob, filename, safeExtension);
          return { fbaId, mode: "download", filename: finalName, error };
        }
      }
      Workflow.check(flow);
      const finalName = this.downloadBlob(blob, filename, safeExtension);
      return { fbaId, mode: "download", filename: finalName };
    },
    saveXlsx(batch, file) {
      return this.saveFile(batch, { ...file, extension: ".xlsx" });
    },
    savePdf(batch, file) {
      return this.saveFile(batch, { ...file, extension: ".pdf" });
    },
  };

  // =================================================================================
  // [3] 数据服务层 (Data Service)
  // =================================================================================
  const DataService = {
    async getPageContext({ flow } = {}) {
      try {
        Workflow.check(flow);
        const vueInstance = document.querySelector(".sta-detail").__vue__;
        if (!vueInstance) throw new Error("无法找到 Vue 实例。");
        const localTaskId = new URLSearchParams(window.location.search).get(
          "localTaskId",
        );
        if (localTaskId && !vueInstance.info) {
          await vueInstance.getDetail(localTaskId);
          Workflow.check(flow);
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
        if (Workflow.isCancelled(e) || !Workflow.isActive(flow)) return null;
        UI.notify.error(e.message);
        return null;
      }
    },
    async getPackingDetails(shipment, vueInstance, { flow } = {}) {
      try {
        Workflow.check(flow);
        const res = await vueInstance.$gwPost(
          "/amz-sta-server/inbound-packing/getShipmentPackingDetail",
          {
            shipmentId: shipment.shipmentId,
            inboundPlanId: shipment.inboundPlanId,
            sid: shipment.sid || vueInstance.info.sid,
          },
        );
        Workflow.check(flow);
        if (res.code === 1 && res.data) return res.data;
        throw new Error(res.msg || "API返回无数据");
      } catch (err) {
        if (Workflow.isCancelled(err) || !Workflow.isActive(flow)) throw err;
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
    async generateBoxLabelsFile(payload, vueInstance) {
      if (!vueInstance?.$gateAxios?.post) throw new Error("未找到领星请求客户端");
      const response = await vueInstance.$gateAxios.post(
        "/api/shipment/downloadBoxLabels",
        payload,
        { timeout: 120000 },
      );
      const body = response?.data?.code != null ? response.data : response;
      const fileId = String(body?.data?.file_id ?? "").trim();
      if (body?.code !== 1 || !/^\d+$/.test(fileId)) {
        throw new Error(body?.msg || "箱唛生成失败，未取得有效文件编号");
      }
      return { fileId, originalName: String(body.data.file_name || "") };
    },
    async validatePdfResponse(data) {
      let blob;
      if (
        data &&
        typeof data.arrayBuffer === "function" &&
        typeof data.slice === "function" &&
        typeof data.size === "number"
      ) {
        blob = new Blob([data], { type: "application/pdf" });
      } else if (
        ArrayBuffer.isView(data) ||
        Object.prototype.toString.call(data) === "[object ArrayBuffer]"
      ) {
        blob = new Blob([data], { type: "application/pdf" });
      } else {
        throw new Error(data?.msg || data?.message || "箱唛下载失败，返回内容不是文件");
      }
      const header = await blob.slice(0, 8).text();
      if (!header.startsWith("%PDF-")) {
        let serverMessage = "";
        try {
          const errorData = JSON.parse(await blob.slice(0, 4096).text());
          serverMessage = String(errorData?.msg || errorData?.message || "").slice(0, 200);
        } catch (error) {}
        throw new Error(serverMessage || "箱唛下载失败，服务器返回的内容不是 PDF");
      }
      return blob;
    },
    async downloadBoxLabelsPdf(fileId, vueInstance) {
      if (!vueInstance?.$gateAxios?.post) throw new Error("未找到领星请求客户端");
      const id = String(fileId ?? "").trim();
      if (!/^\d+$/.test(id)) throw new Error("箱唛文件编号无效");
      const response = await vueInstance.$gateAxios.post(
        "/api/file/downloadById",
        { id },
        { responseType: "blob", timeout: 120000 },
      );
      if (response?.code != null && response.code !== 1) {
        throw new Error(response.msg || "箱唛下载失败");
      }
      return this.validatePdfResponse(response?.data ?? response);
    },
    async updateShipmentName(shipment, rawName, vueInstance) {
      if (!vueInstance?.$gwPost) throw new Error("未找到领星请求客户端");
      const name = String(rawName || "").trim();
      const sid = shipment.sid ?? vueInstance.info?.sid;
      if (!shipment.inboundPlanId || !shipment.shipmentId || sid == null || !name) {
        throw new Error("货件 ID、计划 ID、店铺 ID 或名称缺失");
      }
      if (String(shipment.shipmentName || "").trim() === name) {
        return { status: "skipped", name, message: "名称已是目标值" };
      }
      const path = "/amz-sta-server/inbound-shipment/updateShipmentName";
      const res = await vueInstance.$gwPost(path, {
        inboundPlanId: shipment.inboundPlanId,
        shipmentId: shipment.shipmentId,
        sid,
        name,
      });
      const updated =
        res?.code === 1 &&
        res?.data === true &&
        res?.success !== false;
      const unchanged = res?.code === -1 && res?.msg === "货件名称未修改";
      if (!updated && !unchanged) {
        throw new Error(res?.msg || "货件名称更新失败");
      }
      let localSyncFailed = false;
      try {
        if (typeof vueInstance.$set === "function") {
          vueInstance.$set(shipment, "shipmentName", name);
        } else {
          shipment.shipmentName = name;
        }
      } catch (error) {
        localSyncFailed = true;
        console.warn("名称已写入服务器，但页面本地状态同步失败:", error);
      }
      return {
        status: updated ? "success" : "skipped",
        name,
        message:
          (res?.msg || "操作成功") +
          (localSyncFailed ? "（页面显示可能需要刷新）" : ""),
      };
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
      base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) {
          bytes[index] = binary.charCodeAt(index);
        }
        return bytes.buffer;
      },
      async sha256Hex(buffer) {
        if (!window.crypto?.subtle) throw new Error("当前浏览器不支持模板校验");
        const digest = await window.crypto.subtle.digest("SHA-256", buffer);
        return Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        )
          .join("")
          .toUpperCase();
      },
      async verifyTemplateBase64(base64, expectedHash) {
        if (!expectedHash) return true;
        const actual = await this.sha256Hex(this.base64ToArrayBuffer(base64));
        return actual === String(expectedHash).toUpperCase();
      },
      async runPreprocessor(scriptContent, rawContext) {
        if (
          scriptContent &&
          typeof scriptContent === "string" &&
          scriptContent.trim().startsWith("// js-script")
        ) {
          throw new Error(
            "该模板包含 A1 JavaScript 脚本。为保护已授权的发票目录，V3.4 已停止执行此类模板脚本。",
          );
        }
        return rawContext;
      },
      getProperty(obj, path) {
        if (typeof path !== "string") return undefined;
        const blocked = new Set(["__proto__", "prototype", "constructor"]);
        return path.split(".").reduce((value, key) => {
          if (value == null || !key || blocked.has(key)) return undefined;
          if (!Object.prototype.hasOwnProperty.call(Object(value), key)) {
            return undefined;
          }
          return value[key];
        }, obj);
      },
      resolveImageUrl(expression, scope) {
        const path = String(expression ?? "").trim();
        if (!/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(path)) {
          throw new Error("模板图片仅允许使用一个数据属性路径，不能拼接网址");
        }
        const value = this.getProperty(scope, path);
        if (value == null || value === "") return "";
        let parsed;
        try {
          parsed = new URL(String(value), window.location.href);
        } catch (error) {
          throw new Error(`模板图片地址无效：${path}`);
        }
        if (parsed.protocol !== "https:") {
          throw new Error(`模板图片必须使用 HTTPS：${path}`);
        }
        return parsed.href;
      },
      tokenizeExpression(expression) {
        const source = String(expression ?? "");
        const tokens = [];
        let index = 0;
        while (index < source.length) {
          const char = source[index];
          if (/\s/.test(char)) {
            index += 1;
            continue;
          }
          if (char === "'" || char === '"') {
            const quote = char;
            let value = "";
            let closed = false;
            index += 1;
            while (index < source.length) {
              const current = source[index++];
              if (current === quote) {
                closed = true;
                break;
              }
              if (current === "\\") {
                if (index >= source.length) throw new Error("字符串转义不完整");
                const escaped = source[index++];
                const escapes = {
                  n: "\n",
                  r: "\r",
                  t: "\t",
                  "\\": "\\",
                  "'": "'",
                  '"': '"',
                };
                value += Object.prototype.hasOwnProperty.call(escapes, escaped)
                  ? escapes[escaped]
                  : escaped;
              } else {
                value += current;
              }
            }
            if (!closed) throw new Error("字符串没有结束引号");
            tokens.push({ type: "literal", value });
            continue;
          }
          const numberMatch = source
            .slice(index)
            .match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
          if (numberMatch) {
            tokens.push({ type: "literal", value: Number(numberMatch[0]) });
            index += numberMatch[0].length;
            continue;
          }
          const identifierMatch = source
            .slice(index)
            .match(/^[A-Za-z_$][A-Za-z0-9_$]*/);
          if (identifierMatch) {
            tokens.push({ type: "identifier", value: identifierMatch[0] });
            index += identifierMatch[0].length;
            continue;
          }
          const pair = source.slice(index, index + 2);
          if (pair === "||") {
            tokens.push({ type: "operator", value: pair });
            index += 2;
            continue;
          }
          if ("+-*/%(),.!".includes(char)) {
            tokens.push({ type: "operator", value: char });
            index += 1;
            continue;
          }
          throw new Error(`模板表达式含不支持的字符: ${char}`);
        }
        tokens.push({ type: "eof", value: "" });
        return tokens;
      },
      evaluateInScope(expr, scope) {
        try {
          const tokens = this.tokenizeExpression(expr);
          const blocked = new Set(["__proto__", "prototype", "constructor"]);
          let cursor = 0;
          const peek = () => tokens[cursor];
          const take = () => tokens[cursor++];
          const match = (value) => {
            if (peek()?.type !== "operator" || peek()?.value !== value) return false;
            cursor += 1;
            return true;
          };
          const expect = (value) => {
            if (!match(value)) throw new Error(`模板表达式缺少 ${value}`);
          };
          const readProperty = (value, property) => {
            if (value == null || blocked.has(property)) return undefined;
            if (!Object.prototype.hasOwnProperty.call(Object(value), property)) {
              return undefined;
            }
            return value[property];
          };
          let parseOr;
          const parseArguments = () => {
            const args = [];
            if (match(")")) return args;
            do {
              args.push(parseOr());
            } while (match(","));
            expect(")");
            return args;
          };
          const parsePrimary = () => {
            const token = peek();
            if (token.type === "literal") {
              take();
              return token.value;
            }
            if (match("(")) {
              const value = parseOr();
              expect(")");
              return value;
            }
            if (token.type !== "identifier") {
              throw new Error("模板表达式格式不正确");
            }
            const root = take().value;
            let value;
            if (root === "true") value = true;
            else if (root === "false") value = false;
            else if (root === "null") value = null;
            else if (
              blocked.has(root) ||
              !Object.prototype.hasOwnProperty.call(scope, root)
            ) {
              value = undefined;
            } else {
              value = scope[root];
            }
            let path = root;
            while (match(".")) {
              const propertyToken = take();
              if (propertyToken.type !== "identifier") {
                throw new Error("模板属性名格式不正确");
              }
              const property = propertyToken.value;
              if (blocked.has(property)) throw new Error("模板访问了禁用属性");
              if (match("(")) {
                const args = parseArguments();
                if (path === "helpers" && property === "convertToKg") {
                  value = scope.helpers.convertToKg(...args);
                } else if (property === "split" && typeof value === "string") {
                  value = value.split(String(args[0] ?? ""));
                } else if (property === "pop" && Array.isArray(value)) {
                  value = value.length ? value[value.length - 1] : undefined;
                } else {
                  throw new Error(`模板调用了未授权的方法: ${property}`);
                }
                path = null;
              } else {
                value = readProperty(value, property);
                path = path ? `${path}.${property}` : null;
              }
            }
            if (match("(")) throw new Error("模板不允许直接调用函数");
            return value;
          };
          const parseUnary = () => {
            if (match("!")) return !parseUnary();
            if (match("+")) return Number(parseUnary());
            if (match("-")) return -Number(parseUnary());
            return parsePrimary();
          };
          const parseMultiply = () => {
            let value = parseUnary();
            while (["*", "/", "%"].includes(peek()?.value)) {
              const operator = take().value;
              const right = parseUnary();
              if (operator === "*") value *= right;
              else if (operator === "/") value /= right;
              else value %= right;
            }
            return value;
          };
          const parseAdd = () => {
            let value = parseMultiply();
            while (["+", "-"].includes(peek()?.value)) {
              const operator = take().value;
              const right = parseMultiply();
              value = operator === "+" ? value + right : value - right;
            }
            return value;
          };
          parseOr = () => {
            let value = parseAdd();
            while (match("||")) {
              const right = parseAdd();
              value = value || right;
            }
            return value;
          };
          const result = parseOr();
          if (peek().type !== "eof") throw new Error("模板表达式存在多余内容");
          return result;
        } catch (e) {
          console.warn("模板表达式已忽略:", expr, e.message);
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
    selectShipment(
      shipmentList,
      { title = "第一步：选择要导出的货件", nextText = "下一步", flow } = {},
    ) {
      Workflow.check(flow);
      return new Promise((resolve) => {
        let listHtml = `<label style="margin-bottom:15px;display:block;border-bottom:1px solid #eee;padding-bottom:10px;"><input type="checkbox" id="lx-select-all" checked> <strong>全选 / 全不选</strong></label><ul class="lx-shipment-list">`;
        shipmentList.forEach((s, i) => {
          listHtml += `<li><label><input type="checkbox" name="lx-shipment-cb" value="${i}" checked><div><strong>${escapeHtml(s.shipmentConfirmationId)}</strong> (${escapeHtml(s.warehouseId)})<br><small style="color:#909399;">SKU: ${escapeHtml(s.mskuCount)} 款 | 总箱数: ${escapeHtml(s.boxQuantity)}</small></div></label></li>`;
        });
        listHtml += "</ul>";

        const footer = `<button id="lx-inv-cancel" class="lx-modal-btn lx-modal-btn-secondary">取消</button><button id="lx-inv-next" class="lx-modal-btn lx-modal-btn-primary">${escapeHtml(nextText)}</button>`;
        const modal = UI.createModal(
          "lx-inv-sel-modal",
          title,
          listHtml,
          footer,
          false,
          { flow, onDismiss: () => resolve(null) },
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
          Workflow.leave("close", flow);
        };
        document.getElementById("lx-inv-next").onclick = () => {
          if (!Workflow.isActive(flow) || !modal.isConnected) return;
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

    async getVerifiedBuiltInTemplate(cfg, { flow } = {}) {
      Workflow.check(flow);
      if (!cfg) throw new Error("未找到模板配置");
      const cache = (await GM_getValue(CONFIG.BUILT_IN_CACHE_KEY, {})) || {};
      Workflow.check(flow);
      const cachedBase64 = cache[cfg.url];
      if (cachedBase64) {
        let valid = false;
        try {
          valid = await this.templateHelpers.verifyTemplateBase64(
            cachedBase64,
            cfg.sha256,
          );
        } catch (error) {
          console.warn("缓存模板校验失败:", error);
        }
        Workflow.check(flow);
        if (valid) return { base64: cachedBase64, fromCache: true };
        delete cache[cfg.url];
        await GM_setValue(CONFIG.BUILT_IN_CACHE_KEY, cache);
        Workflow.check(flow);
        UI.notify.warning(`模板校验未通过，正在重新下载：${cfg.name}`);
      }

      const buffer = await SharedUtils.fetchImage(cfg.url);
      Workflow.check(flow);
      if (!buffer) throw new Error(`模板下载失败：${cfg.name}`);
      const base64 = this.templateHelpers.arrayBufferToBase64(buffer);
      const valid = await this.templateHelpers.verifyTemplateBase64(
        base64,
        cfg.sha256,
      );
      Workflow.check(flow);
      if (!valid) {
        throw new Error(
          `模板完整性校验失败：${cfg.name}。为防止模板被意外替换，已停止使用。`,
        );
      }
      cache[cfg.url] = base64;
      await GM_setValue(CONFIG.BUILT_IN_CACHE_KEY, cache);
      Workflow.check(flow);
      return { base64, fromCache: false };
    },

    async selectTemplate({ flow } = {}) {
      Workflow.check(flow);
      const lastSel = await GM_getValue(
        CONFIG.LAST_SELECTED_KEY,
        CONFIG.BUILT_IN_TEMPLATES[0]?.name,
      );
      Workflow.check(flow);
      const userTpl = await GM_getValue(CONFIG.USER_TEMPLATE_KEY);
      Workflow.check(flow);
      let opts = "";
      CONFIG.BUILT_IN_TEMPLATES.forEach((t) => {
        opts += `<option value="${escapeHtml(t.name)}" ${t.name === lastSel ? "selected" : ""}>${escapeHtml(t.name)}</option>`;
      });
      if (userTpl?.data) {
        opts += `<option value="${escapeHtml(CONFIG.CUSTOM_TEMPLATE_IDENTIFIER)}" ${lastSel === CONFIG.CUSTOM_TEMPLATE_IDENTIFIER ? "selected" : ""}>${escapeHtml(userTpl.name)} (自定义)</option>`;
      }

      return new Promise((resolve) => {
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
          false,
          { flow, onDismiss: () => resolve(null) },
        );
        const select = document.getElementById("lx-tpl-select");
        const actions = document.getElementById("lx-tpl-actions");
        const isCurrentModal = () => Workflow.isActive(flow) && modal.isConnected;
        let callbackBusy = false;
        const setCallbackBusy = (value) => {
          callbackBusy = value;
          select.disabled = value;
          modal.querySelector("#lx-upload-btn").disabled = value;
          modal.querySelector("#lx-tpl-next").disabled = value;
          actions.querySelectorAll("button").forEach((button) => { button.disabled = value; });
        };

        const updateBtns = () => {
          actions.innerHTML = "";

          if (select.value === CONFIG.CUSTOM_TEMPLATE_IDENTIFIER) {
            const downloadCustomBtn = document.createElement("button");
            downloadCustomBtn.innerText = "下载当前模板";
            downloadCustomBtn.className = "lx-modal-btn lx-modal-btn-primary";
            downloadCustomBtn.onclick = async () => {
              if (!isCurrentModal() || callbackBusy) return;
              setCallbackBusy(true);
              try {
                const t = await GM_getValue(CONFIG.USER_TEMPLATE_KEY);
                if (!isCurrentModal()) return;
                if (!t?.data) {
                  UI.notify.warning("当前没有可下载的自定义模板");
                  return;
                }
                this.downloadTemplateFromBase64(t.data, t.name || "自定义模板.xlsx");
              } catch (error) {
                if (isCurrentModal()) UI.notify.error(error.message || "读取模板失败");
              } finally {
                if (modal.isConnected) setCallbackBusy(false);
              }
            };
            actions.appendChild(downloadCustomBtn);

            const delBtn = document.createElement("button");
            delBtn.innerText = "删除";
            delBtn.className = "lx-modal-btn lx-modal-btn-danger";
            delBtn.style.marginLeft = "8px";
            delBtn.onclick = async () => {
              if (!isCurrentModal() || callbackBusy) return;
              if (confirm("删除自定义模板？")) {
                setCallbackBusy(true);
                try {
                  await GM_setValue(CONFIG.USER_TEMPLATE_KEY, null);
                  if (!isCurrentModal()) return;
                  UI.notify.success("已删除");
                  UI.hideModal("lx-tpl-modal");
                  resolve(this.selectTemplate({ flow }));
                } catch (error) {
                  if (isCurrentModal()) UI.notify.error(error.message || "删除模板失败");
                } finally {
                  if (modal.isConnected) setCallbackBusy(false);
                }
              }
            };
            actions.appendChild(delBtn);
          } else {
            const downloadCacheBtn = document.createElement("button");
            downloadCacheBtn.innerText = "下载/生成缓存";
            downloadCacheBtn.className = "lx-modal-btn lx-modal-btn-primary";
            downloadCacheBtn.onclick = async () => {
              if (!isCurrentModal() || callbackBusy) return;
              const cfg = CONFIG.BUILT_IN_TEMPLATES.find(
                (t) => t.name === select.value,
              );
              if (!cfg) {
                UI.notify.error("未找到当前模板配置");
                return;
              }
              setCallbackBusy(true);
              UI.showLoading(`正在校验并加载模板：${cfg.name}`, flow);
              try {
                const result = await this.getVerifiedBuiltInTemplate(cfg, { flow });
                Workflow.check(flow);
                if (!modal.isConnected) return;
                UI.hideLoading(flow);
                if (!result.fromCache) UI.notify.success("模板已下载并写入缓存");
                this.downloadTemplateFromBase64(result.base64, cfg.name);
              } catch (error) {
                if (!Workflow.isCancelled(error) && isCurrentModal()) {
                  UI.notify.error(error.message);
                }
              } finally {
                UI.hideLoading(flow);
                if (modal.isConnected) setCallbackBusy(false);
              }
            };
            actions.appendChild(downloadCacheBtn);

            const updBtn = document.createElement("button");
            updBtn.innerText = "强制更新";
            updBtn.className = "lx-modal-btn lx-modal-btn-warning";
            updBtn.style.marginLeft = "8px";
            updBtn.onclick = async () => {
              if (!isCurrentModal() || callbackBusy) return;
              setCallbackBusy(true);
              try {
              const cache =
                (await GM_getValue(CONFIG.BUILT_IN_CACHE_KEY, {})) || {};
              if (!isCurrentModal()) return;
              const cfg = CONFIG.BUILT_IN_TEMPLATES.find(
                (t) => t.name === select.value,
              );

              if (cfg && cache[cfg.url]) {
                delete cache[cfg.url];
                await GM_setValue(CONFIG.BUILT_IN_CACHE_KEY, cache);
                if (!isCurrentModal()) return;
                UI.notify.success("缓存已清空，下次将重新下载");
              } else {
                UI.notify.info("当前模板暂无缓存，无需清空");
              }
              } catch (error) {
                if (isCurrentModal()) UI.notify.error(error.message || "清除缓存失败");
              } finally {
                if (modal.isConnected) setCallbackBusy(false);
              }
            };
            actions.appendChild(updBtn);
          }
        };
        select.onchange = updateBtns;
        updateBtns();

        document.getElementById("lx-upload-btn").onclick = () =>
          isCurrentModal() && !callbackBusy && modal.querySelector("#lx-file-input").click();
        document.getElementById("lx-file-input").onchange = (e) => {
          if (!isCurrentModal() || callbackBusy) return;
          const file = e.target.files[0];
          if (!file) return;
          setCallbackBusy(true);
          const reader = new FileReader();
          reader.onload = async (ev) => {
            try {
            if (!isCurrentModal()) return;
            const base64 = ev.target.result.split(",")[1];
            await GM_setValue(CONFIG.USER_TEMPLATE_KEY, {
              name: file.name,
              data: base64,
            });
            if (!isCurrentModal()) return;
            await GM_setValue(
              CONFIG.LAST_SELECTED_KEY,
              CONFIG.CUSTOM_TEMPLATE_IDENTIFIER,
            );
            if (!isCurrentModal()) return;
            UI.hideModal("lx-tpl-modal");
            UI.notify.success("上传成功");
            resolve(this.selectTemplate({ flow }));
            } catch (error) {
              if (isCurrentModal()) UI.notify.error(error.message || "上传模板失败");
            } finally {
              if (modal.isConnected) setCallbackBusy(false);
            }
          };
          reader.onerror = () => {
            if (isCurrentModal()) {
              UI.notify.error("读取模板文件失败");
              setCallbackBusy(false);
            }
          };
          reader.readAsDataURL(file);
        };

        document.getElementById("lx-tpl-cancel").onclick = () => {
          Workflow.leave("close", flow);
        };
        document.getElementById("lx-tpl-next").onclick = async () => {
          if (!isCurrentModal() || callbackBusy) return;
          setCallbackBusy(true);
          try {
            const val = select.value;
            await GM_setValue(CONFIG.LAST_SELECTED_KEY, val);
            Workflow.check(flow);
            if (!modal.isConnected) return;
            if (val === CONFIG.CUSTOM_TEMPLATE_IDENTIFIER) {
              const t = await GM_getValue(CONFIG.USER_TEMPLATE_KEY);
              Workflow.check(flow);
              if (!modal.isConnected) return;
              UI.hideModal("lx-tpl-modal");
              resolve(t?.data);
              return;
            }
            const cfg = CONFIG.BUILT_IN_TEMPLATES.find((t) => t.name === val);
            UI.showLoading("正在校验并加载模板...", flow);
            const result = await this.getVerifiedBuiltInTemplate(cfg, { flow });
            Workflow.check(flow);
            if (!modal.isConnected) return;
            UI.hideLoading(flow);
            UI.hideModal("lx-tpl-modal");
            resolve(result.base64);
          } catch (error) {
            if (!Workflow.isCancelled(error) && isCurrentModal()) {
              UI.notify.error(error.message);
            }
          } finally {
            UI.hideLoading(flow);
            if (modal.isConnected) setCallbackBusy(false);
          }
        };
      });
    },

    async showConfirmModal(shipments, globalInfo, productMap, { flow } = {}) {
      Workflow.check(flow);
      const savedData = await GM_getValue(CONFIG.STORAGE_KEY, {});
      Workflow.check(flow);
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
        rows += `<tr data-index="${idx}"><td>${escapeHtml(itm.fbaId.slice(0, 12))}...</td><td>${escapeHtml(itm.planItem.sku)}</td><td>${escapeHtml(itm.nameCn)}</td>
                <td><input type="text" value="${escapeHtml(itm.hscode)}" data-f="hscode"></td><td><input type="number" step="0.01" value="${escapeHtml(itm.price)}" data-f="price"></td>
                <td><input type="text" value="${escapeHtml(itm.material)}" data-f="material"></td><td><input type="text" value="${escapeHtml(itm.usage)}" data-f="usage"></td>
                <td><input type="text" value="${escapeHtml(itm.brand)}" data-f="brand"></td><td><input type="text" value="${escapeHtml(itm.model)}" data-f="model"></td></tr>`;
      });

      const batchBtn = (field) =>
        `<br><a href="javascript:void(0)" class="lx-batch-btn" data-batch="${field}" style="font-size:12px; font-weight:normal; color:#409EFF; text-decoration:none; display:inline-block; margin-top:4px;">[批量修改]</a>`;

      // 新增：提取 CONFIG 中的品牌配置，生成下拉框 HTML
      const brandOptionsHtml = CONFIG.DEFAULT_BRAND_OPTIONS.map(
        (b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`,
      ).join("");
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
          { flow, onDismiss: () => resolve(null) },
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
              modal
                .querySelectorAll('input[data-f="brand"]')
                .forEach((input) => (input.value = newVal));
              UI.notify.success(`已将【品牌】批量修改为: ${newVal}`);
              // 自动重置回默认的 "[批量选择]" 状态，方便下次重选
              e.target.value = "";
            }
          };
        }

        document.getElementById("lx-cfm-cancel").onclick = () => {
          Workflow.leave("close", flow);
        };
        document.getElementById("lx-cfm-go").onclick = async () => {
          if (!Workflow.isActive(flow) || !modal.isConnected) return;
          const goButton = modal.querySelector("#lx-cfm-go");
          if (goButton.disabled) return;
          goButton.disabled = true;
          try {
          const newData = await GM_getValue(CONFIG.STORAGE_KEY, {});
          Workflow.check(flow);
          if (!modal.isConnected) return;
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
          Workflow.check(flow);
          if (!modal.isConnected) return;
          UI.hideModal("lx-cfm-modal");
          resolve(allItems);
          } catch (error) {
            if (!Workflow.isCancelled(error) && Workflow.isActive(flow) && modal.isConnected) {
              UI.notify.error(error.message || "保存资料失败");
            }
          } finally {
            if (modal.isConnected) goButton.disabled = false;
          }
        };
      });
    },

    async prefetchPackingDetails(
      groupedEntries,
      vueInstance,
      { outputName = "发票", flow } = {},
    ) {
      Workflow.check(flow);
      const packingByFba = new Map();
      const failures = [];
      let cursor = 0;
      const workerCount = Math.min(2, groupedEntries.length);
      const worker = async () => {
        while (cursor < groupedEntries.length) {
          Workflow.check(flow);
          const current = cursor++;
          const [fbaId, group] = groupedEntries[current];
          const packData = await DataService.getPackingDetails(group.s, vueInstance, { flow });
          Workflow.check(flow);
          if (
            Array.isArray(packData?.shipmentPackingVOS) &&
            packData.shipmentPackingVOS.length > 0
          ) {
            packingByFba.set(fbaId, packData);
          } else failures.push(fbaId);
        }
      };
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
      Workflow.check(flow);
      if (failures.length) {
        throw new Error(
          `${failures.length} 个货件的装箱明细获取失败（${failures.join("、")}），未生成${outputName}，请重试。`,
        );
      }
      return packingByFba;
    },

    buildFolderStats(groupedEntries, packingByFba, shortMap) {
      const productLookup = new Map();
      groupedEntries.forEach(([, group]) => {
        group.items.forEach((item) => {
          const sku = String(item.planItem?.sku || "").trim();
          if (sku && !productLookup.has(sku)) productLookup.set(sku, item);
        });
      });

      const skuTotals = new Map();
      const allBoxesByShipment = new Map();
      groupedEntries.forEach(([fbaId, group], order) => {
        const shipmentKey = String(group.s?.shipmentId || fbaId);
        const packingRows = packingByFba.get(fbaId)?.shipmentPackingVOS || [];
        if (!allBoxesByShipment.has(shipmentKey)) {
          allBoxesByShipment.set(shipmentKey, new Set());
        }
        const shipmentBoxes = allBoxesByShipment.get(shipmentKey);
        packingRows.forEach((packingRow) => {
          const sku = String(packingRow.sku || "").trim();
          const boxId = String(packingRow.boxId || "").trim();
          if (!boxId) return;
          shipmentBoxes.add(boxId);
          if (!sku) return;
          if (!skuTotals.has(sku)) {
            const item = productLookup.get(sku);
            const saved = Object.prototype.hasOwnProperty.call(shortMap, sku)
              ? String(shortMap[sku] || "").trim()
              : "";
            skuTotals.set(sku, {
              sku,
              order,
              label:
                saved ||
                String(item?.planItem?.productName || item?.nameCn || "").trim() ||
                sku,
              boxesByShipment: new Map(),
            });
          }
          const total = skuTotals.get(sku);
          if (!total.boxesByShipment.has(shipmentKey)) {
            total.boxesByShipment.set(shipmentKey, new Set());
          }
          total.boxesByShipment.get(shipmentKey).add(boxId);
        });
      });

      const stats = Array.from(skuTotals.values()).map((item) => ({
        sku: item.sku,
        label: item.label,
        order: item.order,
        boxCount: Array.from(item.boxesByShipment.values()).reduce(
          (sum, boxIds) => sum + boxIds.size,
          0,
        ),
      }));
      stats.sort(
        (left, right) =>
          right.boxCount - left.boxCount ||
          left.label.localeCompare(right.label, "zh-CN") ||
          left.sku.localeCompare(right.sku),
      );
      const totalPhysicalBoxes = Array.from(allBoxesByShipment.values()).reduce(
        (sum, boxIds) => sum + boxIds.size,
        0,
      );
      return { stats, totalPhysicalBoxes };
    },

    notifyInvoiceResults(batch, results) {
      const savedCount = results.filter((item) => item.mode === "filesystem").length;
      const downloadedCount = results.filter((item) => item.mode === "download").length;
      const multiDownloadTip =
        downloadedCount > 1
          ? " 如浏览器只出现一份，请允许当前网站下载多个文件。"
          : "";
      if (savedCount === results.length) {
        UI.notify.success(
          `已生成 ${results.length} 份发票，保存到 ${batch.rootName}\\${batch.folderName}`,
        );
      } else if (savedCount > 0) {
        UI.notify.warning(
          `已生成 ${results.length} 份：${savedCount} 份保存到自动目录，${downloadedCount} 份改用浏览器下载。${multiDownloadTip}`,
        );
      } else {
        const reason = batch.disabledReason ? `（${batch.disabledReason}）` : "";
        UI.notify.warning(
          `已生成 ${results.length} 份发票，均改用浏览器下载${reason}。${multiDownloadTip}`,
        );
      }
    },

    async generateExcel(
      base64,
      items,
      globalInfo,
      vueInstance,
      { forceBrowserDownload = false, flow } = {},
    ) {
      Workflow.check(flow);
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

      const groupedEntries = Object.entries(grouped);
      UI.showLoading(`正在获取 ${groupedEntries.length} 个货件的装箱明细...`, flow);
      const packingByFba = await this.prefetchPackingDetails(
        groupedEntries,
        vueInstance,
        { flow },
      );
      Workflow.check(flow);
      const shortMap =
        (await GM_getValue(CONFIG.SHORT_NAME_STORAGE_KEY, {})) || {};
      Workflow.check(flow);
      const { stats, totalPhysicalBoxes } = this.buildFolderStats(
        groupedEntries,
        packingByFba,
        shortMap,
      );
      if (!stats.length || totalPhysicalBoxes === 0) {
        throw new Error("装箱明细中没有可用于生成目录名称的 SKU 或箱号");
      }
      const folderName = InvoiceOutputService.buildBatchFolderName(
        stats,
        totalPhysicalBoxes,
      );
      const batch = await InvoiceOutputService.beginBatch(folderName, {
        forceBrowserDownload,
        flow,
      });
      Workflow.check(flow);
      const results = [];

      for (const [fbaId, group] of groupedEntries) {
        Workflow.check(flow);
        const { s: shipment, items: groupItems } = group;
        const packData = packingByFba.get(fbaId);

        UI.showLoading(`正在处理 ${fbaId} - 分析装箱算法...`, flow);
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

        UI.showLoading(`正在处理 ${fbaId} - 渲染 Excel...`, flow);
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
        Workflow.check(flow);
        const ws = wb.worksheets[0];
        const pre = ws.getCell("A1").value;
        const finalCtx = await this.templateHelpers.runPreprocessor(pre, ctx);
        Workflow.check(flow);
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
                  const u = this.templateHelpers.resolveImageUrl(imgM[1], scope);
                  if (u) pics.add(u);
                  rowD[cn] = u;
                } else
                  rowD[cn] = this.templateHelpers.evaluateExpression(v, scope);
              });
              inserts.push(rowD);
            });
          });

          UI.showLoading(`正在处理 ${fbaId} - 下载图片 (${pics.size}张)...`, flow);
          const imgBufs = new Map();
          for (const url of pics) {
            Workflow.check(flow);
            const b = await SharedUtils.fetchImage(url);
            Workflow.check(flow);
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
        Workflow.check(flow);
        const blob = new Blob([outBuf], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        const filename = SharedUtils.generateFilename(
          shipment.shipmentName || "",
          fbaId,
        );
        results.push(
          await InvoiceOutputService.saveXlsx(batch, { blob, filename, fbaId, flow }),
        );
        Workflow.check(flow);
      }
      Workflow.check(flow);
      this.notifyInvoiceResults(batch, results);
      return { batch, results };
    },

    async run(contextData, { forceBrowserDownload = false, flow = contextData.flow } = {}) {
      try {
        Workflow.check(flow);
        const shipments = await this.selectShipment(contextData.shipmentList, { flow });
        Workflow.check(flow);
        if (!shipments) return;
        const tpl = await this.selectTemplate({ flow });
        Workflow.check(flow);
        if (!tpl) return;

        UI.showLoading("正在获取产品报关与图片信息...", flow);
        const pMap = await DataService.getProductDetails(
          contextData.globalInfo,
          contextData.vueInstance,
        );
        Workflow.check(flow);
        UI.hideLoading(flow);

        const finalItems = await this.showConfirmModal(
          shipments,
          contextData.globalInfo,
          pMap,
          { flow },
        );
        Workflow.check(flow);
        if (finalItems) {
          await this.generateExcel(
            tpl,
            finalItems,
            contextData.globalInfo,
            contextData.vueInstance,
            { forceBrowserDownload, flow },
          );
          Workflow.check(flow);
        }
      } catch (e) {
        if (Workflow.isCancelled(e) || !Workflow.isActive(flow)) return;
        console.error(e);
        UI.notify.error("生成失败: " + e.message);
      } finally {
        UI.hideLoading(flow);
      }
    },
  };

  // =================================================================================
  // [5] 合并箱唛 PDF 下载 (Box Label Module)
  // =================================================================================
  const BoxLabelModule = {
    getShipmentSid(shipment, contextData) {
      const sid = Number(
        shipment.sid ?? contextData.globalInfo?.sid ?? contextData.vueInstance?.info?.sid,
      );
      if (!Number.isSafeInteger(sid) || sid <= 0) {
        throw new Error("货件缺少有效店铺 ID，不能生成箱唛");
      }
      return sid;
    },
    buildGroupedEntries(shipments, contextData) {
      if (!Array.isArray(shipments) || !shipments.length) {
        throw new Error("请至少选择一个货件");
      }
      const planItemsBySku = new Map(
        (contextData.globalInfo?.inboundPlanItemVOS || []).map((item) => [String(item.sku || "").trim(), item]),
      );
      const seen = new Set();
      return shipments.map((shipment) => {
        const fbaId = String(shipment.shipmentConfirmationId || "").trim().toUpperCase();
        if (!/^FBA[A-Z0-9]+$/.test(fbaId)) {
          throw new Error("货件缺少有效 FBA 确认号，不能生成箱唛");
        }
        if (seen.has(fbaId)) throw new Error(`货件 ${fbaId} 重复，请刷新页面后重试`);
        seen.add(fbaId);
        if (!shipment.shipmentId || !shipment.inboundPlanId) {
          throw new Error(`货件 ${fbaId} 缺少计划 ID 或内部货件 ID`);
        }
        this.getShipmentSid(shipment, contextData);
        return [fbaId, {
          s: shipment,
          items: (shipment.itemList || []).map((item) => {
            const planItem = planItemsBySku.get(String(item.sku || "").trim());
            return { planItem: {
              ...planItem,
              ...item,
              productName: String(item.productName || "").trim() || String(planItem?.productName || "").trim(),
            } };
          }),
        }];
      });
    },
    buildRequestPayload(groupedEntries, packingByFba, contextData, sequence = Date.now()) {
      const data = groupedEntries.map(([fbaId, group]) => {
        const rows = packingByFba.get(fbaId)?.shipmentPackingVOS;
        if (!Array.isArray(rows) || !rows.length) {
          throw new Error(`货件 ${fbaId} 没有装箱明细`);
        }
        const boxIds = new Set();
        rows.forEach((row) => {
          const boxId = String(row.boxId || "").trim();
          if (!boxId || !String(row.sku || "").trim()) {
            throw new Error(`货件 ${fbaId} 的装箱明细缺少箱号或 SKU，请刷新后重试`);
          }
          boxIds.add(boxId);
        });
        const num = boxIds.size;
        const reported = group.s.boxQuantity;
        if (reported != null && String(reported).trim() !== "") {
          const reportedCount = Number(reported);
          if (!Number.isSafeInteger(reportedCount) || reportedCount !== num) {
            throw new Error(`货件 ${fbaId} 的页面箱数与装箱明细不一致，请刷新后重试`);
          }
        }
        return {
          sid: this.getShipmentSid(group.s, contextData),
          shipment_id: fbaId,
          ...CONFIG.BOX_LABEL_PRINT_OPTIONS,
          num,
          page_start_index: 1,
          page_end_index: num,
        };
      });
      return {
        data,
        print_all: 1,
        is_merge: 1,
        req_time_sequence: `/api/shipment/downloadBoxLabels$$${sequence}`,
      };
    },
    async run(contextData) {
      const flow = contextData.flow;
      try {
        Workflow.check(flow);
        const shipments = await InvoiceModule.selectShipment(contextData.shipmentList, {
          title: "第一步：选择要下载箱唛的货件",
          nextText: "下一步：预览箱唛下载",
          flow,
        });
        Workflow.check(flow);
        if (!shipments) return;
        const groupedEntries = this.buildGroupedEntries(shipments, contextData);
        UI.showLoading(`正在获取 ${shipments.length} 个货件的装箱明细...`, flow);
        const packingByFba = await InvoiceModule.prefetchPackingDetails(
          groupedEntries,
          contextData.vueInstance,
          { outputName: "箱唛", flow },
        );
        Workflow.check(flow);
        const payload = this.buildRequestPayload(groupedEntries, packingByFba, contextData);
        const shortMap = (await GM_getValue(CONFIG.SHORT_NAME_STORAGE_KEY, {})) || {};
        Workflow.check(flow);
        const { stats, totalPhysicalBoxes } = InvoiceModule.buildFolderStats(
          groupedEntries,
          packingByFba,
          shortMap,
        );
        if (!stats.length || !totalPhysicalBoxes) {
          throw new Error("没有可用于命名箱唛的商品或箱号");
        }
        this.renderPreview(contextData, {
          payload,
          stats,
          totalPhysicalBoxes,
          shipmentCount: shipments.length,
          filename: InvoiceOutputService.buildBoxLabelsFilename(stats, totalPhysicalBoxes),
          folderName: InvoiceOutputService.buildBatchFolderName(stats, totalPhysicalBoxes),
          generatedFile: null,
        });
      } catch (error) {
        if (Workflow.isCancelled(error) || !Workflow.isActive(flow)) return;
        console.error("箱唛下载准备失败:", error);
        UI.notify.error("箱唛处理失败: " + error.message);
      } finally {
        UI.hideLoading(flow);
      }
    },
    async downloadPrepared(prepared, contextData, { forceBrowserDownload = false } = {}) {
      const flow = contextData.flow;
      Workflow.check(flow);
      if (!prepared.generatedFile) {
        UI.showLoading("正在生成合并箱唛 PDF，请稍候...", flow);
        prepared.generatedFile = await DataService.generateBoxLabelsFile(
          {
            ...prepared.payload,
            req_time_sequence: `/api/shipment/downloadBoxLabels$$${Date.now()}`,
          },
          contextData.vueInstance,
        );
        Workflow.check(flow);
      }
      UI.showLoading("正在下载并校验箱唛 PDF...", flow);
      const blob = await DataService.downloadBoxLabelsPdf(
        prepared.generatedFile.fileId,
        contextData.vueInstance,
      );
      Workflow.check(flow);
      const batch = await InvoiceOutputService.beginBatch(prepared.folderName, {
        forceBrowserDownload,
        flow,
      });
      Workflow.check(flow);
      const result = await InvoiceOutputService.savePdf(batch, {
        blob,
        filename: prepared.filename,
        fbaId: "合并箱唛",
        flow,
      });
      Workflow.check(flow);
      if (result.mode === "filesystem") {
        UI.notify.success(`箱唛已保存：${batch.rootName}\\${batch.folderName}\\${result.filename}`);
      } else if (forceBrowserDownload) {
        UI.notify.success(`箱唛已交给浏览器下载：${result.filename}`);
      } else {
        UI.notify.warning(`箱唛已改用浏览器下载（${batch.disabledReason || "未授权目录"}）：${result.filename}`);
      }
      return { batch, result };
    },
    renderPreview(contextData, prepared) {
      const flow = contextData.flow;
      Workflow.check(flow);
      const body = [
        '<p id="lx-box-label-summary" style="color:#606266;"></p>',
        '<label style="display:block;color:#606266;font-size:13px;">PDF 文件名（不加日期）',
        '<input id="lx-box-label-filename" type="text" readonly style="display:block;width:100%;margin-top:6px;padding:9px;border:1px solid #DCDFE6;border-radius:4px;box-sizing:border-box;"></label>',
        '<div style="margin-top:12px;color:#606266;font-size:13px;">自动归档子目录：<span id="lx-box-label-folder"></span></div>',
        '<textarea id="lx-box-label-products" readonly style="width:100%;height:120px;margin-top:12px;padding:10px;border:1px solid #DCDFE6;border-radius:4px;box-sizing:border-box;resize:vertical;"></textarea>',
        '<p style="color:#909399;font-size:12px;">同一 SKU 跨所选货件合计，按箱数从多到少命名；文件名主体最多 60 字。混装箱会计入各 SKU，但物理总箱数只算一次。</p>',
        '<p style="color:#909399;font-size:12px;">沿用本次箱唛设置：AK100 模板，合并全部箱唛；显示品名及 Made in China，隐藏发货公司名。</p>',
      ].join("");
      const footer = [
        '<button id="lx-box-label-cancel" class="lx-modal-btn lx-modal-btn-secondary">取消</button>',
        '<button id="lx-box-label-browser" class="lx-modal-btn lx-modal-btn-warning">生成并普通下载</button>',
        '<button id="lx-box-label-save" class="lx-modal-btn lx-modal-btn-success">生成并保存到发货目录</button>',
      ].join("");
      const modal = UI.createModal("lx-box-label-preview", "第二步：确认箱唛下载", body, footer, false, { flow });
      modal.querySelector("#lx-box-label-summary").textContent =
        `已选择 ${prepared.shipmentCount} 个货件，共 ${prepared.totalPhysicalBoxes} 箱、${prepared.stats.length} 款 SKU，合并成一个 PDF。`;
      modal.querySelector("#lx-box-label-filename").value = prepared.filename;
      modal.querySelector("#lx-box-label-folder").textContent = prepared.folderName;
      modal.querySelector("#lx-box-label-products").value = prepared.stats
        .map((item) => `${item.label} - ${item.boxCount}箱`).join("\n");
      const cancelButton = modal.querySelector("#lx-box-label-cancel");
      const browserButton = modal.querySelector("#lx-box-label-browser");
      const saveButton = modal.querySelector("#lx-box-label-save");
      let busy = false;
      const setBusy = (value) => {
        busy = value;
        [cancelButton, browserButton, saveButton].forEach((button) => {
          button.disabled = value;
        });
      };
      const handleDownload = async (forceBrowserDownload) => {
        if (busy || !Workflow.isActive(flow)) return;
        setBusy(true);
        try {
          if (!forceBrowserDownload) {
            // 目录授权必须直接由按钮点击触发，不能先等待数据请求。
            const permissionPromise = InvoiceOutputService.prepareForInvoiceFromGesture();
            const output = await permissionPromise;
            Workflow.check(flow);
            if (output.mode === "download") UI.notify.warning(output.reason);
          }
          await this.downloadPrepared(prepared, contextData, { forceBrowserDownload });
          Workflow.check(flow);
          UI.hideModal("lx-box-label-preview");
        } catch (error) {
          if (Workflow.isCancelled(error) || !Workflow.isActive(flow)) return;
          if (error?.name === "AbortError") {
            UI.notify.info("已取消选择目录，尚未开始生成箱唛；也可选择普通下载");
          } else {
            console.error("箱唛下载失败:", error);
            UI.notify.error("箱唛下载失败: " + error.message);
          }
        } finally {
          UI.hideLoading(flow);
          if (modal.isConnected) setBusy(false);
        }
      };
      cancelButton.onclick = () => {
        if (!busy) Workflow.leave("close", flow);
      };
      browserButton.onclick = () => handleDownload(true);
      saveButton.onclick = () => handleDownload(false);
    },
  };

  // =================================================================================
  // [6] 模块 B: 货件命名与 SKU 箱数汇总 (Shipment Naming Module)
  // =================================================================================
  const ShipmentNamingModule = {
    normalizePart(value) {
      return String(value ?? "")
        .trim()
        .replace(/^-+|-+$/g, "");
    },

    formatLocalDate(date = new Date()) {
      const pad = (value) => String(value).padStart(2, "0");
      return [
        String(date.getFullYear()).slice(-2),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
      ].join("");
    },

    getProductLabel(sku, shortMap, productLookup) {
      const saved = Object.prototype.hasOwnProperty.call(shortMap, sku)
        ? String(shortMap[sku] || "").trim()
        : "";
      return (
        saved ||
        String(productLookup.get(sku)?.productName || "").trim() ||
        sku
      );
    },

    async copyText(text, { flow } = {}) {
      if (!Workflow.isActive(flow)) return;
      if (!text) {
        UI.notify.warning("暂无可复制内容");
        return;
      }
      let copied = false;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
          copied = true;
        }
      } catch (error) {}
      if (!Workflow.isActive(flow)) return;
      if (!copied) {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        try {
          textarea.select();
          copied = document.execCommand("copy");
        } catch (error) {
          copied = false;
        } finally {
          textarea.remove();
        }
      }
      if (copied) UI.notify.success("复制成功");
      else UI.notify.error("复制失败，请手动选择文本复制");
    },

    async run(contextData) {
      const flow = contextData.flow;
      try {
        const shortMap =
          (await GM_getValue(CONFIG.SHORT_NAME_STORAGE_KEY, {})) || {};
        Workflow.check(flow);
        const allItemsMap = new Map();

        contextData.shipmentList.forEach((shipment) => {
          (shipment.itemList || []).forEach((item) => {
            const sku = String(item.sku || "").trim();
            if (sku && !allItemsMap.has(sku)) allItemsMap.set(sku, item);
          });
        });

        const products = Array.from(allItemsMap.entries());
        if (!products.length) {
          UI.notify.warning("当前计划无商品");
          return;
        }

        const body = [
          '<p style="color:#909399;font-size:13px;">确认商品简称。简称将用于货件名称和跨货件箱数汇总，并会保留已有 SKU 的历史设置。</p>',
          '<div style="max-height:50vh;overflow:auto;">',
          '<table class="lx-input-table">',
          "<thead><tr><th width=\"60%\">SKU 信息</th><th>商品简称</th></tr></thead>",
          '<tbody id="lx-naming-short-body"></tbody>',
          "</table></div>",
        ].join("");
        const footer = [
          '<button id="lx-naming-short-cancel" class="lx-modal-btn lx-modal-btn-secondary">取消</button>',
          '<button id="lx-naming-short-next" class="lx-modal-btn lx-modal-btn-success">下一步</button>',
        ].join("");

        const modal = UI.createModal(
          "lx-naming-short-modal",
          "确认商品简称",
          body,
          footer,
          false,
          { flow },
        );
        const tbody = modal.querySelector("#lx-naming-short-body");
        const inputRows = [];

        products.forEach(([sku, product]) => {
          const tr = document.createElement("tr");
          const infoCell = document.createElement("td");
          const skuNode = document.createElement("strong");
          skuNode.textContent = sku;
          const nameNode = document.createElement("div");
          nameNode.style.marginTop = "4px";
          nameNode.style.fontSize = "12px";
          nameNode.style.color = "#606266";
          nameNode.textContent = String(product.productName || "");
          infoCell.append(skuNode, nameNode);

          const inputCell = document.createElement("td");
          const input = document.createElement("input");
          input.type = "text";
          input.value =
            String(shortMap[sku] || "").trim() ||
            String(product.productName || "").trim() ||
            sku;
          inputCell.appendChild(input);
          tr.append(infoCell, inputCell);
          tbody.appendChild(tr);
          inputRows.push({ sku, input });
        });

        modal.querySelector("#lx-naming-short-cancel").onclick = () =>
          Workflow.leave("close", flow);

        const nextButton = modal.querySelector("#lx-naming-short-next");
        nextButton.onclick = async () => {
          if (nextButton.disabled || !Workflow.isActive(flow)) return;
          nextButton.disabled = true;
          try {
            const nextMap = { ...shortMap };
            inputRows.forEach(({ sku, input }) => {
              const value = input.value.trim();
              if (value) nextMap[sku] = value;
              else delete nextMap[sku];
            });
            await GM_setValue(CONFIG.SHORT_NAME_STORAGE_KEY, nextMap);
            Workflow.check(flow);
            UI.hideModal("lx-naming-short-modal");
            await this.prepareResult(contextData, nextMap);
          } catch (error) {
            if (Workflow.isCancelled(error) || !Workflow.isActive(flow)) return;
            console.error("货件命名准备失败:", error);
            UI.notify.error("处理失败: " + error.message);
          } finally {
            if (nextButton.isConnected) nextButton.disabled = false;
          }
        };
      } catch (error) {
        if (Workflow.isCancelled(error) || !Workflow.isActive(flow)) return;
        console.error("货件命名模块启动失败:", error);
        UI.notify.error("处理失败: " + error.message);
      }
    },

    async prepareResult(contextData, shortMap) {
      const flow = contextData.flow;
      Workflow.check(flow);
      UI.showLoading("正在获取所有货件装箱明细...", flow);
      try {
        const packingResults = await Promise.all(
          contextData.shipmentList.map(async (shipment, index) => {
            try {
              const packData = await DataService.getPackingDetails(
                shipment,
                contextData.vueInstance,
                { flow },
              );
              return { shipment, index, packData, error: null };
            } catch (error) {
              return { shipment, index, packData: null, error };
            }
          }),
        );
        Workflow.check(flow);
        const lastChannel = String(
          (await GM_getValue(CONFIG.LOGISTICS_CHANNEL_STORAGE_KEY, "")) || "",
        ).trim();
        Workflow.check(flow);
        const model = this.buildModel(
          contextData,
          packingResults,
          shortMap,
        );
        this.renderResultModal(contextData, model, lastChannel);
      } catch (error) {
        if (Workflow.isCancelled(error) || !Workflow.isActive(flow)) return;
        console.error("货件命名数据处理失败:", error);
        UI.notify.error("处理失败: " + error.message);
      } finally {
        UI.hideLoading(flow);
      }
    },

    buildModel({ globalInfo, shipmentList, vueInstance }, packingResults, shortMap) {
      const productLookup = new Map();
      shipmentList.forEach((shipment) => {
        (shipment.itemList || []).forEach((item) => {
          const sku = String(item.sku || "").trim();
          if (sku && !productLookup.has(sku)) productLookup.set(sku, item);
        });
      });

      const productTotals = new Map();
      const sellerName = String(globalInfo.sellerName || "未知店铺");
      const shop = sellerName
        .replace(/-[A-Z]{2,}(\s*-\s*\S+)?$/, "")
        .trim();
      const creator =
        String(
          globalInfo.createByName ||
            vueInstance.$store?.state?.userName ||
            "未知",
        ).trim() || "未知";
      const date = this.formatLocalDate();
      let invalidRecordCount = 0;
      let excludedShipmentCount = 0;

      const rows = packingResults.map(
        ({ shipment, index, packData, error }) => {
          const realShipmentId = String(shipment.shipmentId || "").trim();
          const shipmentKey =
            realShipmentId ||
            String(shipment.shipmentConfirmationId || "shipment-" + index);
          if (!realShipmentId) excludedShipmentCount += 1;
          const packingRows = Array.isArray(packData?.shipmentPackingVOS)
            ? packData.shipmentPackingVOS
            : null;
          const boxesBySku = new Map();

          (packingRows || []).forEach((packingRow) => {
            const sku = String(packingRow.sku || "").trim();
            const boxId = String(packingRow.boxId || "").trim();
            if (!sku || !boxId) {
              invalidRecordCount += 1;
              return;
            }

            if (!boxesBySku.has(sku)) boxesBySku.set(sku, new Set());
            boxesBySku.get(sku).add(boxId);

            // 跨货件汇总严格使用真实 shipmentId + boxId；缺少 ID 的货件不计入总数。
            if (realShipmentId) {
              if (!productTotals.has(sku)) {
                productTotals.set(sku, {
                  sku,
                  label: this.getProductLabel(sku, shortMap, productLookup),
                  boxesByShipment: new Map(),
                });
              }
              const productTotal = productTotals.get(sku);
              if (!productTotal.boxesByShipment.has(shipmentKey)) {
                productTotal.boxesByShipment.set(shipmentKey, new Set());
              }
              productTotal.boxesByShipment.get(shipmentKey).add(boxId);
            }
          });

          const orderedSkus = [];
          const seen = new Set();
          (shipment.itemList || []).forEach((item) => {
            const sku = String(item.sku || "").trim();
            if (sku && boxesBySku.has(sku) && !seen.has(sku)) {
              seen.add(sku);
              orderedSkus.push(sku);
            }
          });
          Array.from(boxesBySku.keys())
            .filter((sku) => !seen.has(sku))
            .sort((a, b) => a.localeCompare(b))
            .forEach((sku) => orderedSkus.push(sku));

          const summaryParts = orderedSkus.map((sku) => {
            const label = this.getProductLabel(sku, shortMap, productLookup);
            return label + "-" + boxesBySku.get(sku).size + "箱";
          });
          const summary = summaryParts.join(" ");
          const destination = this.normalizePart(shipment.warehouseId);
          const fbaId = this.normalizePart(
            shipment.shipmentConfirmationId || shipment.shipmentId,
          );
          const baseName = [shop, creator, date, summary, destination, fbaId]
            .map((part) => this.normalizePart(part))
            .filter(Boolean)
            .join("-");

          let packingError = "";
          if (!packingRows) {
            packingError =
              error?.message || "装箱详情获取失败，不能自动生成名称";
          } else if (!summaryParts.length) {
            packingError = "没有可用于命名的装箱数据";
          }

          return {
            shipment,
            shipmentKey,
            baseName,
            packingError,
            canUpdate:
              !packingError &&
              Boolean(
                shipment.inboundPlanId &&
                  shipment.shipmentId &&
                  (shipment.sid ?? vueInstance.info?.sid) != null,
              ),
            finalName: baseName,
            lastStatus: packingError ? "failed" : "idle",
          };
        },
      );

      const productSummary = Array.from(productTotals.values()).map(
        (product) => {
          const totalBoxes = Array.from(
            product.boxesByShipment.values(),
          ).reduce((sum, boxIds) => sum + boxIds.size, 0);
          return product.label + " - " + totalBoxes + "箱";
        },
      );

      return {
        rows,
        productSummary,
        invalidRecordCount,
        excludedShipmentCount,
      };
    },

    renderResultModal(contextData, model, lastChannel) {
      const flow = contextData.flow;
      Workflow.check(flow);
      const body = [
        '<div style="display:flex;gap:10px;align-items:end;margin-bottom:15px;">',
        '<label style="flex:1;color:#606266;font-size:13px;">统一物流渠道',
        '<input id="lx-channel-all" type="text" placeholder="例如：MH15美西卡派专线海运包税" style="display:block;width:100%;margin-top:6px;padding:9px;border:1px solid #DCDFE6;border-radius:4px;box-sizing:border-box;">',
        "</label>",
        '<button id="lx-channel-apply" class="lx-modal-btn lx-modal-btn-primary">应用到全部</button>',
        "</div>",
        '<p style="margin:0 0 12px;color:#909399;font-size:12px;">固定部分自动生成；每个货件仍可单独修改物流渠道。箱数为该 SKU 在当前货件中的箱数。</p>',
        '<div style="max-height:42vh;overflow:auto;">',
        '<table class="lx-input-table">',
        "<thead><tr><th>货件</th><th>固定名称</th><th>物流渠道</th><th>完整名称预览</th><th>状态</th></tr></thead>",
        '<tbody id="lx-naming-result-body"></tbody>',
        "</table></div>",
        '<div style="margin-top:18px;">',
        '<div style="font-weight:600;color:#303133;margin-bottom:8px;">商品箱数汇总（同一 SKU 跨货件合计）</div>',
        '<textarea id="lx-product-summary" readonly style="width:100%;height:120px;padding:10px;border:1px solid #DCDFE6;border-radius:4px;box-sizing:border-box;resize:vertical;font-family:monospace;"></textarea>',
        '<div id="lx-summary-warning" style="margin-top:6px;color:#E6A23C;font-size:12px;"></div>',
        "</div>",
      ].join("");
      const footer = [
        '<button id="lx-naming-close" class="lx-modal-btn lx-modal-btn-secondary">关闭</button>',
        '<button id="lx-copy-summary" class="lx-modal-btn lx-modal-btn-secondary">复制商品汇总</button>',
        '<button id="lx-copy-names" class="lx-modal-btn lx-modal-btn-secondary">复制全部名称</button>',
        '<button id="lx-retry-failed" class="lx-modal-btn lx-modal-btn-warning" style="display:none;">仅重试失败项</button>',
        '<button id="lx-update-names" class="lx-modal-btn lx-modal-btn-success">一键设置货件名称</button>',
      ].join("");

      const modal = UI.createModal(
        "lx-naming-result-modal",
        "货件命名与箱数汇总",
        body,
        footer,
        true,
        { flow },
      );
      const resultBody = modal.querySelector("#lx-naming-result-body");
      const globalChannelInput = modal.querySelector("#lx-channel-all");
      const applyChannelButton = modal.querySelector("#lx-channel-apply");
      const updateButton = modal.querySelector("#lx-update-names");
      const retryButton = modal.querySelector("#lx-retry-failed");
      const closeButton = modal.querySelector("#lx-naming-close");
      const summaryTextarea = modal.querySelector("#lx-product-summary");
      const warningNode = modal.querySelector("#lx-summary-warning");
      let isUpdating = false;

      globalChannelInput.value = lastChannel;
      summaryTextarea.value = model.productSummary.join("\n");
      const summaryWarnings = [];
      if (model.invalidRecordCount) {
        summaryWarnings.push(
          "已跳过 " +
            model.invalidRecordCount +
            " 条缺少 SKU 或箱号的装箱记录。",
        );
      }
      if (model.excludedShipmentCount) {
        summaryWarnings.push(
          "有 " +
            model.excludedShipmentCount +
            " 个货件缺少 shipmentId，未计入跨货件汇总。",
        );
      }
      warningNode.textContent = summaryWarnings.join(" ");

      const statusConfig = {
        idle: { text: "待更新", color: "#909399" },
        queued: { text: "等待中", color: "#909399" },
        running: { text: "更新中", color: "#409EFF" },
        success: { text: "成功", color: "#67C23A" },
        skipped: { text: "名称未变化", color: "#909399" },
        failed: { text: "失败", color: "#F56C6C" },
      };

      const setRowStatus = (row, status, detail = "") => {
        row.lastStatus = status;
        const config = statusConfig[status] || statusConfig.idle;
        row.statusNode.textContent = detail
          ? config.text + "：" + detail
          : config.text;
        row.statusNode.style.color = config.color;
        row.statusNode.title = detail;
      };

      const refreshPreview = (row) => {
        const channel = this.normalizePart(row.channelInput.value);
        row.finalName = channel
          ? row.baseName + "-" + channel
          : row.baseName;
        row.previewInput.value = row.finalName;
      };

      model.rows.forEach((row) => {
        const tr = document.createElement("tr");

        const shipmentCell = document.createElement("td");
        const fbaNode = document.createElement("strong");
        fbaNode.textContent = String(
          row.shipment.shipmentConfirmationId ||
            row.shipment.shipmentId ||
            "",
        );
        const warehouseNode = document.createElement("div");
        warehouseNode.style.marginTop = "4px";
        warehouseNode.style.fontSize = "12px";
        warehouseNode.style.color = "#909399";
        warehouseNode.textContent = String(row.shipment.warehouseId || "");
        shipmentCell.append(fbaNode, warehouseNode);

        const baseCell = document.createElement("td");
        const baseInput = document.createElement("textarea");
        baseInput.readOnly = true;
        baseInput.value = row.baseName;
        baseInput.style.cssText =
          "width:260px;height:64px;padding:6px;box-sizing:border-box;resize:none;border:1px solid #DCDFE6;border-radius:4px;background:#F5F7FA;";
        baseCell.appendChild(baseInput);

        const channelCell = document.createElement("td");
        row.channelInput = document.createElement("input");
        row.channelInput.type = "text";
        row.channelInput.value = lastChannel;
        row.channelInput.placeholder = "物流渠道";
        row.channelInput.style.minWidth = "190px";
        channelCell.appendChild(row.channelInput);

        const previewCell = document.createElement("td");
        row.previewInput = document.createElement("textarea");
        row.previewInput.readOnly = true;
        row.previewInput.style.cssText =
          "width:300px;height:64px;padding:6px;box-sizing:border-box;resize:none;border:1px solid #DCDFE6;border-radius:4px;background:#F5F7FA;";
        previewCell.appendChild(row.previewInput);

        const statusCell = document.createElement("td");
        row.statusNode = document.createElement("span");
        row.statusNode.style.fontSize = "12px";
        statusCell.appendChild(row.statusNode);

        tr.append(
          shipmentCell,
          baseCell,
          channelCell,
          previewCell,
          statusCell,
        );
        resultBody.appendChild(tr);

        if (!row.canUpdate) {
          row.channelInput.disabled = true;
          setRowStatus(row, "failed", row.packingError || "必要数据缺失");
        } else {
          setRowStatus(row, "idle");
          row.channelInput.addEventListener("input", () => {
            refreshPreview(row);
            if (
              row.lastStatus === "success" ||
              row.lastStatus === "skipped"
            ) {
              setRowStatus(row, "idle");
            }
          });
        }
        refreshPreview(row);
      });

      const setBusy = (busy) => {
        isUpdating = busy;
        updateButton.disabled = busy;
        retryButton.disabled = busy;
        applyChannelButton.disabled = busy;
        globalChannelInput.disabled = busy;
        model.rows.forEach((row) => {
          if (row.canUpdate) row.channelInput.disabled = busy;
        });
      };

      const runBatch = async (retryOnly) => {
        if (isUpdating || !Workflow.isActive(flow)) return;

        const candidateRows = model.rows.filter(
          (row) =>
            row.canUpdate &&
            (!retryOnly || row.lastStatus === "failed"),
        );
        const uniqueRows = new Map();
        candidateRows.forEach((row) => {
          const shipmentId = String(row.shipment.shipmentId);
          if (!uniqueRows.has(shipmentId)) uniqueRows.set(shipmentId, row);
        });
        const targetRows = Array.from(uniqueRows.values());
        if (targetRows.length !== candidateRows.length) {
          console.warn(
            "检测到重复 shipmentId，已避免重复提交:",
            candidateRows.length - targetRows.length,
          );
        }
        if (!targetRows.length) {
          UI.notify.info(
            retryOnly ? "没有需要重试的货件" : "没有可更新的货件",
          );
          return;
        }

        targetRows.forEach((row) => refreshPreview(row));
        const missingChannels = targetRows.filter(
          (row) => !this.normalizePart(row.channelInput.value),
        );
        if (missingChannels.length) {
          missingChannels.forEach((row) =>
            setRowStatus(row, "failed", "请填写物流渠道"),
          );
          UI.notify.warning(
            "有 " + missingChannels.length + " 个货件未填写物流渠道",
          );
          retryButton.style.display = "";
          return;
        }

        const oversizedNames = targetRows.filter(
          (row) => Array.from(row.finalName).length > 100,
        );
        if (oversizedNames.length) {
          oversizedNames.forEach((row) =>
            setRowStatus(
              row,
              "failed",
              "名称 " +
                Array.from(row.finalName).length +
                " 字，最多 100 字",
            ),
          );
          UI.notify.warning(
            "有 " +
              oversizedNames.length +
              " 个名称超过 100 字，请缩短商品简称或物流渠道",
          );
          retryButton.style.display = "";
          return;
        }

        const jobs = targetRows.map((row) => {
          row.channelInput.value = this.normalizePart(
            row.channelInput.value,
          );
          refreshPreview(row);
          setRowStatus(row, "queued");
          return { row, name: row.finalName };
        });

        setBusy(true);
        let cursor = 0;
        let successCount = 0;
        let skippedCount = 0;
        let failedCount = 0;

        const worker = async () => {
          while (true) {
            if (!Workflow.isActive(flow)) return;
            const jobIndex = cursor++;
            if (jobIndex >= jobs.length) return;
            const job = jobs[jobIndex];
            setRowStatus(job.row, "running");
            try {
              const result = await DataService.updateShipmentName(
                job.row.shipment,
                job.name,
                contextData.vueInstance,
              );
              if (!Workflow.isActive(flow)) return;
              if (result.status === "skipped") {
                skippedCount += 1;
                setRowStatus(job.row, "skipped", result.message);
              } else {
                successCount += 1;
                setRowStatus(job.row, "success", result.message);
              }
            } catch (error) {
              if (!Workflow.isActive(flow)) return;
              failedCount += 1;
              console.error(
                "货件名称更新失败:",
                job.row.shipment.shipmentConfirmationId,
                error,
              );
              setRowStatus(job.row, "failed", error.message);
            }
          }
        };

        try {
          await Promise.all(
            Array.from(
              { length: Math.min(2, jobs.length) },
              () => worker(),
            ),
          );
          Workflow.check(flow);
          try {
            await contextData.vueInstance.$nextTick?.();
          } catch (error) {
            console.warn("领星页面状态刷新失败:", error);
          }
          Workflow.check(flow);

          const savedChannel = this.normalizePart(
            globalChannelInput.value,
          );
          if (savedChannel) {
            try {
              await GM_setValue(
                CONFIG.LOGISTICS_CHANNEL_STORAGE_KEY,
                savedChannel,
              );
            } catch (error) {
              console.warn("物流渠道保存失败:", error);
            }
          }
          Workflow.check(flow);
          retryButton.style.display = failedCount ? "" : "none";
          const resultMessage =
            "完成：成功 " +
            successCount +
            "，未变化 " +
            skippedCount +
            "，失败 " +
            failedCount;
          if (failedCount) UI.notify.warning(resultMessage);
          else UI.notify.success(resultMessage);
        } catch (error) {
          if (Workflow.isCancelled(error) || !Workflow.isActive(flow)) return;
          console.error("批量更新货件名称失败:", error);
          UI.notify.error("批量更新失败: " + error.message);
        } finally {
          setBusy(false);
        }
      };

      applyChannelButton.onclick = async () => {
        if (!Workflow.isActive(flow)) return;
        const channel = this.normalizePart(globalChannelInput.value);
        globalChannelInput.value = channel;
        model.rows.forEach((row) => {
          if (!row.canUpdate) return;
          row.channelInput.value = channel;
          refreshPreview(row);
          if (
            row.lastStatus === "success" ||
            row.lastStatus === "skipped"
          ) {
            setRowStatus(row, "idle");
          }
        });
        if (channel) {
          try {
            await GM_setValue(
              CONFIG.LOGISTICS_CHANNEL_STORAGE_KEY,
              channel,
            );
          } catch (error) {
            if (!Workflow.isActive(flow)) return;
            console.warn("物流渠道保存失败:", error);
            UI.notify.warning("渠道已应用，但默认值保存失败");
          }
        }
      };

      modal.querySelector("#lx-copy-summary").onclick = () =>
        this.copyText(summaryTextarea.value, { flow });
      modal.querySelector("#lx-copy-names").onclick = () =>
        this.copyText(
          model.rows
            .filter((row) => row.canUpdate)
            .map((row) => row.finalName)
            .join("\n"),
          { flow },
        );
      updateButton.onclick = () => runBatch(false);
      retryButton.onclick = () => runBatch(true);
      closeButton.onclick = () => {
        if (isUpdating) {
          UI.notify.warning("货件名称正在更新，请稍候");
          return;
        }
        Workflow.leave("close", flow);
      };
    },
  };

  // =================================================================================
  // [7] 核心调度器 (Controller)
  // =================================================================================
  const AppController = {
    init() {
      addGlobalStyle();
      InvoiceOutputService.init();

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
      const flow = Workflow.start("home");
      const outputStatus = await InvoiceOutputService.getStatus();
      if (!Workflow.isActive(flow)) return;
      const html = `
                <div class="lx-menu-cards">
                    <div class="lx-menu-card green" id="lx-btn-naming">
                        <div style="font-size:36px;margin-bottom:15px;">📝</div>
                        <h3>货件命名与箱数汇总</h3>
                        <p>生成名称、汇总箱数并一键写回领星</p>
                    </div>
                    <div class="lx-menu-card blue" id="lx-btn-box-labels">
                        <div style="font-size:36px;margin-bottom:15px;">🏷️</div>
                        <h3>下载箱唛 PDF</h3>
                        <p>合并所选货件，按商品与总箱数命名</p>
                    </div>
                    <div class="lx-menu-card blue" id="lx-btn-inv">
                        <div style="font-size:36px;margin-bottom:15px;">📊</div>
                        <h3>生成清关发票</h3>
                        <p>带图片、合并箱子并导出 Excel</p>
                    </div>
                </div>
                <div style="margin:16px 10px 0;padding:14px 16px;border:1px solid #EBEEF5;border-radius:8px;background:#F8FAFC;">
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
                        <div>
                            <strong style="color:#303133;">发票 / 箱唛自动保存目录</strong>
                            <span id="lx-output-status" style="margin-left:8px;color:#606266;"></span>
                        </div>
                        <div style="display:flex;gap:8px;">
                            <button id="lx-output-choose" class="lx-modal-btn lx-modal-btn-primary" style="padding:7px 12px;">选择目录</button>
                            <button id="lx-output-forget" class="lx-modal-btn lx-modal-btn-secondary" style="padding:7px 12px;">忘记目录</button>
                            <button id="lx-output-browser-download" class="lx-modal-btn lx-modal-btn-warning" style="padding:7px 12px;">发票普通下载</button>
                        </div>
                    </div>
                    <p style="margin:8px 0 0;color:#909399;font-size:12px;">目录授权与当前领星网站关联，请只选择专用的 C:\\发货，不要选整个 C 盘或个人资料目录。生成时会创建“MMDD--商品-箱数”子目录；发票可直接普通下载，箱唛可在预览页选择普通下载。</p>
                </div>
            `;
      const footer = `<button id="lx-menu-cancel" class="lx-modal-btn lx-modal-btn-secondary" style="width: 100%;">关闭</button>`;

      UI.createModal("lx-main-menu", "🚀 请选择 FBA 处理工具", html, footer, false, { flow, allowBack: false });
      document.getElementById("lx-menu-cancel").onclick = () =>
        Workflow.leave("close", flow);

      const statusNode = document.getElementById("lx-output-status");
      const chooseButton = document.getElementById("lx-output-choose");
      const forgetButton = document.getElementById("lx-output-forget");
      const browserDownloadButton = document.getElementById(
        "lx-output-browser-download",
      );
      const renderOutputStatus = (status) => {
        if (!Workflow.isActive(flow)) return;
        if (!status.supported) {
          statusNode.textContent = "当前浏览器不支持，将使用普通下载";
          chooseButton.disabled = true;
          forgetButton.disabled = true;
          return;
        }
        const suffix = status.persistent === false ? "（仅本页有效）" : "";
        if (status.permission === "granted") {
          statusNode.textContent = `已授权：${status.handleName}${suffix}`;
        } else if (status.permission === "prompt") {
          statusNode.textContent = `已记住：${status.handleName}（生成时会请求授权）${suffix}`;
        } else if (status.permission === "denied") {
          statusNode.textContent = `原目录权限已关闭，请重新选择${suffix}`;
        } else {
          statusNode.textContent = "尚未选择";
        }
        chooseButton.textContent = status.handleName ? "更换目录" : "选择目录";
        forgetButton.disabled = !status.handleName;
      };
      renderOutputStatus(outputStatus);

      const launchTool = async (kind, module, options = {}) => {
        if (!Workflow.isActive(flow)) return;
        const toolFlow = Workflow.start(kind);
        UI.hideModal("lx-main-menu");
        UI.showLoading("正在读取当前货件信息...", toolFlow);
        try {
          const ctx = await DataService.getPageContext({ flow: toolFlow });
          Workflow.check(toolFlow);
          UI.hideLoading(toolFlow);
          if (ctx) await module.run({ ...ctx, flow: toolFlow }, options);
        } catch (error) {
          if (Workflow.isCancelled(error) || !Workflow.isActive(toolFlow)) return;
          UI.notify.error(error.message || "工具启动失败");
        } finally {
          UI.hideLoading(toolFlow);
        }
      };
      const launchInvoice = (options = {}) => launchTool("invoice", InvoiceModule, options);

      chooseButton.onclick = async () => {
        if (!Workflow.isActive(flow)) return;
        chooseButton.disabled = true;
        const pickerPromise = InvoiceOutputService.chooseRootFromGesture();
        try {
          const selected = await pickerPromise;
          if (!Workflow.isActive(flow)) return;
          UI.notify.success(
            `已选择发货保存目录：${selected.handleName}${selected.persistent ? "" : "（仅本页有效）"}`,
          );
        } catch (error) {
          if (!Workflow.isActive(flow)) return;
          if (error?.name !== "AbortError") UI.notify.error(error.message);
        } finally {
          if (Workflow.isActive(flow)) {
            renderOutputStatus(await InvoiceOutputService.getStatus());
            if (Workflow.isActive(flow)) chooseButton.disabled = false;
          }
        }
      };

      forgetButton.onclick = async () => {
        if (!Workflow.isActive(flow)) return;
        forgetButton.disabled = true;
        try {
          await InvoiceOutputService.forgetRoot();
          if (!Workflow.isActive(flow)) return;
          UI.notify.success("已忘记发货保存目录");
        } catch (error) {
          if (!Workflow.isActive(flow)) return;
          UI.notify.error(error.message || "清除目录记录失败");
        } finally {
          if (Workflow.isActive(flow)) renderOutputStatus(await InvoiceOutputService.getStatus());
        }
      };

      browserDownloadButton.onclick = async () => {
        browserDownloadButton.disabled = true;
        try {
          await launchInvoice({ forceBrowserDownload: true });
        } catch (error) {
          console.error("普通下载启动失败:", error);
          UI.notify.error(error.message || "普通下载启动失败");
        }
      };

      document.getElementById("lx-btn-inv").onclick = async () => {
        if (!Workflow.isActive(flow)) return;
        const invoiceCard = document.getElementById("lx-btn-inv");
        invoiceCard.style.pointerEvents = "none";
        invoiceCard.style.opacity = "0.65";
        try {
          const permissionPromise =
            InvoiceOutputService.prepareForInvoiceFromGesture();
          const output = await permissionPromise;
          if (!Workflow.isActive(flow)) return;
          if (output.mode === "download") UI.notify.warning(output.reason);
          await launchInvoice();
        } catch (error) {
          if (!Workflow.isActive(flow)) return;
          if (error?.name === "AbortError") {
            UI.notify.info("已取消选择目录，尚未开始生成发票");
          } else {
            UI.notify.error(error.message || "发票目录授权失败");
          }
          if (invoiceCard.isConnected && Workflow.isActive(flow)) {
            renderOutputStatus(await InvoiceOutputService.getStatus());
          }
        } finally {
          if (invoiceCard.isConnected) {
            invoiceCard.style.pointerEvents = "";
            invoiceCard.style.opacity = "";
          }
        }
      };

      document.getElementById("lx-btn-naming").onclick = async () => {
        await launchTool("naming", ShipmentNamingModule);
      };

      document.getElementById("lx-btn-box-labels").onclick = async () => {
        await launchTool("box-labels", BoxLabelModule);
      };
    },
  };

  AppController.init();
})();
