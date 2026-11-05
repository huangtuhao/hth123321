// ==UserScript==
// @name         沃尔玛竞品快照
// @namespace    https://local.wm-snapshot
// @version      0.5.0
// @description  沃尔玛竞品快照：详情页面板（嵌入页面，含评论节奏）、搜索页竞争汇总与卡片标注；本地累积历史，可导出 CSV
// @author       local
// @match        https://www.walmart.com/ip/*
// @match        https://www.walmart.com/search*
// @match        https://www.walmart.com/browse/*
// @updateURL    http://127.0.0.1:32145/userscripts/沃尔玛竞品快照.user.js
// @downloadURL  http://127.0.0.1:32145/userscripts/沃尔玛竞品快照.user.js
// @run-at       document-idle
// @noframes
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
  'use strict';

  const STORE_KEY = 'wm_snap_v1';
  const PANEL_ID = 'wm-snapshot-host';
  const MAX_RECORDS = 8000;
  // 面板上显示版本号：截图即可确认浏览器里跑的是哪一版
  const VER = '0.5.0';

  /* ---------------- 存储 ---------------- */
  function hasGM() {
    return typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
  }
  function loadStore() {
    const empty = { firstSeen: {}, records: [] };
    try {
      const raw = hasGM() ? GM_getValue(STORE_KEY, '') : localStorage.getItem(STORE_KEY);
      if (!raw) return empty;
      const o = JSON.parse(raw);
      if (!o || typeof o !== 'object') return empty;
      o.firstSeen = o.firstSeen || {};
      o.records = Array.isArray(o.records) ? o.records : [];
      return o;
    } catch (e) {
      return empty;
    }
  }
  function saveStore(o) {
    try {
      if (o.records.length > MAX_RECORDS) o.records = o.records.slice(-MAX_RECORDS);
      const raw = JSON.stringify(o);
      if (hasGM()) GM_setValue(STORE_KEY, raw);
      else localStorage.setItem(STORE_KEY, raw);
      return true;
    } catch (e) {
      console.warn('[沃尔玛快照] 保存失败', e);
      return false;
    }
  }
  function copyText(t) {
    if (typeof GM_setClipboard === 'function') { GM_setClipboard(t); return true; }
    try { navigator.clipboard.writeText(t); return true; } catch (e) { return false; }
  }

  /* ---------------- 日期 ---------------- */
  const pad = (n) => String(n).padStart(2, '0');
  function todayStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function daysBetween(a, b) {
    const ms = new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime();
    return Math.round(ms / 86400000);
  }

  /* ---------------- 取数 ---------------- */
  function extract() {
    const nd = document.getElementById('__NEXT_DATA__');
    if (!nd) return null;
    let j;
    try { j = JSON.parse(nd.textContent); } catch (e) { return null; }
    const d = j && j.props && j.props.pageProps && j.props.pageProps.initialData
      ? j.props.pageProps.initialData.data : null;
    if (!d || !d.product) return null;

    const p = d.product;
    const urlWid = (location.pathname.match(/\/ip\/[^/]*\/(\d{6,})/) || [])[1] || null;
    const wid = p.usItemId || urlWid || null;
    if (!wid) return null;

    const price = p.priceInfo || {};
    const cur = price.currentPrice || {};
    const was = price.wasPrice || {};
    const rv = d.reviews || {};
    const idml = d.idml || {};
    const specs = Array.isArray(idml.specifications) ? idml.specifications : [];
    const fs = (p.fulfillmentSummary && p.fulfillmentSummary[0]) || null;
    const fl = (p.fulfillmentLabel && p.fulfillmentLabel[0]) || null;
    const ret = p.returnPolicy || {};

    const stars = {
      5: rv.ratingValueFiveCount, 4: rv.ratingValueFourCount, 3: rv.ratingValueThreeCount,
      2: rv.ratingValueTwoCount, 1: rv.ratingValueOneCount
    };

    return {
      wid: String(wid),
      title: p.name || '',
      brand: p.brand || '',
      seller: p.sellerDisplayName || '',
      sellerType: p.sellerType || '',
      sellerRating: (p.sellerAverageRating === 0 ? null : p.sellerAverageRating),
      sellerReviews: (p.sellerReviewCount === 0 ? null : p.sellerReviewCount),
      wfs: p.wfsEnabled === true,
      fulfillmentType: p.fulfillmentType || '',
      offerCount: (typeof p.transactableOfferCount === 'number' ? p.transactableOfferCount : null),
      conditionOffers: Array.isArray(p.conditionOffers) ? p.conditionOffers.length : null,
      price: (typeof cur.price === 'number' ? cur.price : null),
      wasPrice: (typeof was.price === 'number' ? was.price : null),
      savings: (price.savingsAmount && typeof price.savingsAmount.amount === 'number') ? price.savingsAmount.amount : null,
      priceReduced: price.isPriceReduced === true,
      rating: (typeof p.averageRating === 'number' ? p.averageRating : null),
      reviews: (typeof p.numberOfReviews === 'number' ? p.numberOfReviews : null),
      stars: stars,
      recommendPct: (typeof rv.recommendedPercentage === 'number' ? rv.recommendedPercentage : null),
      images: (p.imageInfo && Array.isArray(p.imageInfo.allImages)) ? p.imageInfo.allImages.length : null,
      specCount: specs.length,
      specs: specs,
      images2: null,
      upc: p.upc || '',
      category: (p.category && Array.isArray(p.category.path)) ? p.category.path.map((x) => x.name).join(' > ') : '',
      avail: p.availabilityStatus || '',
      orderLimit: p.orderLimit || null,
      slaDays: fs && typeof fs.calculatedSlaDays === 'number' ? fs.calculatedSlaDays : null,
      deliveryText: fl ? (fl.message || '') : '',
      returnDays: (ret.returnWindow && ret.returnWindow.value) || null,
      freeReturns: ret.freeReturns === true,
      url: location.href.split('?')[0]
    };
  }

  /* ---------------- 存一条记录 ---------------- */
  function record(data) {
    const store = loadStore();
    const today = todayStr();
    if (!store.firstSeen[data.wid]) store.firstSeen[data.wid] = today;
    const idx = store.records.findIndex((r) => r.wid === data.wid && r.date === today);
    const rec = Object.assign({ wid: data.wid, date: today, ts: new Date().toISOString() }, data);
    if (idx >= 0) store.records[idx] = rec; else store.records.push(rec);
    saveStore(store);
    return { firstSeen: store.firstSeen[data.wid], records: store.records.length };
  }

  /* ---------------- CSV ---------------- */
  const CSV_COLS = [
    ['wid', 'WID'], ['date', '记录日期'], ['title', '标题'], ['brand', '品牌'],
    ['seller', '卖家'], ['sellerType', '卖家类型'], ['wfs', '是否WFS'],
    ['offerCount', '在售报价数'], ['conditionOffers', '其他成色报价数'],
    ['price', '现价'], ['wasPrice', '划线价'], ['savings', '节省'], ['priceReduced', '是否降价'],
    ['rating', '评分'], ['reviews', '评论数'], ['specCount', '规格条数'], ['images', '图片数'],
    ['upc', 'UPC'], ['category', '类目'], ['slaDays', '配送天数'], ['deliveryText', '送达文案'],
    ['returnDays', '退货天数'], ['avail', '库存状态'], ['orderLimit', '订单上限'],
    ['sellerRating', '卖家评分'], ['sellerReviews', '卖家评论数'],
    ['latestReview', '最新评论日'], ['reviewDaysSince', '最新评论距今天数'],
    ['reviewRateRecent', '近期月评论'], ['reviewRateLife', '全周期月评论'],
    ['url', '链接']
  ];
  function csvCell(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? '是' : '否';
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportCsv() {
    const store = loadStore();
    if (!store.records.length) { alert('还没有任何记录。请先在沃尔玛商品页打开本面板（会自动记录）。'); return; }
    const head = ['首次见到', '距今天数'].concat(CSV_COLS.map((c) => c[1]));
    const lines = [head.join(',')];
    store.records.forEach((r) => {
      const first = store.firstSeen[r.wid] || r.date;
      const row = [first, daysBetween(first, r.date)];
      CSV_COLS.forEach((c) => row.push(csvCell(r[c[0]])));
      lines.push(row.map(csvCell).join(','));
    });
    const csv = '\ufeff' + lines.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'walmart-snapshot-' + todayStr() + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  /* ---------------- 面板 ---------------- */
  const CSS = `
  :host{all:initial}
  .wrap{background:#fff;border:1px solid #e3e4e5;border-radius:8px;box-sizing:border-box;width:100%;
    font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;font-size:13px;color:#1a1a1a}
  .wrap.float{position:fixed;bottom:20px;right:16px;width:312px;max-height:calc(100vh - 150px);overflow:auto;
    border-radius:12px;border:0.5px solid rgba(0,0,0,.18);box-shadow:0 6px 24px rgba(0,0,0,.12);z-index:2147483000}
  .body{display:block}
  .cols{display:grid;grid-template-columns:1fr;gap:0}
  .head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 14px;
    background:#f7f7f7;border-bottom:1px solid #e3e4e5;border-radius:8px 8px 0 0}
  .wid{font-size:13px;font-weight:600;letter-spacing:.2px}
  .sub{font-size:11px;color:#6b6b6b;margin-top:2px}
  .tag{font-size:11px;padding:1px 7px;border-radius:999px;border:0.5px solid #cfcfcf;color:#555;white-space:nowrap}
  .tag.wfs{border-color:#0a7d47;color:#0a7d47}
  .tag.self{border-color:#8a6d00;color:#8a6d00}
  .sec{padding:9px 14px;border-top:1px solid #f0f0f0}
  .sec-h{font-size:10.5px;letter-spacing:.6px;color:#8a8a8a;margin:0 0 5px;text-transform:uppercase}
  .row{display:flex;justify-content:space-between;gap:10px;line-height:1.7}
  .k{color:#6b6b6b;flex:0 0 auto}
  .v{text-align:right;word-break:break-word;font-variant-numeric:tabular-nums}
  .v.muted{color:#9a9a9a}
  .v.warn{color:#b3261e}
  .v.good{color:#0a7d47}
  .bars{display:flex;gap:2px;margin-top:5px;height:6px;border-radius:3px;overflow:hidden;background:#eee}
  .bars i{display:block;height:100%}
  .tl{position:relative;height:20px;margin:7px 0 2px}
  .tl .ax{position:absolute;left:0;right:0;top:9px;height:1px;background:#e2e2e2}
  .tl .dt{position:absolute;top:5px;width:6px;height:6px;border-radius:50%;background:#0071dc;transform:translateX(-3px)}
  .acts{display:flex;gap:6px;padding:9px 14px;border-top:1px solid #e3e4e5;background:#fafafa;border-radius:0 0 8px 8px}
  button{flex:1;font:inherit;font-size:12px;padding:6px 4px;border-radius:6px;border:1px solid #d6d6d6;
    background:#fff;color:#1a1a1a;cursor:pointer}
  button:hover{background:#f0f0f0}
  button.primary{border-color:#0071dc;color:#0071dc}
  .foot{padding:7px 14px 9px;font-size:11px;color:#9a9a9a;line-height:1.6;border-top:1px solid #f0f0f0}
  .cbt{position:fixed;bottom:20px;right:16px;z-index:2147483000;background:#0071dc;color:#fff;
    font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;font-size:12px;
    padding:7px 11px;border-radius:8px;cursor:pointer;box-shadow:0 3px 12px rgba(0,0,0,.2)}
  `;

  /* ---------------- 挂载：优先嵌入页面，失败才悬浮 ---------------- */
  function wide(h, min, max) {
    const w = h.getBoundingClientRect().width;
    return w >= min && w <= max;
  }

  function mountDetail(host) {
    const bb = document.querySelector('[data-testid="buyBox-container"]')
      || document.querySelector('[data-testid="tempo-driven-buy-box-container"]');

    if (bb && bb.parentElement) {
      bb.parentElement.insertBefore(host, bb.nextSibling);
      if (wide(host, 240, 1200)) return 'embedded';
      // 被塞进了横向 flex 行：改挂到最近的窄列末尾
      host.remove();
      let a = bb;
      for (let i = 0; i < 6 && a.parentElement; i++) {
        if (wide(a, 280, 820)) {
          a.appendChild(host);
          if (wide(host, 240, 1200)) return 'embedded';
          host.remove();
          break;
        }
        a = a.parentElement;
      }
    }

    const reg = Array.prototype.slice.call(document.querySelectorAll('button, a'))
      .filter(function (e) { return (e.textContent || '').trim() === 'Add to registry'; })[0];
    if (reg) {
      let a = reg;
      for (let i = 0; i < 6 && a.parentElement; i++) {
        if (wide(a, 280, 820)) {
          a.appendChild(host);
          if (wide(host, 240, 1200)) return 'embedded';
          host.remove();
          break;
        }
        a = a.parentElement;
      }
    }

    const fw = wrapEl(host);
    if (fw) fw.classList.add('float');
    host.style.cssText = '';
    document.body.appendChild(host);
    return 'floating';
  }

  // host 的样式都在 Shadow DOM 里，host.querySelector 取不到，必须走 shadowRoot
  function wrapEl(host) {
    return host.shadowRoot ? host.shadowRoot.querySelector('.wrap') : null;
  }

  function mountSearch(host) {
    host.style.cssText = 'display:block;width:100%;margin:0 0 12px;';

    function tryInto(node, before) {
      if (!node) return false;
      node.insertBefore(host, before === undefined ? node.firstChild : before);
      const r = host.getBoundingClientRect();
      // 宽度合理 + 没有被父容器的固定行高裁掉（scrollHeight 明显大于实际高度 = 被裁）
      const okW = r.width >= 360 && r.width <= 2400;
      const okH = r.height >= 28 && r.height + 4 >= host.scrollHeight;
      if (okW && okH) return true;
      host.remove();
      return false;
    }

    // ① 找结果网格：从第一个卡片向上，取「包含 ≥3 个卡片的最近祖先」
    const cards = document.querySelectorAll('[data-item-id]');
    if (cards.length >= 3) {
      let a = cards[0];
      let grid = null;
      for (let i = 0; i < 8 && a.parentElement; i++) {
        a = a.parentElement;
        if (a.querySelectorAll('[data-item-id]').length >= 3) { grid = a; break; }
      }
      if (grid) {
        let isGrid = false;
        try { isGrid = /grid/.test(getComputedStyle(grid).display); } catch (e) { }
        // CSS Grid 容器：让它横跨整行，避免被挤成一列
        if (isGrid) host.style.gridColumn = '1 / -1';
        if (tryInto(grid)) return 'embedded';
        host.style.gridColumn = '';
        // 网格是 flex 行时，改插到网格前面（正常块级流）
        if (grid.parentElement && tryInto(grid.parentElement, grid)) return 'embedded';
      }
    }

    // ② 文本锚点：插到「Results for ...」标题块之后
    const heading = Array.prototype.slice.call(document.querySelectorAll('h1, h2'))
      .filter(function (e) {
        const t = (e.textContent || '').trim();
        return /^Results for\s/i.test(t) && t.length < 160;
      })[0];
    if (heading && heading.parentElement) {
      if (tryInto(heading.parentElement, heading.nextSibling)) return 'embedded';
    }

    // ③ 兜底：悬浮到右下角（右下永远不会被吸顶导航盖住）
    host.style.cssText = 'display:block;';
    const w = wrapEl(host);
    if (w) w.classList.add('float');
    document.body.appendChild(host);
    return 'floating';
  }


  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }
  function row(k, v, cls) {
    const r = el('div', 'row');
    r.appendChild(el('span', 'k', k));
    r.appendChild(el('span', 'v' + (cls ? ' ' + cls : ''), v));
    return r;
  }
  function fmtMoney(n) { return (n === null || n === undefined) ? '—' : '$' + n.toFixed(2); }
  function nz(n) { return (n === null || n === undefined || n === '') ? '—' : n; }
  function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

  function render(data, meta) {
    const oldHost = document.getElementById(PANEL_ID);
    if (oldHost) oldHost.remove();

    const host = document.createElement('div');
    host.id = PANEL_ID;
    host.style.cssText = 'display:block;width:100%;margin:14px 0;';
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);

    const collapsed = (function () {
      try { return (hasGM() ? GM_getValue('wm_panel_collapsed', '0') : localStorage.getItem('wm_panel_collapsed')) === '1'; }
      catch (e) { return false; }
    })();

    if (collapsed) {
      const bar = el('div', 'wrap');
      bar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 14px;cursor:pointer';
      bar.appendChild(el('span', '', '沃尔玛快照 · WID ' + data.wid));
      bar.appendChild(el('span', 'sub', '展开 ▸'));
      bar.onclick = function () {
        try { if (hasGM()) GM_setValue('wm_panel_collapsed', '0'); else localStorage.setItem('wm_panel_collapsed', '0'); } catch (e) { }
        render(data, meta);
      };
      root.appendChild(bar);
      mountDetail(host);
      return;
    }

    const wrap = el('div', 'wrap');

    const head = el('div', 'head');
    const hl = el('div');
    hl.appendChild(el('div', 'wid', 'WID ' + data.wid));
    hl.appendChild(el('div', 'sub', (data.brand ? data.brand + ' · ' : '') + (data.category ? data.category.split(' > ').pop() : '')));
    const hr = el('div');
    const isWalmart = /^walmart\.com$/i.test(data.seller || '') || data.sellerType === 'INTERNAL';
    const tag = el('span', 'tag' + (isWalmart ? ' self' : ''), isWalmart ? '沃尔玛自营' : (data.sellerType === 'EXTERNAL' ? '第三方' : (data.sellerType || '卖家')));
    hr.appendChild(tag);
    head.appendChild(hl); head.appendChild(hr);

    const collapse = el('div', 'cbt', '');
    wrap.appendChild(head);

    const sec1 = el('div', 'sec');
    sec1.appendChild(el('div', 'sec-h', '竞争'));
    sec1.appendChild(row('卖家', nz(data.seller)));
    sec1.appendChild(row('履约', data.wfs ? 'WFS 仓发' : (data.fulfillmentType || '—'), data.wfs ? 'good' : null));
    sec1.appendChild(row('在售报价', data.offerCount === null ? '—' : (data.offerCount + ' 个' + (data.offerCount <= 1 ? ' · 独家' : ''))));
    if (data.conditionOffers !== null) sec1.appendChild(row('其他成色报价', data.conditionOffers + ' 个'));
    sec1.appendChild(row('卖家评分', data.sellerRating === null ? '无评分' : (data.sellerRating + ' / ' + nz(data.sellerReviews) + ' 评'), data.sellerRating === null ? 'muted' : null));
    endSec();

    const sec2 = el('div', 'sec');
    sec2.appendChild(el('div', 'sec-h', '价格与履约'));
    sec2.appendChild(row('现价', fmtMoney(data.price)));
    if (data.wasPrice !== null) sec2.appendChild(row('划线价', fmtMoney(data.wasPrice)));
    if (data.savings !== null) sec2.appendChild(row('节省', fmtMoney(data.savings) + (data.priceReduced ? ' · 已降价' : '')));
    sec2.appendChild(row('配送', data.slaDays !== null ? (data.slaDays + ' 天送达') : '—'));
    if (data.deliveryText) sec2.appendChild(row('送达文案', data.deliveryText.replace(/^Free shipping, /, ''), 'muted'));
    sec2.appendChild(row('退货', data.returnDays ? (data.returnDays + ' 天' + (data.freeReturns ? ' 免费' : '')) : '—'));
    if (data.avail) sec2.appendChild(row('库存', data.avail === 'IN_STOCK' ? '有货' : data.avail, data.avail === 'IN_STOCK' ? 'good' : 'warn'));

    const sec3 = el('div', 'sec');
    sec3.appendChild(el('div', 'sec-h', '口碑与内容'));
    sec3.appendChild(row('评分', data.rating === null ? '—' : (data.rating.toFixed(1) + ' · ' + nz(data.reviews) + ' 条')));
    if (data.stars && (data.stars[5] !== undefined)) {
      const s = data.stars;
      const total = (s[5] || 0) + (s[4] || 0) + (s[3] || 0) + (s[2] || 0) + (s[1] || 0);
      if (total > 0) {
        const bars = el('div', 'bars');
        const colors = { 5: '#0a7d47', 4: '#4c9a2a', 3: '#c9a227', 2: '#d97a1f', 1: '#b3261e' };
        [5, 4, 3, 2, 1].forEach(function (k) {
          if (!s[k]) return;
          const i = document.createElement('i');
          i.style.width = (s[k] / total * 100) + '%';
          i.style.background = colors[k];
          i.title = k + '星 ' + s[k];
          bars.appendChild(i);
        });
        sec3.appendChild(bars);
        sec3.appendChild(row('星级分布', s[5] + ' / ' + s[4] + ' / ' + s[3] + ' / ' + s[2] + ' / ' + s[1], 'muted'));
      }
    }
    sec3.appendChild(row('规格条数', data.specCount === 0 ? '0 条' : (data.specCount + ' 条'), data.specCount < 6 ? 'warn' : null));
    sec3.appendChild(row('主图', nz(data.images) + ' 张'));
    if (data.upc) sec3.appendChild(row('UPC', data.upc, 'muted'));

    const sec4 = el('div', 'sec');
    sec4.appendChild(el('div', 'sec-h', '追踪'));
    const days = daysBetween(meta.firstSeen, todayStr());
    sec4.appendChild(row('首次记录', meta.firstSeen + (days > 0 ? '（第 ' + (days + 1) + ' 天）' : '（今天）')));
    sec4.appendChild(row('本地记录数', meta.records + ' 条'));

    const sec5 = reviewSection();

    const acts = el('div', 'acts');
    const b1 = el('button', 'primary', '导出 CSV');
    b1.onclick = exportCsv;
    const b2 = el('button', '', '复制数据');
    b2.onclick = function () {
      copyText(JSON.stringify({ data: data, firstSeen: meta.firstSeen }, null, 2));
      b2.textContent = '已复制';
      setTimeout(function () { b2.textContent = '复制数据'; }, 1200);
    };
    const b3 = el('button', '', '收起');
    b3.onclick = function () {
      try { if (hasGM()) GM_setValue('wm_panel_collapsed', '1'); else localStorage.setItem('wm_panel_collapsed', '1'); } catch (e) { }
      render(data, meta);
    };
    acts.appendChild(b1); acts.appendChild(b2); acts.appendChild(b3);

    const foot = el('div', 'foot');
    foot.textContent = '沃尔玛前台不提供：销量、BSR、搜索量、商品重量、包装尺寸、上架日期。上架天数由本地首次记录推算。';
    const fv = document.createElement('span');
    fv.className = 'ver';
    fv.textContent = 'v' + VER;
    foot.appendChild(fv);

    wrap.appendChild(head);
    wrap.appendChild(sec1);
    wrap.appendChild(sec2);
    wrap.appendChild(sec3);
    wrap.appendChild(sec5);
    wrap.appendChild(sec4);
    wrap.appendChild(acts);
    wrap.appendChild(foot);
    root.appendChild(wrap);
    mountDetail(host);

    fillReviewRhythm(sec5, data);
  }

  function endSec() { /* 占位，保持渲染顺序清晰 */ }

  /* ================= 搜索页模块 ================= */

  const SEARCH_PANEL_ID = 'wm-search-host';

  function extractSearch() {
    const nd = document.getElementById('__NEXT_DATA__');
    if (!nd) return null;
    let j;
    try { j = JSON.parse(nd.textContent); } catch (e) { return null; }
    const pp = j && j.props && j.props.pageProps ? j.props.pageProps : null;
    if (!pp || !pp.initialData || !pp.initialData.searchResult) return null;
    const sr = pp.initialData.searchResult;

    const all = [];
    (sr.itemStacks || []).forEach(function (s) { (s.items || []).forEach(function (it) { if (it) all.push(it); }); });

    const byHash = new Map();
    const byWid = new Map();
    all.forEach(function (it) {
      if (it.id) byHash.set(String(it.id), it);
      if (it.usItemId) byWid.set(String(it.usItemId), it);
    });

    const uniq = [];
    const seen = new Set();
    all.forEach(function (it) {
      const k = it.usItemId || it.id;
      if (!k || seen.has(k)) return;
      seen.add(k);
      uniq.push(it);
    });

    let cards;
    if (uniq.length) {
      cards = uniq.map(function (it) {
        const badges = ((it.badges && it.badges.flags) || [])
          .map(function (b) { return b && b.text ? b.text : null; })
          .filter(Boolean);
        const stars = it.rating || {};
        return {
          wid: String(it.usItemId || ''),
          hash: it.id ? String(it.id) : '',
          title: it.name || '',
          seller: it.sellerName || '',
          sellerType: it.sellerType || '',
          fulfill: it.fulfillmentType || '',
          price: (typeof it.price === 'number' ? it.price : null),
          rating: (typeof it.averageRating === 'number' ? it.averageRating
            : (typeof stars.averageRating === 'number' ? stars.averageRating : null)),
          reviews: (typeof it.numberOfReviews === 'number' ? it.numberOfReviews
            : (typeof stars.numberOfReviews === 'number' ? stars.numberOfReviews : null)),
          ad: it.isSponsoredFlag === true,
          offerCount: (typeof it.additionalOfferCount === 'number' ? it.additionalOfferCount : null),
          badges: badges,
          outOfStock: it.isOutOfStock === true,
          variants: Array.isArray(it.variantList) ? it.variantList.length : null
        };
      });
    } else {
      // JSON 里没有卡片（部分搜索/模块化页面结构不同）：退回从 DOM 解析
      cards = [];
      Array.prototype.forEach.call(document.querySelectorAll('[data-item-id]'), function (elx) {
        const t = clean(elx.innerText);
        if (t.length < 30) return;
        const pm = t.match(/\$([\d,]+\.\d{2})/);
        const rm = t.match(/(\d\.\d)\s+out of 5 stars/);
        const vm = t.match(/out of 5 Stars?\.\s*([\d,]+)\s+reviews?/i);
        const sm = t.match(/Sold (?:and shipped )?by\s+([A-Za-z0-9 .&'-]{2,40})/i);
        cards.push({
          wid: String(elx.getAttribute('data-item-id') || ''),
          hash: '',
          title: t.slice(0, 60),
          seller: sm ? sm[1].trim() : '',
          sellerType: '',
          fulfill: /Sold and shipped by\s*Walmart/i.test(t) ? 'FC' : '',
          price: pm ? Number(pm[1].replace(/,/g, '')) : null,
          rating: rm ? Number(rm[1]) : null,
          reviews: vm ? Number(vm[1].replace(/,/g, '')) : null,
          ad: /Sponsored/i.test(t),
          offerCount: null,
          badges: /Best seller/i.test(t) ? ['Best seller'] : [],
          outOfStock: /Out of stock/i.test(t),
          variants: null
        });
      });
    }

    const total = (typeof sr.aggregatedCount === 'number' && sr.aggregatedCount > 0)
      ? sr.aggregatedCount : (typeof sr.count === 'number' ? sr.count : cards.length);
    const sellers = {};
    cards.forEach(function (c) { const s = c.seller || '(未知)'; sellers[s] = (sellers[s] || 0) + 1; });
    const adCount = cards.filter(function (c) { return c.ad; }).length;
    const selfCount = cards.filter(function (c) { return /^walmart\.com$/i.test(c.seller); }).length;
    const wfsCount = cards.filter(function (c) { return c.fulfill === 'FC'; }).length;
    const offerCount = cards.filter(function (c) { return c.offerCount !== null && c.offerCount > 0; }).length;

    return {
      term: sr.title ? String(sr.title).replace(/^Results for\s*/i, '').replace(/^"|"$/g, '') : (new URLSearchParams(location.search).get('q') || location.pathname),
      total: total,
      cards: cards,
      byHash: byHash,
      byWid: byWid,
      stats: {
        cards: cards.length,
        adCount: adCount,
        adPct: cards.length ? Math.round(adCount / cards.length * 1000) / 10 : 0,
        sellers: Object.keys(sellers).length,
        selfCount: selfCount,
        selfPct: cards.length ? Math.round(selfCount / cards.length * 1000) / 10 : 0,
        wfsCount: wfsCount,
        followCount: offerCount,
        topSellers: Object.keys(sellers).map(function (k) { return { name: k, n: sellers[k] }; })
          .sort(function (a, b) { return b.n - a.n; }).slice(0, 5)
      }
    };
  }

  const SEARCH_CSS = `
  :host{all:initial}
  .wrap{background:#fff;border:1px solid #e3e4e5;border-radius:8px;box-sizing:border-box;width:100%;
    font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;font-size:13px;color:#1a1a1a}
  .wrap.float{position:fixed;bottom:20px;right:16px;width:300px;max-height:calc(100vh - 150px);overflow:auto;
    z-index:2147483000;border-radius:12px;border:0.5px solid rgba(0,0,0,.18);
    box-shadow:0 8px 28px rgba(0,0,0,.18)}
  .wrap.mini{display:flex;align-items:center;justify-content:space-between;gap:12px;
    padding:8px 14px;cursor:pointer;font-size:12.5px}
  .wrap.mini:hover{background:#fafafa}
  .ver{font-size:10px;color:#b5b5b5;margin-left:8px;font-weight:400}
  .head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:11px 14px;
    background:#f7f7f7;border-bottom:0.5px solid rgba(0,0,0,.1);border-radius:12px 12px 0 0}
  .t1{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px}
  .t2{font-size:11px;color:#6b6b6b;margin-top:2px}
  .sec{padding:10px 14px;border-top:0.5px solid rgba(0,0,0,.07)}
  .sec:first-of-type{border-top:none}
  .sec-h{font-size:10.5px;letter-spacing:.6px;color:#8a8a8a;margin:0 0 6px;text-transform:uppercase}
  .row{display:flex;justify-content:space-between;gap:10px;line-height:1.75}
  .k{color:#6b6b6b}
  .v{text-align:right;font-variant-numeric:tabular-nums}
  .v.hi{color:#b3261e}
  .v.ok{color:#0a7d47}
  .acts{display:flex;gap:6px;padding:10px 14px;border-top:0.5px solid rgba(0,0,0,.1);background:#fafafa;border-radius:0 0 12px 12px}
  button{flex:1;font:inherit;font-size:12px;padding:6px 4px;border-radius:7px;border:0.5px solid #cfcfcf;background:#fff;cursor:pointer}
  button:hover{background:#f0f0f0}
  button.primary{border-color:#0071dc;color:#0071dc}
  .cbt{position:fixed;bottom:20px;right:16px;z-index:2147483000;background:#0071dc;color:#fff;
    font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;font-size:12px;
    padding:7px 11px;border-radius:8px;cursor:pointer;box-shadow:0 3px 12px rgba(0,0,0,.2)}
  `;

  function renderSearchPanel(data) {
    const old = document.getElementById(SEARCH_PANEL_ID);
    if (old) old.remove();

    const host = document.createElement('div');
    host.id = SEARCH_PANEL_ID;
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = SEARCH_CSS;
    root.appendChild(style);

    let collapsed = false;
    try { collapsed = (hasGM() ? GM_getValue('wm_search_collapsed', '0') : localStorage.getItem('wm_search_collapsed')) === '1'; } catch (e) { }

    host.style.cssText = 'display:block;width:100%;margin:12px 0;';

    if (collapsed) {
      const bar = el('div', 'wrap mini');
      const lb = document.createElement('span');
      lb.textContent = '竞争汇总 · ' + data.term + '（' + data.total + ' 个）';
      lb.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      const rb = document.createElement('span');
      rb.textContent = '展开 ▸';
      rb.style.cssText = 'flex:0 0 auto;color:#0071dc';
      bar.appendChild(lb);
      bar.appendChild(rb);
      bar.onclick = function () {
        try { if (hasGM()) GM_setValue('wm_search_collapsed', '0'); else localStorage.setItem('wm_search_collapsed', '0'); } catch (e) { }
        renderSearchPanel(data);
      };
      root.appendChild(bar);
      mountSearch(host);
      return;
    }

    const s = data.stats;
    const wrap = el('div', 'wrap');

    function stat(label, val, color) {
      const d = document.createElement('div');
      d.style.cssText = 'padding:7px 10px;border-radius:6px;background:#f7f8f9;min-width:0';
      const l = document.createElement('div');
      l.textContent = label;
      l.style.cssText = 'font-size:10.5px;color:#8a8a8a;letter-spacing:.3px;white-space:nowrap';
      const v = document.createElement('div');
      v.textContent = val;
      v.style.cssText = 'font-size:15px;font-weight:600;margin-top:2px;font-variant-numeric:tabular-nums' + (color ? ';color:' + color : '');
      d.appendChild(l); d.appendChild(v);
      return d;
    }

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 14px;background:#f7f7f7;border-bottom:1px solid #e3e4e5;border-radius:8px 8px 0 0';
    const hl = document.createElement('div');
    hl.style.cssText = 'min-width:0';
    const t1 = document.createElement('div');
    t1.textContent = data.term;
    t1.style.cssText = 'font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    const t2 = document.createElement('div');
    t2.textContent = '搜索结果 ' + data.total + ' 个 · 本页 ' + s.cards + ' 个（去重后）';
    const t2v = document.createElement('span');
    t2v.className = 'ver';
    t2v.textContent = 'v' + VER;
    t2.appendChild(t2v);
    t2.style.cssText = 'font-size:11px;color:#6b6b6b;margin-top:2px';
    hl.appendChild(t1); hl.appendChild(t2);

    const hb = document.createElement('div');
    hb.style.cssText = 'display:flex;gap:6px;flex:0 0 auto';
    const b1 = document.createElement('button');
    b1.textContent = '导出本页';
    b1.className = 'primary';
    b1.onclick = function () { exportSearchCsv(data); };
    const b3 = document.createElement('button');
    b3.textContent = '收起';
    b3.onclick = function () {
      try { if (hasGM()) GM_setValue('wm_search_collapsed', '1'); else localStorage.setItem('wm_search_collapsed', '1'); } catch (e) { }
      renderSearchPanel(data);
    };
    hb.appendChild(b1); hb.appendChild(b3);
    head.appendChild(hl); head.appendChild(hb);

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:8px;padding:10px 14px';
    grid.appendChild(stat('广告占比', s.adPct + '%', s.adPct >= 25 ? '#b3261e' : '#0a7d47'));
    grid.appendChild(stat('广告数', s.adCount + ' / ' + s.cards, null));
    grid.appendChild(stat('不同卖家', s.sellers + ' 个', null));
    grid.appendChild(stat('沃尔玛自营', s.selfPct + '%', s.selfPct >= 40 ? '#b3261e' : null));
    grid.appendChild(stat('WFS 仓发', s.wfsCount + ' 个', null));
    grid.appendChild(stat('有跟卖', s.followCount + ' 个', s.followCount >= 10 ? '#b3261e' : null));

    const sell = document.createElement('div');
    sell.style.cssText = 'padding:0 14px 10px;font-size:11.5px;color:#6b6b6b;line-height:1.6;word-break:break-word';
    sell.textContent = '卖家集中度：' + s.topSellers.map(function (t) { return t.name + ' ' + t.n; }).join('　·　');

    wrap.appendChild(head);
    wrap.appendChild(grid);
    if (s.topSellers.length) wrap.appendChild(sell);
    root.appendChild(wrap);
    mountSearch(host);
  }

  function exportSearchCsv(data) {
    const cols = [
      ['wid', 'WID'], ['seller', '卖家'], ['sellerType', '卖家类型'], ['fulfill', '履约'],
      ['price', '价格'], ['rating', '评分'], ['reviews', '评论数'],
      ['offerCount', '额外报价数'], ['ad', '是否广告'], ['badges', '徽章'],
      ['outOfStock', '是否缺货'], ['variants', '变体数'], ['title', '标题']
    ];
    const head = cols.map(function (c) { return c[1]; });
    const lines = [head.join(',')];
    data.cards.forEach(function (c) {
      const row = [];
      cols.forEach(function (col) {
        let v = c[col[0]];
        if (col[0] === 'badges') v = (c.badges || []).join(' / ');
        if (col[0] === 'fulfill') v = v === 'FC' ? 'WFS' : (v === 'MARKETPLACE' ? '自发' : (v === 'STORE' ? '到店' : v));
        row.push(csvCell(v));
      });
      lines.push(row.join(','));
    });
    const csv = '\ufeff' + lines.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'walmart-search-' + data.term.replace(/[^\w\u4e00-\u9fa5]+/g, '-').slice(0, 30) + '-' + todayStr() + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  const CHIP_FLAG = 'data-wm-chip';

  function makeChip(c) {
    const parts = [];
    if (c.seller) parts.push(c.seller);
    if (c.offerCount !== null && c.offerCount > 0) parts.push('跟卖 ' + c.offerCount);
    if (c.fulfill === 'FC') parts.push('WFS');
    else if (c.fulfill === 'MARKETPLACE') parts.push('自发');
    if (c.ad) parts.push('广告');
    (c.badges || []).forEach(function (b) { parts.push(b); });
    if (c.outOfStock) parts.push('缺货');

    const chip = document.createElement('div');
    chip.setAttribute(CHIP_FLAG, '1');
    chip.textContent = parts.join(' · ');
    chip.style.cssText = [
      'font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif',
      'font-size:11px',
      'line-height:1.5',
      'padding:3px 6px',
      'margin:4px 0 2px',
      'color:#3a3a3a',
      'background:#f4f6f8',
      'border-left:2px solid #0071dc',
      'border-radius:3px',
      'white-space:normal',
      'word-break:break-word',
      'letter-spacing:0'
    ].join(';');
    return chip;
  }

  function injectChips(data) {
    const els = document.querySelectorAll('[data-item-id]');
    let n = 0;
    Array.prototype.forEach.call(els, function (elx) {
      if (elx.getAttribute(CHIP_FLAG + '-done') === '1') return;
      const key = elx.getAttribute('data-item-id');
      const it = data.byHash.get(String(key)) || data.byWid.get(String(key));
      if (!it) return;
      const wid = String(it.usItemId || '');
      const c = data.cards.filter(function (x) { return x.wid === wid || (it.id && x.hash === String(it.id)); })[0];
      if (!c) return;
      if (!(c.seller || c.offerCount || c.ad || (c.badges && c.badges.length))) return;
      try {
        elx.appendChild(makeChip(c));
        elx.setAttribute(CHIP_FLAG + '-done', '1');
        n++;
      } catch (e) { }
    });
    return n;
  }

  function startSearch() {
    let tries = 0;
    let data = null;
    const timer = setInterval(function () {
      tries++;
      data = extractSearch();
      if (data && data.cards.length) {
        clearInterval(timer);
        window.__wmSearch = data;
        renderSearchPanel(data);
        injectChips(data);
        setInterval(function () { injectChips(data); }, 1800);
        const mo = new MutationObserver(function () {
          clearTimeout(startSearch._t);
          startSearch._t = setTimeout(function () { injectChips(data); }, 400);
        });
        try { mo.observe(document.body, { childList: true, subtree: true }); } catch (e) { }
      } else if (tries > 30) {
        clearInterval(timer);
        console.warn('[沃尔玛快照] 搜索页未识别到结果数据');
        const host = document.createElement('div');
        host.id = SEARCH_PANEL_ID;
        host.style.cssText = 'display:block;width:100%;margin:12px 0;';
        const root2 = host.attachShadow({ mode: 'open' });
        const st2 = document.createElement('style');
        st2.textContent = SEARCH_CSS;
        root2.appendChild(st2);
        const bar = el('div', 'wrap');
        bar.style.cssText = 'padding:10px 14px;font-size:12px;color:#6b6b6b';
        bar.textContent = '沃尔玛快照：本页未识别到搜索结果数据（页面结构可能不同），面板已跳过。';
        root2.appendChild(bar);
        document.body.appendChild(host);
      }
    }, 600);
  }

  /* ================= 评论节奏模块 ================= */

  const REVIEW_CACHE_KEY = 'wm_review_cache_v1';

  function parseUsDate(s) {
    if (!s) return null;
    const m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  function daysAgo(d) { return (Date.now() - d.getTime()) / 86400000; }

  function loadRevCache() {
    try {
      const raw = hasGM() ? GM_getValue(REVIEW_CACHE_KEY, '') : localStorage.getItem(REVIEW_CACHE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }
  function saveRevCache(o) {
    try {
      const raw = JSON.stringify(o);
      if (hasGM()) GM_setValue(REVIEW_CACHE_KEY, raw); else localStorage.setItem(REVIEW_CACHE_KEY, raw);
    } catch (e) { }
  }

  async function fetchReviews(wid, sort) {
    const url = '/reviews/product/' + wid + '?page=1&sort=' + sort;
    const res = await fetch(url, { credentials: 'include', headers: { accept: 'text/html' } });
    const html = await res.text();
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) throw new Error('评论页未返回数据');
    const jj = JSON.parse(m[1]);
    const pp = jj && jj.props && jj.props.pageProps;
    const dd = pp && pp.initialData ? pp.initialData.data : null;
    const rr = dd ? dd.reviews : null;
    const list = (rr && Array.isArray(rr.customerReviews)) ? rr.customerReviews : [];
    const dates = list.map(function (x) { return parseUsDate(x.reviewSubmissionTime); })
      .filter(function (d) { return d && !isNaN(d.getTime()); });
    let inc = 0;
    list.forEach(function (x) {
      const hit = (x.badges || []).some(function (b) {
        if (!b) return false;
        const g = b.glassBadge || {};
        return /incentiv/i.test(String(b.id || '')) || /incentiv/i.test(String(g.id || '')) || /incentiv/i.test(String(g.text || ''));
      });
      if (hit) inc++;
    });
    return {
      dates: dates,
      count: list.length,
      total: rr ? rr.totalReviewCount : null,
      withText: rr ? rr.reviewsWithTextCount : null,
      incentivized: inc
    };
  }

  function buildTimeline(dates) {
    if (!dates || dates.length < 2) return null;
    const ds = dates.slice().sort(function (a, b) { return a - b; });
    const a = ds[0].getTime();
    const b = ds[ds.length - 1].getTime();
    const span = b - a;
    if (span <= 0) return null;
    const wrap = el('div', 'tl');
    wrap.appendChild(el('div', 'ax'));
    ds.forEach(function (d) {
      const dot = el('div', 'dt');
      dot.style.left = ((d.getTime() - a) / span * 100).toFixed(2) + '%';
      wrap.appendChild(dot);
    });
    return wrap;
  }

  function reviewSection() {
    const sec = el('div', 'sec');
    sec.appendChild(el('div', 'sec-h', '评论节奏'));
    const body = el('div');
    body.setAttribute('data-rh', '1');
    body.appendChild(row('状态', '计算中…', 'muted'));
    sec.appendChild(body);
    return sec;
  }

  async function fillReviewRhythm(sec, data) {
    if (!sec || !data || !data.wid) return;
    const body = sec.querySelector('[data-rh]');
    if (!body) return;
    const wid = data.wid;
    const today = todayStr();
    const cache = loadRevCache();
    let c = cache[wid];

    if (!c || c.date !== today) {
      try {
        const r = await fetchReviews(wid, 'submission-desc');
        c = {
          date: today,
          total: r.total,
          withText: r.withText,
          inc: r.incentivized,
          count: r.count,
          dates: r.dates.map(function (d) { return todayStr(d); })
        };
        cache[wid] = c;
        saveRevCache(cache);
      } catch (e) {
        body.innerHTML = '';
        body.appendChild(row('评论数据', '取不到（' + String((e && e.message) || e).slice(0, 20) + '）', 'muted'));
        return;
      }
    }

    const dates = (c.dates || []).map(function (s) { return new Date(s + 'T00:00:00'); })
      .filter(function (d) { return !isNaN(d.getTime()); });
    if (!dates.length) {
      body.innerHTML = '';
      body.appendChild(row('评论', '暂无文字评论', 'muted'));
      return;
    }

    const latest = dates.reduce(function (x, y) { return x > y ? x : y; });
    const dsl = Math.round(daysAgo(latest));
    const sortedAsc = dates.slice().sort(function (x, y) { return x - y; });
    const tenth = sortedAsc[0];
    const recentSpan = Math.round(daysAgo(tenth));
    const recentRate = recentSpan > 0 ? Math.round((dates.length / recentSpan) * 30 * 10) / 10 : null;

    body.innerHTML = '';
    body.appendChild(row('最新评论', dsl <= 0 ? '今天' : dsl + ' 天前', dsl > 30 ? 'warn' : 'good'));

    let lvl = '活跃', cls = 'good';
    if (dsl > 30) { lvl = '沉寂'; cls = 'warn'; }
    else if (dsl > 7) { lvl = '一般'; cls = null; }
    body.appendChild(row('活跃度', lvl, cls));

    if (recentRate !== null) {
      body.appendChild(row('近期速率', recentRate + ' 条/月'));
      body.appendChild(row('统计窗口', dates.length + ' 条 / ' + recentSpan + ' 天', 'muted'));
    }

    const totalForDenom = c.withText || c.total || dates.length;
    body.appendChild(row('评论总数', (c.total === null ? '—' : c.total) + '（文字 ' + (c.withText === null ? '—' : c.withText) + '）', 'muted'));

    if (c.inc > 0) {
      const pct = Math.round(c.inc / Math.max(c.count || dates.length, 1) * 100);
      body.appendChild(row('激励评论', c.inc + ' 条 / ' + (c.count || dates.length) + '（' + pct + '%）', pct >= 30 ? 'warn' : null));
    }

    const tl = buildTimeline(dates);
    if (tl) body.appendChild(tl);

    if (!sec.getAttribute('data-life')) {
      const btn = document.createElement('button');
      btn.textContent = '算全周期';
      btn.style.cssText = 'margin-top:8px;width:100%;font:inherit;font-size:12px;padding:5px;border-radius:6px;border:0.5px solid #cfcfcf;background:#fff;cursor:pointer';
      btn.onclick = async function () {
        btn.textContent = '计算中…';
        btn.disabled = true;
        try {
          const r2 = await fetchReviews(wid, 'submission-asc');
          const oldest = r2.dates.reduce(function (x, y) { return x < y ? x : y; }, r2.dates[0]);
          if (!oldest) throw new Error('无最早日期');
          const span = (latest.getTime() - oldest.getTime()) / 86400000;
          const total = c.total || r2.total;
          sec.setAttribute('data-life', '1');
          btn.remove();
          if (total && total > 1 && span > 0) {
            const lifeRate = Math.round(((total - 1) / span) * 30 * 10) / 10;
            body.appendChild(row('全周期速率', lifeRate + ' 条/月'));
            body.appendChild(row('全周期跨度', Math.round(span) + ' 天', 'muted'));
            if (recentRate !== null && lifeRate > 0) {
              const mult = Math.round((recentRate / lifeRate) * 100) / 100;
              const tag = mult >= 1.4 ? '在加速 ' + mult + '×' : (mult <= 0.7 ? '在放缓 ' + mult + '×' : '节奏平稳');
              body.appendChild(row('对比', tag, mult >= 1.4 ? 'good' : (mult <= 0.7 ? 'warn' : null)));
            }
            try {
              const enriched = Object.assign({}, data, {
                latestReview: todayStr(latest),
                reviewDaysSince: dsl,
                reviewRateRecent: recentRate,
                reviewRateLife: lifeRate
              });
              record(enriched);
            } catch (e) { }
          } else {
            body.appendChild(row('全周期速率', '样本不足', 'muted'));
          }
        } catch (e) {
          btn.textContent = '算全周期（失败，重试）';
          btn.disabled = false;
        }
      };
      body.appendChild(btn);
    }
  }

  /* ---------------- 主流程 ---------------- */
  let lastUrl = '';

  function runDetail() {
    let tries = 0;
    const timer = setInterval(function () {
      tries++;
      const data = extract();
      if (data) {
        clearInterval(timer);
        let meta;
        try {
          meta = record(data);
          if (meta.records <= 0) meta.records = 1;
        } catch (e) {
          console.warn('[沃尔玛快照] 记录失败', e);
          meta = { firstSeen: todayStr(), records: 0 };
        }
        render(data, meta);
        window.__wmSnap = data;
      } else if (tries > 25) {
        clearInterval(timer);
        console.warn('[沃尔玛快照] 未识别到商品数据（页面结构可能变化，或 NEXT_DATA 未下发）');
      }
    }, 600);
  }

  function route() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    const oldD = document.getElementById(PANEL_ID); if (oldD) oldD.remove();
    const oldS = document.getElementById(SEARCH_PANEL_ID); if (oldS) oldS.remove();

    if (location.pathname.startsWith('/ip/')) runDetail();
    else if (location.pathname.startsWith('/search') || location.pathname.startsWith('/browse')) startSearch();
  }

  route();
  setInterval(route, 900);
})();
