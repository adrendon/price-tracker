const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const Database = require('better-sqlite3');
const { chromium } = require('playwright');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ─── PRODUCTO FIJO ────────────────────────────────────────────────────────────
const PRODUCT_URL = 'https://www.mercadolibre.com.co/p/MCO55762680?pdp_filters=item_id:MCO1824720703';
const PRODUCT_NAME = 'Producto MCO55762680';

// ─── BASE DE DATOS ────────────────────────────────────────────────────────────
const db = new Database(process.env.DB_PATH || './tracker.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    price REAL NOT NULL,
    recorded_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS alerts_sent (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    old_price REAL,
    new_price REAL,
    sent_at TEXT DEFAULT (datetime('now'))
  );
`);

// Valores por defecto en config
function getConfig(key) {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
  return row ? row.value : null;
}
function setConfig(key, value) {
  db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, String(value));
}

// ─── SCRAPER MERCADOLIBRE COLOMBIA ────────────────────────────────────────────
function extractPriceFromHtml(html) {
  const $ = cheerio.load(html);

  const ldScripts = $('script[type="application/ld+json"]').toArray();
  for (const s of ldScripts) {
    try {
      const json = JSON.parse($(s).html());
      const items = Array.isArray(json) ? json : [json];
      for (const item of items) {
        if (item['@type'] === 'Product' && item.offers) {
          const offers = Array.isArray(item.offers) ? item.offers : [item.offers];
          const prices = offers.map(o => parseFloat(o.price)).filter(p => !isNaN(p) && p > 1000);
          if (prices.length) return Math.min(...prices);
        }
      }
    } catch {}
  }

  const selectors = [
    '.ui-pdp-price__second-line .andes-money-amount__fraction',
    '.poly-price__current .andes-money-amount__fraction',
    '.ui-pdp-price .andes-money-amount__fraction',
    '.andes-money-amount__fraction',
  ];
  for (const sel of selectors) {
    const els = $(sel);
    for (let i = 0; i < els.length; i++) {
      const raw = $(els[i]).text().replace(/\./g, '').replace(',', '.').trim();
      const price = parseFloat(raw);
      if (!isNaN(price) && price > 10000) return price;
    }
  }

  for (const el of $('script').toArray()) {
    const content = $(el).html() || '';
    for (const key of ['__PRELOADED_STATE__', '__INITIAL_STATE__']) {
      if (!content.includes(key)) continue;
      const match = content.match(new RegExp(`${key}\\s*=\\s*(\\{[\\s\\S]+\\})\\s*;?`));
      if (!match) continue;

      try {
        const price = findPriceInObject(JSON.parse(match[1]));
        if (price) return price;
      } catch {}
    }
  }

  return null;
}

async function scrapePriceWithHttp() {
  try {
    const { data } = await axios.get(PRODUCT_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'es-CO,es;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Cache-Control': 'no-cache',
      },
      timeout: 20000,
      maxRedirects: 5,
      validateStatus: () => true,
    });

    return typeof data === 'string' ? extractPriceFromHtml(data) : null;
  } catch (err) {
    console.error('[SCRAPER:HTTP] Error:', err.message);
    return null;
  }
}

async function scrapePriceWithBrowser() {
  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'es-CO',
    });

    await page.goto(PRODUCT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    return extractPriceFromHtml(await page.content());
  } catch (err) {
    console.error('[SCRAPER:BROWSER] Error:', err.message);
    return null;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

async function scrapePrice() {
  const httpPrice = await scrapePriceWithHttp();
  if (httpPrice) return httpPrice;

  console.warn('[SCRAPER] Fallback a navegador real');
  return scrapePriceWithBrowser();
}

function findPriceInObject(obj, depth = 0) {
  if (depth > 8 || !obj || typeof obj !== 'object') return null;
  for (const key of ['price', 'sale_price', 'amount']) {
    if (typeof obj[key] === 'number' && obj[key] > 10000) return obj[key];
    if (typeof obj[key]?.value === 'number' && obj[key].value > 10000) return obj[key].value;
  }
  for (const val of Object.values(obj)) {
    const found = findPriceInObject(val, depth + 1);
    if (found) return found;
  }
  return null;
}

// ─── OPENWA ───────────────────────────────────────────────────────────────────
const OPENWA_URL    = process.env.OPENWA_URL     || 'http://localhost:2785';
const OPENWA_KEY    = process.env.OPENWA_API_KEY || '';
const OPENWA_SESSION = process.env.OPENWA_SESSION || 'default';

async function sendWhatsApp(phone, message) {
  try {
    const chatId = phone.replace(/[^0-9]/g, '') + '@c.us';
    await axios.post(
      `${OPENWA_URL}/api/sessions/${OPENWA_SESSION}/messages/send-text`,
      { chatId, text: message },
      { headers: { 'X-API-Key': OPENWA_KEY, 'Content-Type': 'application/json' } }
    );
    console.log('[WA] Mensaje enviado a', phone);
    return true;
  } catch (err) {
    console.error('[WA] Error:', err.message);
    return false;
  }
}

function buildMessage(oldPrice, newPrice) {
  const diff = oldPrice ? (((newPrice - oldPrice) / oldPrice) * 100).toFixed(1) : null;
  const arrow = diff === null ? '' : parseFloat(diff) < 0 ? `📉 Bajó ${Math.abs(diff)}%` : `📈 Subió ${diff}%`;
  return (
    `🔔 *Cambio de precio detectado*\n\n` +
    `📦 *${PRODUCT_NAME}*\n` +
    (oldPrice ? `💸 Antes: $${Math.round(oldPrice).toLocaleString('es-CO')}\n` : '') +
    `💰 Ahora: *$${Math.round(newPrice).toLocaleString('es-CO')}*\n` +
    (arrow ? `${arrow}\n` : '') +
    `\n🔗 ${PRODUCT_URL}`
  );
}

// ─── LÓGICA PRINCIPAL DE CHEQUEO ──────────────────────────────────────────────
async function checkPrice() {
  console.log('[CHECK] Revisando precio...');
  const price = await scrapePrice();

  if (!price) {
    console.warn('[CHECK] No se obtuvo precio');
    setConfig('last_check', new Date().toISOString());
    setConfig('last_status', 'error');
    return;
  }

  // Guardar en historial
  db.prepare('INSERT INTO price_history (price) VALUES (?)').run(price);
  setConfig('last_check', new Date().toISOString());
  setConfig('last_status', 'ok');
  setConfig('current_price', price);

  console.log(`[CHECK] Precio: $${price}`);

  // Comparar con precio anterior
  const lastRow = db.prepare('SELECT price FROM price_history ORDER BY id DESC LIMIT 1 OFFSET 1').get();
  const lastPrice = lastRow ? lastRow.price : null;

  if (!lastPrice || price !== lastPrice) {
    // Precio cambió — enviar alerta a todos los teléfonos registrados
    const phone = getConfig('phone');
    if (phone) {
      const sent = await sendWhatsApp(phone, buildMessage(lastPrice, price));
      if (sent) {
        db.prepare('INSERT INTO alerts_sent (old_price, new_price) VALUES (?, ?)').run(lastPrice, price);
        console.log('[CHECK] Alerta enviada. Cambio:', lastPrice, '->', price);
      }
    } else {
      console.warn('[CHECK] Sin teléfono configurado, no se envió alerta');
    }
  } else {
    console.log('[CHECK] Sin cambio de precio');
  }
}

// ─── CRON: cada 6 horas ───────────────────────────────────────────────────────
cron.schedule('0 */6 * * *', checkPrice);

// ─── API ──────────────────────────────────────────────────────────────────────

// Estado general
app.get('/api/status', (req, res) => {
  const currentPrice = getConfig('current_price');
  const lastCheck    = getConfig('last_check');
  const lastStatus   = getConfig('last_status');
  const phone        = getConfig('phone');

  const history = db.prepare(
    'SELECT price, recorded_at FROM price_history ORDER BY recorded_at DESC LIMIT 48'
  ).all().reverse();

  const alerts = db.prepare(
    'SELECT * FROM alerts_sent ORDER BY sent_at DESC LIMIT 10'
  ).all();

  res.json({
    product: { name: PRODUCT_NAME, url: PRODUCT_URL },
    current_price: currentPrice ? parseFloat(currentPrice) : null,
    last_check: lastCheck,
    last_status: lastStatus,
    phone,
    history,
    alerts,
  });
});

// Guardar teléfono
app.post('/api/phone', (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Falta el teléfono' });
  setConfig('phone', phone);
  res.json({ ok: true });
});

// Forzar chequeo manual
app.post('/api/check', async (req, res) => {
  await checkPrice();
  const price = getConfig('current_price');
  res.json({ price: price ? parseFloat(price) : null, checked_at: new Date().toISOString() });
});

// Estado de OpenWA
app.get('/api/openwa/status', async (req, res) => {
  try {
    const { data } = await axios.get(`${OPENWA_URL}/api/sessions/${OPENWA_SESSION}`, {
      headers: { 'X-API-Key': OPENWA_KEY },
      timeout: 5000,
    });
    res.json({ connected: data.status === 'CONNECTED' });
  } catch {
    res.json({ connected: false });
  }
});

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`✅ Price Tracker en http://localhost:${PORT}`);
  console.log(`📦 Producto: ${PRODUCT_URL}`);
  // Chequeo inicial al arrancar
  await checkPrice();
});
