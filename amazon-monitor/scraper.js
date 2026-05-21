const axios = require('axios');
const cheerio = require('cheerio');

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function scrapeAsin(asin) {
  const url = `https://www.amazon.com/dp/${asin}`;
  try {
    const res = await axios.get(url, {
      headers: {
        'User-Agent': randomUA(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'max-age=0',
        'Upgrade-Insecure-Requests': '1',
      },
      timeout: 20000,
    });

    const html = res.data;

    // CAPTCHA detection
    if (
      html.includes('Type the characters you see below') ||
      html.includes('Enter the characters you see below') ||
      html.includes('api.frontgate.amazon.com')
    ) {
      throw new Error('触发验证码，本次跳过');
    }

    const $ = cheerio.load(html);

    // Product name
    const name = $('#productTitle').text().trim() || $('h1.a-size-large').first().text().trim();

    // Price — try multiple selectors in order
    const PRICE_SELECTORS = [
      '.priceToPay .a-offscreen',
      '.apexPriceToPay .a-offscreen',
      '#corePriceDisplay_desktop_feature_div .a-offscreen',
      '#corePrice_desktop .a-offscreen',
      '#priceblock_ourprice',
      '#priceblock_dealprice',
      '#price_inside_buybox',
      '.a-price[data-a-color="price"] .a-offscreen',
    ];
    let price = null;
    for (const sel of PRICE_SELECTORS) {
      const text = $(sel).first().text().trim();
      if (text && text.includes('$')) {
        const m = text.match(/\$([\d,]+\.?\d*)/);
        if (m) { price = parseFloat(m[1].replace(',', '')); break; }
      }
    }

    // Availability
    const availText = ($('#availability span').first().text() || '').toLowerCase();
    const is_available = !['currently unavailable', 'unavailable', 'out of stock'].some(s => availText.includes(s));

    // Add to Cart button
    const has_cart = $('#add-to-cart-button').length > 0 || $('#add-to-cart-button-ubb').length > 0;

    // Buy Box seller
    let buybox_seller = '';
    const SELLER_SELECTORS = [
      '#sellerProfileTriggerId',
      '#merchant-info a',
      '.tabular-buybox-text[tabular-attribute-name="Sold by"] span a',
      '#buyboxAccordion a.a-link-normal',
    ];
    for (const sel of SELLER_SELECTORS) {
      const text = $(sel).first().text().trim();
      if (text) { buybox_seller = text; break; }
    }

    return { success: true, asin, name, price, is_available, has_cart, buybox_seller };
  } catch (err) {
    return { success: false, asin, error: err.message };
  }
}

module.exports = { scrapeAsin };