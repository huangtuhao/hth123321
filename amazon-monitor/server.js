const express = require('express');
const path = require('path');
const db = require('./database');
const { runCheck, startScheduler, getStatus } = require('./scheduler');
const { sendEmail, sendFeishu } = require('./notifier');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

db.initDB();
startScheduler(parseInt(db.getSetting('check_interval') || '60'));

// ── Listings ──────────────────────────────────────
app.get('/api/listings', (req, res) => {
  try {
    const listings = db.getAllListings().map(l => ({ ...l, last_check: db.getLastRecord(l.asin) || null }));
    res.json(listings);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/listings', (req, res) => {
  try {
    const asin = (req.body.asin || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin)) return res.status(400).json({ error: 'ASIN 应为10位字母数字' });
    db.addListing(asin, req.body);
    res.json({ success: true, asin });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/listings/:asin', (req, res) => {
  try { db.updateListing(req.params.asin, req.body); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/listings/:asin', (req, res) => {
  try { db.deleteListing(req.params.asin); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Alerts ────────────────────────────────────────
app.get('/api/alerts', (req, res) => {
  try { res.json(db.getAlerts(200)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/alerts', (req, res) => {
  try { db.clearAlerts(); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Settings ──────────────────────────────────────
app.get('/api/settings', (req, res) => {
  try { res.json(db.getAllSettings()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/settings', (req, res) => {
  try {
    db.setSettings(req.body);
    if (req.body.check_interval) startScheduler(parseInt(req.body.check_interval));
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Test notifications ────────────────────────────
app.post('/api/test/email', async (req, res) => {
  try {
    const s = db.getAllSettings();
    await sendEmail(s, '✅ Amazon 监控 - 邮件测试', '邮件通知配置正确，监控系统可以正常发送告警邮件。');
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/test/feishu', async (req, res) => {
  try {
    const s = db.getAllSettings();
    await sendFeishu(s, '✅ Amazon 监控测试消息\n飞书机器人配置正确，监控系统可以正常发送告警。');
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Manual check & status ─────────────────────────
app.post('/api/check', async (req, res) => {
  try { res.json(await runCheck()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/status', (req, res) => {
  try { res.json({ ...getStatus(), listings_count: db.getAllListings().length }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`\n✅ Amazon 监控面板已启动：http://localhost:${PORT}\n`));