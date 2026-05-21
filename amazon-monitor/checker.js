function checkListing(listing, current, settings, lastRecord, yesterdayAvg) {
  const alerts = [];
  const label = `[${listing.asin}] ${listing.name || listing.asin}`;
  const shortThreshold = parseFloat(settings.price_short_threshold || 30) / 100;
  const dailyThreshold = parseFloat(settings.price_daily_threshold || 40) / 100;

  // 不可售
  if (listing.monitor_unavailable && !current.is_available) {
    alerts.push({
      type: 'unavailable',
      message: `⚠️ ${label} 链接不可售（Currently Unavailable）`,
    });
  }

  // 购物车消失
  if (listing.monitor_no_cart && !current.has_cart) {
    alerts.push({
      type: 'no_cart',
      message: `🛒 ${label} Add to Cart 按钮消失，购物车不可用`,
    });
  }

  // Buy Box 被抢（仅在已配置店铺名时生效）
  if (listing.monitor_buybox && listing.seller_name && current.buybox_seller) {
    if (current.buybox_seller !== listing.seller_name) {
      alerts.push({
        type: 'buybox',
        message: `🥊 ${label} Buy Box 被抢！当前卖家：${current.buybox_seller}，你的店铺：${listing.seller_name}`,
      });
    }
  }

  // 价格检查
  if (current.price !== null && current.price !== undefined) {

    // 规则一：与上次抓取比较
    if (listing.monitor_price_short && lastRecord && lastRecord.price != null) {
      const change = (current.price - lastRecord.price) / lastRecord.price;
      if (Math.abs(change) > shortThreshold) {
        const dir = change > 0 ? '上涨📈' : '下跌📉';
        alerts.push({
          type: 'price_short',
          message: `${label} 价格${dir} ${(Math.abs(change) * 100).toFixed(1)}%（短期）\n$${lastRecord.price.toFixed(2)} → $${current.price.toFixed(2)}`,
        });
      }
    }

    // 规则二：与昨日均价比较
    if (listing.monitor_price_daily && yesterdayAvg != null) {
      const change = (current.price - yesterdayAvg) / yesterdayAvg;
      if (Math.abs(change) > dailyThreshold) {
        const dir = change > 0 ? '上涨📈' : '下跌📉';
        alerts.push({
          type: 'price_daily',
          message: `${label} 价格${dir} ${(Math.abs(change) * 100).toFixed(1)}%（对比昨日均价）\n昨日均价 $${yesterdayAvg.toFixed(2)} → 当前 $${current.price.toFixed(2)}`,
        });
      }
    }
  }

  return alerts;
}

module.exports = { checkListing };