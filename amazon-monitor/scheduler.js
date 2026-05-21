const { scrapeAsin } = require('./scraper');
const { checkListing } = require('./checker');
const { notify } = require('./notifier');
const db = require('./database');

let timer = null;
let isRunning = false;
let lastCheckTime = null;
let lastCheckResult = null;

async function runCheck() {
  if (isRunning) return { skipped: true, message: '上次检查尚未完成' };

  isRunning = true;
  lastCheckTime = new Date().toISOString();
  console.log(`\n[${lastCheckTime}] ▶ 开始检查...`);

  const listings = db.getAllListings();
  const settings = db.getAllSettings();
  const allAlerts = [];
  let successCount = 0, failCount = 0;

  for (let i = 0; i < listings.length; i++) {
    const listing = listings[i];

    // 每个 ASIN 之间随机间隔 2~5 秒
    if (i > 0) {
      await new Promise(r => setTimeout(r, Math.floor(Math.random() * 3000) + 2000));
    }

    const result = await scrapeAsin(listing.asin);

    if (!result.success) {
      failCount++;
      const failures = (listing.consecutive_failures || 0) + 1;
      db.updateListing(listing.asin, { consecutive_failures: failures });
      console.log(`  ❌ ${listing.asin} 失败 (连续${failures}次): ${result.error}`);

      if (failures >= 3) {
        const alert = {
          type: 'fetch_fail',
          message: `❌ [${listing.asin}] ${listing.name || listing.asin} 连续抓取失败 ${failures} 次\n原因：${result.error}`,
        };
        allAlerts.push(alert);
        db.saveAlert(listing.asin, listing.name || '', alert.type, alert.message);
      }
      continue;
    }

    successCount++;

    // 更新商品名称、重置失败计数
    db.updateListing(listing.asin, {
      consecutive_failures: 0,
      name: result.name || listing.name || '',
    });

    // 在保存之前，先取上次记录和昨日均价用于比较
    const lastRecord = db.getLastRecord(listing.asin);
    const yesterdayAvg = db.getYesterdayAvgPrice(listing.asin);

    // 检查异常
    const updatedListing = db.getListing(listing.asin);
    const alerts = checkListing(updatedListing, result, settings, lastRecord, yesterdayAvg);

    // 保存历史（在检查之后）
    db.saveHistory(listing.asin, result);

    for (const alert of alerts) {
      db.saveAlert(listing.asin, result.name || listing.name || '', alert.type, alert.message);
      allAlerts.push(alert);
    }

    console.log(`  ✅ ${listing.asin}: $${result.price} | 可售=${result.is_available} | 购物车=${result.has_cart} | BuyBox="${result.buybox_seller}"`);
  }

  if (allAlerts.length > 0) {
    await notify(settings, allAlerts).catch(e => console.error('通知发送失败:', e.message));
  }

  lastCheckResult = { time: lastCheckTime, total: listings.length, success: successCount, fail: failCount, alerts: allAlerts.length };
  isRunning = false;
  console.log(`▶ 完成：成功 ${successCount}，失败 ${failCount}，告警 ${allAlerts.length} 条\n`);
  return lastCheckResult;
}

function startScheduler(intervalMinutes) {
  if (timer) clearInterval(timer);
  const ms = Math.max(10, parseInt(intervalMinutes) || 60) * 60 * 1000;
  timer = setInterval(() => runCheck().catch(console.error), ms);
  console.log(`⏰ 定时任务已启动：每 ${intervalMinutes} 分钟检查一次`);
}

function getStatus() {
  return { is_running: isRunning, last_check_time: lastCheckTime, last_check_result: lastCheckResult, scheduler_active: !!timer };
}

module.exports = { runCheck, startScheduler, getStatus };