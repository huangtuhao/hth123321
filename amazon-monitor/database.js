const fs   = require('fs');
const path = require('path');

// ── 数据目录 ──────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const FILES = {
  listings : path.join(DATA_DIR, 'listings.json'),
  history  : path.join(DATA_DIR, 'history.json'),
  alerts   : path.join(DATA_DIR, 'alerts.json'),
  settings : path.join(DATA_DIR, 'settings.json'),
};

// ── 底层读写 ──────────────────────────────────────────────────
function read(key, defaultVal) {
  try {
    if (fs.existsSync(FILES[key]))
      return JSON.parse(fs.readFileSync(FILES[key], 'utf8'));
  } catch {}
  return defaultVal;
}

function write(key, data) {
  fs.writeFileSync(FILES[key], JSON.stringify(data, null, 2), 'utf8');
}

function nowStr() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// ── 初始化 ────────────────────────────────────────────────────
function initDB() {
  if (!fs.existsSync(FILES.listings)) write('listings', []);
  if (!fs.existsSync(FILES.history))  write('history',  []);
  if (!fs.existsSync(FILES.alerts))   write('alerts',   []);

  const defaults = {
    price_short_threshold : '30',
    price_daily_threshold : '40',
    check_interval        : '60',
    email_enabled         : 'false',
    email_host            : 'smtp.qq.com',
    email_port            : '465',
    email_user            : '',
    email_pass            : '',
    email_to              : '',
    feishu_enabled        : 'false',
    feishu_webhook        : '',
  };
  const existing = read('settings', {});
  write('settings', { ...defaults, ...existing });
}

// ── Listings ──────────────────────────────────────────────────
function getAllListings() {
  return read('listings', [])
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function getListing(asin) {
  return read('listings', []).find(l => l.asin === asin) || null;
}

function addListing(asin, opts = {}) {
  const list = read('listings', []);
  if (list.find(l => l.asin === asin)) return;   // 已存在不重复添加
  const n = nowStr();
  list.push({
    asin,
    name                 : opts.name        || '',
    seller_name          : opts.seller_name || '',
    monitor_price_short  : opts.monitor_price_short  !== false ? 1 : 0,
    monitor_price_daily  : opts.monitor_price_daily  !== false ? 1 : 0,
    monitor_unavailable  : opts.monitor_unavailable  !== false ? 1 : 0,
    monitor_no_cart      : opts.monitor_no_cart      !== false ? 1 : 0,
    monitor_buybox       : opts.monitor_buybox       !== false ? 1 : 0,
    consecutive_failures : 0,
    created_at           : n,
    updated_at           : n,
  });
  write('listings', list);
}

function updateListing(asin, opts = {}) {
  const list = read('listings', []);
  const idx  = list.findIndex(l => l.asin === asin);
  if (idx === -1) return;

  const boolFields   = ['monitor_price_short','monitor_price_daily',
                        'monitor_unavailable','monitor_no_cart','monitor_buybox'];
  const stringFields = ['name','seller_name','consecutive_failures'];

  for (const [k, v] of Object.entries(opts)) {
    if (boolFields.includes(k))   list[idx][k] = v ? 1 : 0;
    if (stringFields.includes(k)) list[idx][k] = v;
  }
  list[idx].updated_at = nowStr();
  write('listings', list);
}

function deleteListing(asin) {
  write('listings', read('listings', []).filter(l => l.asin !== asin));
}

// ── Price History ─────────────────────────────────────────────
const MAX_HISTORY = 5000;   // 最多保留条数，防止文件过大

function saveHistory(asin, data) {
  const history = read('history', []);
  history.push({
    id            : Date.now() + Math.random(),   // 唯一 id
    asin,
    price         : data.price,
    is_available  : data.is_available  ? 1 : 0,
    has_cart      : data.has_cart      ? 1 : 0,
    buybox_seller : data.buybox_seller || '',
    checked_at    : nowStr(),
  });
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  write('history', history);
}

function getLastRecord(asin) {
  const all = read('history', []).filter(h => h.asin === asin);
  return all.length ? all[all.length - 1] : null;
}

function getYesterdayAvgPrice(asin) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yDate = yesterday.toISOString().slice(0, 10);   // 'YYYY-MM-DD'

  const records = read('history', []).filter(h =>
    h.asin === asin &&
    h.price != null &&
    h.checked_at &&
    h.checked_at.slice(0, 10) === yDate
  );
  if (!records.length) return null;
  return records.reduce((s, r) => s + r.price, 0) / records.length;
}

// ── Alerts ────────────────────────────────────────────────────
let _alertId = Date.now();

function saveAlert(asin, asinName, alertType, message) {
  const alerts = read('alerts', []);
  alerts.unshift({
    id           : ++_alertId,
    asin,
    asin_name    : asinName,
    alert_type   : alertType,
    message,
    triggered_at : nowStr(),
  });
  if (alerts.length > 500) alerts.splice(500);
  write('alerts', alerts);
}

function getAlerts(limit = 200) {
  return read('alerts', []).slice(0, limit);
}

function clearAlerts() {
  write('alerts', []);
}

// ── Settings ──────────────────────────────────────────────────
function getSetting(key) {
  const s = read('settings', {});
  return s[key] !== undefined ? s[key] : null;
}

function getAllSettings() {
  return read('settings', {});
}

function setSettings(obj) {
  const s = read('settings', {});
  for (const [k, v] of Object.entries(obj)) s[k] = String(v);
  write('settings', s);
}

module.exports = {
  initDB,
  getAllListings, getListing, addListing, updateListing, deleteListing,
  saveHistory, getLastRecord, getYesterdayAvgPrice,
  saveAlert, getAlerts, clearAlerts,
  getSetting, getAllSettings, setSettings,
};