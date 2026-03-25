// Vercel serverless webhook handler for the intimate shop demo bot
// Анонимный магазин интим-товаров (18+), легально в KZ
// БД: Turso (orders, customers)
import { createClient } from '@libsql/client';

const TOKEN = process.env.INTIMATE_DEMO_TOKEN;
const ADMIN_ID = process.env.INTIMATE_DEMO_ADMIN_ID
  ? parseInt(process.env.INTIMATE_DEMO_ADMIN_ID, 10)
  : 0;

// --- Turso DB ---
let _db;
function db() {
  if (!_db) {
    _db = createClient({
      url: process.env.TURSO_DATABASE_URL || 'file:intimate.db',
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return _db;
}

async function ensureSchema() {
  const d = db();
  await d.batch([
    `CREATE TABLE IF NOT EXISTS intimate_customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tg_id INTEGER UNIQUE NOT NULL,
      tg_username TEXT,
      name TEXT,
      phone TEXT,
      dob TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS intimate_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tg_id INTEGER NOT NULL,
      customer_name TEXT,
      phone TEXT,
      address TEXT,
      total INTEGER NOT NULL,
      status TEXT DEFAULT 'new',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS intimate_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      price INTEGER NOT NULL,
      quantity INTEGER NOT NULL
    )`,
  ]);
}

let schemaReady = false;

// --- Input sanitization ---
function sanitize(str, maxLen = 100) {
  return String(str || '').slice(0, maxLen).replace(/[*_`\[\]()~>#+\-=|{}.!\\]/g, '\\$&');
}

const SHOP_NAME = 'Secret KZ 18+';
const CURRENCY = '₸';

const CATEGORIES = [
  { id: 'toys', name: '🎀 Игрушки' },
  { id: 'lingerie', name: '👙 Бельё' },
  { id: 'cosmetics', name: '🧴 Косметика' },
  { id: 'accessories', name: '🎁 Аксессуары' },
];

const PRODUCTS = [
  { id: 't1', cat: 'toys', name: 'Массажёр компактный', price: 8500, desc: 'Силикон, 10 режимов, USB зарядка, водонепроницаемый' },
  { id: 't2', cat: 'toys', name: 'Массажёр премиум', price: 15000, desc: 'Медицинский силикон, 20 режимов, бесшумный мотор' },
  { id: 't3', cat: 'toys', name: 'Набор для двоих', price: 12000, desc: 'Комплект из 3 предметов в подарочной упаковке' },
  { id: 't4', cat: 'toys', name: 'Вакуумный стимулятор', price: 18000, desc: 'Технология воздушной волны, 11 уровней интенсивности' },
  { id: 'l1', cat: 'lingerie', name: 'Комплект кружевной', price: 5500, desc: 'Бра + трусики, кружево, размеры S-XL' },
  { id: 'l2', cat: 'lingerie', name: 'Боди сетка', price: 4500, desc: 'Эластичная сетка, open back, размеры S-L' },
  { id: 'l3', cat: 'lingerie', name: 'Корсет + чулки', price: 8500, desc: 'Атласный корсет, чулки в комплекте' },
  { id: 'l4', cat: 'lingerie', name: 'Пеньюар шёлковый', price: 7000, desc: 'Шёлк, кружевная отделка, пояс' },
  { id: 'c1', cat: 'cosmetics', name: 'Массажное масло', price: 2500, desc: 'Аромат ванили, 200мл, разогревающее' },
  { id: 'c2', cat: 'cosmetics', name: 'Лубрикант на водной основе', price: 1800, desc: '100мл, гипоаллергенный, без запаха' },
  { id: 'c3', cat: 'cosmetics', name: 'Массажные свечи', price: 3500, desc: 'Набор 3 шт, ароматы: роза, жасмин, сандал' },
  { id: 'c4', cat: 'cosmetics', name: 'Набор для ванны', price: 4000, desc: 'Бомбочки + пена + лепестки роз' },
  { id: 'a1', cat: 'accessories', name: 'Маска на глаза шёлк', price: 1500, desc: 'Натуральный шёлк, мягкая резинка' },
  { id: 'a2', cat: 'accessories', name: 'Наручники мягкие', price: 2000, desc: 'Бархат + металл, ключик в комплекте' },
  { id: 'a3', cat: 'accessories', name: 'Набор для игр', price: 6500, desc: '5 предметов: маска, перья, лента, кубик, карты' },
  { id: 'a4', cat: 'accessories', name: 'Подарочный бокс', price: 9500, desc: 'Масло + свечи + маска + бельё в коробке' },
];

// In-memory session: { userId: { productId: qty, _step, _name, _phone, _address, _verified } }
const sessions = new Map();

// --- Helpers ---

async function tg(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

function getSession(uid) {
  if (!sessions.has(uid)) sessions.set(uid, {});
  return sessions.get(uid);
}

function isVerified(uid) {
  return sessions.has(uid) && sessions.get(uid)._verified === true;
}

function cartTotal(uid) {
  const s = getSession(uid);
  let total = 0;
  for (const [pid, qty] of Object.entries(s)) {
    if (pid.startsWith('_')) continue;
    const p = PRODUCTS.find((x) => x.id === pid);
    if (p) total += p.price * qty;
  }
  return total;
}

function cartText(uid) {
  const s = getSession(uid);
  const items = Object.entries(s).filter(([k]) => !k.startsWith('_'));
  if (items.length === 0) return 'Корзина пуста';
  const lines = [];
  for (const [pid, qty] of items) {
    const p = PRODUCTS.find((x) => x.id === pid);
    if (p) lines.push(`• ${p.name} x${qty} — ${p.price * qty}${CURRENCY}`);
  }
  lines.push(`\n*Итого: ${cartTotal(uid)}${CURRENCY}*`);
  return lines.join('\n');
}

function cartItems(uid) {
  const s = getSession(uid);
  return Object.entries(s).filter(([k]) => !k.startsWith('_'));
}

function cartHasItems(uid) {
  return cartItems(uid).length > 0;
}

function mainMenuKb() {
  return {
    inline_keyboard: [
      [{ text: '🛍 Каталог', callback_data: 'catalog' }],
      [{ text: '🛒 Корзина', callback_data: 'cart' }],
      [{ text: '📦 Доставка и оплата', callback_data: 'delivery' }],
      [{ text: '📞 Контакты', callback_data: 'contacts' }],
    ],
  };
}

// --- Age verification by date of birth ---

function parseAge(text) {
  // Accepts: DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY
  const m = text.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2026) return null;
  const dob = new Date(year, month - 1, day);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const md = now.getMonth() - dob.getMonth();
  if (md < 0 || (md === 0 && now.getDate() < dob.getDate())) age--;
  return { age, dob: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
}

// --- Callback handlers ---

async function handleCatalog(chatId, messageId) {
  const buttons = CATEGORIES.map((c) => [{ text: c.name, callback_data: `cat:${c.id}` }]);
  buttons.push([{ text: '🛒 Корзина', callback_data: 'cart' }]);
  buttons.push([{ text: '<< Меню', callback_data: 'back_main' }]);
  await tg(TOKEN, 'editMessageText', {
    chat_id: chatId, message_id: messageId,
    text: '*Каталог*\n\nВыберите категорию:',
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons },
  });
}

async function handleCategory(chatId, messageId, catId) {
  const cat = CATEGORIES.find((c) => c.id === catId);
  if (!cat) return;
  const products = PRODUCTS.filter((p) => p.cat === catId);
  const buttons = products.map((p) => [
    { text: `${p.name} — ${p.price}${CURRENCY}`, callback_data: `prod:${p.id}` },
  ]);
  buttons.push([{ text: '<< Каталог', callback_data: 'catalog' }]);
  await tg(TOKEN, 'editMessageText', {
    chat_id: chatId, message_id: messageId,
    text: `*${cat.name}*`, parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons },
  });
}

async function handleProduct(chatId, messageId, pid) {
  const p = PRODUCTS.find((x) => x.id === pid);
  if (!p) return;
  await tg(TOKEN, 'editMessageText', {
    chat_id: chatId, message_id: messageId,
    text: `*${p.name}*\n\n${p.desc}\n\nЦена: *${p.price}${CURRENCY}*`,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [
      [{ text: '🛒 Добавить в корзину', callback_data: `add:${pid}` }],
      [{ text: '<< Каталог', callback_data: `cat:${p.cat}` }],
    ]},
  });
}

async function handleAdd(chatId, messageId, callbackQueryId, uid, pid) {
  const p = PRODUCTS.find((x) => x.id === pid);
  if (!p) return;
  const s = getSession(uid);
  s[pid] = (s[pid] || 0) + 1;
  await tg(TOKEN, 'answerCallbackQuery', { callback_query_id: callbackQueryId, text: `${p.name} добавлен!` });
  await tg(TOKEN, 'editMessageText', {
    chat_id: chatId, message_id: messageId,
    text: `✅ *${p.name}* добавлен!\n\nКорзина: ${cartTotal(uid)}${CURRENCY}`,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [
      [{ text: '🛒 Перейти в корзину', callback_data: 'cart' }],
      [{ text: '🛍 Продолжить покупки', callback_data: 'catalog' }],
    ]},
  });
}

async function handleCart(chatId, messageId, uid) {
  if (!cartHasItems(uid)) {
    await tg(TOKEN, 'editMessageText', {
      chat_id: chatId, message_id: messageId, text: 'Корзина пуста.',
      reply_markup: { inline_keyboard: [[{ text: '🛍 Каталог', callback_data: 'catalog' }]] },
    });
    return;
  }
  await tg(TOKEN, 'editMessageText', {
    chat_id: chatId, message_id: messageId,
    text: `*🛒 Корзина:*\n\n${cartText(uid)}`, parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [
      [{ text: '✅ Оформить заказ', callback_data: 'checkout' }],
      [{ text: '🗑 Очистить корзину', callback_data: 'clear_cart' }],
      [{ text: '<< Каталог', callback_data: 'catalog' }],
    ]},
  });
}

async function handleClearCart(chatId, messageId, callbackQueryId, uid) {
  const s = getSession(uid);
  for (const k of Object.keys(s)) { if (!k.startsWith('_')) delete s[k]; }
  await tg(TOKEN, 'answerCallbackQuery', { callback_query_id: callbackQueryId, text: 'Корзина очищена' });
  await tg(TOKEN, 'editMessageText', {
    chat_id: chatId, message_id: messageId, text: 'Корзина очищена.',
    reply_markup: { inline_keyboard: [[{ text: '🛍 Каталог', callback_data: 'catalog' }]] },
  });
}

async function handleCheckout(chatId, messageId, uid) {
  const s = getSession(uid);
  s._step = 'name';
  await tg(TOKEN, 'editMessageText', {
    chat_id: chatId, message_id: messageId,
    text: '📝 Введите *имя* получателя:', parse_mode: 'Markdown',
  });
}

async function handleDelivery(chatId, messageId) {
  await tg(TOKEN, 'editMessageText', {
    chat_id: chatId, message_id: messageId,
    text:
      '*📦 Доставка и оплата*\n\n' +
      '🚚 *Доставка:*\n• По Астане/Алматы — 1-2 часа\n• По Казахстану — 2-5 дней (Казпочта)\n• Упаковка *обезличенная* — без логотипов\n\n' +
      '💳 *Оплата:*\n• Kaspi перевод\n• Наличные курьеру\n\n' +
      '🔒 *Конфиденциальность:*\n• Курьер не знает содержимое\n• Нейтральная упаковка\n• Данные не передаются третьим лицам',
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [[{ text: '<< Меню', callback_data: 'back_main' }]] },
  });
}

async function handleContacts(chatId, messageId) {
  await tg(TOKEN, 'editMessageText', {
    chat_id: chatId, message_id: messageId,
    text: `*${SHOP_NAME}*\n\nРаботаем: 10:00-22:00\nWhatsApp: +7 701 077 0199\nTelegram: @BotJasau\n\n🔒 100% конфиденциальность\n📦 Обезличенная доставка по всему КЗ`,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [[{ text: '<< Меню', callback_data: 'back_main' }]] },
  });
}

async function handleBackMain(chatId, messageId) {
  await tg(TOKEN, 'editMessageText', {
    chat_id: chatId, message_id: messageId,
    text: `🔞 *${SHOP_NAME}*\n\nВыберите действие:`, parse_mode: 'Markdown',
    reply_markup: mainMenuKb(),
  });
}

// --- Checkout text flow ---

async function handleTextInput(chatId, uid, username, text) {
  const s = getSession(uid);
  const step = s._step;
  if (!step) return false;

  // Age verification step
  if (step === 'age') {
    const result = parseAge(text);
    if (!result) {
      await tg(TOKEN, 'sendMessage', {
        chat_id: chatId,
        text: '❌ Неверный формат.\n\nВведите дату рождения: *ДД.ММ.ГГГГ*',
        parse_mode: 'Markdown',
      });
      return true;
    }
    if (result.age < 18) {
      s._step = null;
      await tg(TOKEN, 'sendMessage', {
        chat_id: chatId,
        text: `⛔ Вам ${result.age} лет. Этот магазин доступен только для лиц старше 18 лет.`,
      });
      return true;
    }
    if (result.age > 100) {
      await tg(TOKEN, 'sendMessage', {
        chat_id: chatId,
        text: '❌ Проверьте дату рождения.\n\nВведите в формате *ДД.ММ.ГГГГ*',
        parse_mode: 'Markdown',
      });
      return true;
    }
    // Verified!
    s._verified = true;
    s._dob = result.dob;
    s._step = null;

    // Save customer to DB
    try {
      await ensureSchema();
      await db().execute({
        sql: `INSERT INTO intimate_customers (tg_id, tg_username, dob) VALUES (?, ?, ?)
              ON CONFLICT(tg_id) DO UPDATE SET dob = ?, tg_username = ?`,
        args: [uid, username || '', result.dob, result.dob, username || ''],
      });
    } catch (e) { /* DB error — continue without saving */ }

    await tg(TOKEN, 'sendMessage', {
      chat_id: chatId,
      text: `✅ Возраст подтверждён!\n\n🔞 *${SHOP_NAME}*\n\nВыберите действие:`,
      parse_mode: 'Markdown',
      reply_markup: mainMenuKb(),
    });
    return true;
  }

  // Checkout steps
  if (step === 'name') {
    const name = text.trim();
    if (name.length < 2) {
      await tg(TOKEN, 'sendMessage', { chat_id: chatId, text: '❌ Введите имя (минимум 2 символа)' });
      return true;
    }
    s._name = name;
    s._step = 'phone';
    await tg(TOKEN, 'sendMessage', {
      chat_id: chatId,
      text: '📱 Отправьте номер телефона кнопкой ниже или введите вручную:',
      reply_markup: {
        keyboard: [[{ text: '📱 Отправить мой номер', request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
    return true;
  }

  if (step === 'phone') {
    const phone = text.trim().replace(/[\s\-()]/g, '');
    if (phone.length < 10 || !/^\+?\d{10,15}$/.test(phone)) {
      await tg(TOKEN, 'sendMessage', {
        chat_id: chatId,
        text: '❌ Неверный номер. Введите в формате *+7XXXXXXXXXX* (10-15 цифр)',
        parse_mode: 'Markdown',
        reply_markup: {
          keyboard: [[{ text: '📱 Отправить мой номер', request_contact: true }]],
          resize_keyboard: true, one_time_keyboard: true,
        },
      });
      return true;
    }
    s._phone = phone;
    s._step = 'address';
    await tg(TOKEN, 'sendMessage', {
      chat_id: chatId,
      text: '📍 Введите *адрес доставки*:\n\nФормат: _Город, улица, дом, квартира_',
      parse_mode: 'Markdown',
      reply_markup: { remove_keyboard: true },
    });
    return true;
  }

  if (step === 'address') {
    const addr = text.trim();
    if (addr.length < 10) {
      await tg(TOKEN, 'sendMessage', {
        chat_id: chatId,
        text: '❌ Адрес слишком короткий.\n\nУкажите: _Город, улица, дом, квартира_',
        parse_mode: 'Markdown',
      });
      return true;
    }
    s._address = addr;
    s._step = null;

    const items = cartItems(uid);
    const itemsTextVal = cartText(uid);
    const total = cartTotal(uid);
    const name = s._name;
    const phone = s._phone;
    const address = s._address;

    // Save order to DB
    let orderId = null;
    try {
      if (!schemaReady) { await ensureSchema(); schemaReady = true; }

      // Update customer info
      await db().execute({
        sql: `UPDATE intimate_customers SET name = ?, phone = ? WHERE tg_id = ?`,
        args: [name, phone, uid],
      });

      // Insert order
      const orderRes = await db().execute({
        sql: `INSERT INTO intimate_orders (tg_id, customer_name, phone, address, total) VALUES (?, ?, ?, ?, ?)`,
        args: [uid, name, phone, address, total],
      });
      orderId = Number(orderRes.lastInsertRowid);

      // Insert order items
      for (const [pid, qty] of items) {
        const p = PRODUCTS.find((x) => x.id === pid);
        if (p) {
          await db().execute({
            sql: `INSERT INTO intimate_order_items (order_id, product_id, product_name, price, quantity) VALUES (?, ?, ?, ?, ?)`,
            args: [orderId, pid, p.name, p.price, qty],
          });
        }
      }
    } catch (e) { /* DB error — order still sent via TG notification */ }

    // Clear cart items but keep session
    for (const k of Object.keys(s)) { if (!k.startsWith('_')) delete s[k]; }

    const orderNum = orderId ? `#${orderId}` : '';

    await tg(TOKEN, 'sendMessage', {
      chat_id: chatId,
      text:
        `✅ *Заказ ${orderNum} оформлен!*\n\n` +
        `${itemsTextVal}\n\n` +
        `📍 Доставка: ${sanitize(address, 200)}\n` +
        `📱 Телефон: ${sanitize(phone, 20)}\n\n` +
        `💳 *Оплата:* Kaspi перевод\nРеквизиты будут отправлены в ближайшее время.\n\n` +
        `📦 Упаковка обезличенная. Спасибо!`,
      parse_mode: 'Markdown',
      reply_markup: mainMenuKb(),
    });

    // Notify admin
    if (ADMIN_ID) {
      await tg(TOKEN, 'sendMessage', {
        chat_id: ADMIN_ID,
        text:
          `🔔 Новый заказ ${orderNum}!\n\n` +
          `Клиент: ${sanitize(name)}\nТелефон: ${sanitize(phone, 20)}\nАдрес: ${sanitize(address, 200)}\n` +
          `TG: @${sanitize(username || 'anonymous', 50)}\n\n${itemsTextVal}\nСумма: ${total}${CURRENCY}`,
      });
    }
    return true;
  }

  return false;
}

// --- Admin commands ---

async function handleAdminOrders(chatId) {
  try {
    if (!schemaReady) { await ensureSchema(); schemaReady = true; }
    const res = await db().execute(`SELECT id, customer_name, phone, total, status, created_at FROM intimate_orders ORDER BY id DESC LIMIT 20`);
    if (res.rows.length === 0) {
      await tg(TOKEN, 'sendMessage', { chat_id: chatId, text: 'Заказов пока нет.' });
      return;
    }
    const lines = res.rows.map((r) =>
      `#${r.id} | ${r.customer_name} | ${r.phone} | ${r.total}${CURRENCY} | ${r.status} | ${r.created_at}`
    );
    await tg(TOKEN, 'sendMessage', { chat_id: chatId, text: `*Последние заказы:*\n\n${lines.join('\n')}`, parse_mode: 'Markdown' });
  } catch (e) {
    await tg(TOKEN, 'sendMessage', { chat_id: chatId, text: 'Ошибка чтения заказов: ' + e.message });
  }
}

async function handleAdminCustomers(chatId) {
  try {
    if (!schemaReady) { await ensureSchema(); schemaReady = true; }
    const res = await db().execute(`SELECT tg_id, tg_username, name, phone, dob, created_at FROM intimate_customers ORDER BY id DESC LIMIT 20`);
    if (res.rows.length === 0) {
      await tg(TOKEN, 'sendMessage', { chat_id: chatId, text: 'Клиентов пока нет.' });
      return;
    }
    const lines = res.rows.map((r) =>
      `@${r.tg_username || '—'} | ${r.name || '—'} | ${r.phone || '—'} | ДР: ${r.dob || '—'}`
    );
    await tg(TOKEN, 'sendMessage', { chat_id: chatId, text: `*Клиенты:*\n\n${lines.join('\n')}`, parse_mode: 'Markdown' });
  } catch (e) {
    await tg(TOKEN, 'sendMessage', { chat_id: chatId, text: 'Ошибка: ' + e.message });
  }
}

async function handleAdminStats(chatId) {
  try {
    if (!schemaReady) { await ensureSchema(); schemaReady = true; }
    const today = await db().execute(`SELECT COUNT(*) as cnt, COALESCE(SUM(total),0) as sum FROM intimate_orders WHERE created_at >= date('now')`);
    const week = await db().execute(`SELECT COUNT(*) as cnt, COALESCE(SUM(total),0) as sum FROM intimate_orders WHERE created_at >= date('now', '-7 days')`);
    const all = await db().execute(`SELECT COUNT(*) as cnt, COALESCE(SUM(total),0) as sum FROM intimate_orders`);
    const customers = await db().execute(`SELECT COUNT(*) as cnt FROM intimate_customers`);

    await tg(TOKEN, 'sendMessage', {
      chat_id: chatId,
      text:
        `*📊 Статистика ${SHOP_NAME}*\n\n` +
        `*Сегодня:* ${today.rows[0].cnt} заказов, ${today.rows[0].sum}${CURRENCY}\n` +
        `*За неделю:* ${week.rows[0].cnt} заказов, ${week.rows[0].sum}${CURRENCY}\n` +
        `*Всего:* ${all.rows[0].cnt} заказов, ${all.rows[0].sum}${CURRENCY}\n` +
        `*Клиентов:* ${customers.rows[0].cnt}`,
      parse_mode: 'Markdown',
    });
  } catch (e) {
    await tg(TOKEN, 'sendMessage', { chat_id: chatId, text: 'Ошибка: ' + e.message });
  }
}

// --- Webhook auth ---
function verifyWebhook(req) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return true;
  return req.headers['x-telegram-bot-api-secret-token'] === secret;
}

// --- Main handler ---

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).json({ ok: true, method: req.method });
  if (!verifyWebhook(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    try { if (!schemaReady) { await ensureSchema(); schemaReady = true; } } catch (e) { /* DB optional */ }

    const update = req.body;

    // Handle callback queries
    if (update.callback_query) {
      const cb = update.callback_query;
      const chatId = cb.message.chat.id;
      const messageId = cb.message.message_id;
      const uid = cb.from.id;
      const data = cb.data;

      // Check age verification for all actions
      if (!isVerified(uid)) {
        const s = getSession(uid);
        s._step = 'age';
        await tg(TOKEN, 'sendMessage', {
          chat_id: chatId,
          text: '🔞 *Подтверждение возраста*\n\nВведите дату рождения в формате *ДД.ММ.ГГГГ*',
          parse_mode: 'Markdown',
        });
        return res.status(200).json({ ok: true });
      }

      if (data === 'catalog') await handleCatalog(chatId, messageId);
      else if (data.startsWith('cat:')) await handleCategory(chatId, messageId, data.split(':')[1]);
      else if (data.startsWith('prod:')) await handleProduct(chatId, messageId, data.split(':')[1]);
      else if (data.startsWith('add:')) await handleAdd(chatId, messageId, cb.id, uid, data.split(':')[1]);
      else if (data === 'cart') await handleCart(chatId, messageId, uid);
      else if (data === 'clear_cart') await handleClearCart(chatId, messageId, cb.id, uid);
      else if (data === 'checkout') await handleCheckout(chatId, messageId, uid);
      else if (data === 'delivery') await handleDelivery(chatId, messageId);
      else if (data === 'contacts') await handleContacts(chatId, messageId);
      else if (data === 'back_main') await handleBackMain(chatId, messageId);

      return res.status(200).json({ ok: true });
    }

    // Handle text messages
    if (update.message) {
      const msg = update.message;
      const chatId = msg.chat.id;
      const uid = msg.from.id;
      const text = msg.text || '';

      // /start — reset and ask for age
      if (text === '/start') {
        sessions.delete(uid);
        const s = getSession(uid);

        // Check if already verified in DB
        if (schemaReady) {
          try {
            const existing = await db().execute({ sql: `SELECT dob FROM intimate_customers WHERE tg_id = ?`, args: [uid] });
            if (existing.rows.length > 0 && existing.rows[0].dob) {
              const dobStr = String(existing.rows[0].dob);
              const parts = dobStr.split('-');
              if (parts.length === 3) {
                const parsed = parseAge(`${parts[2]}.${parts[1]}.${parts[0]}`);
                if (parsed && parsed.age >= 18) {
                  s._verified = true;
                  await tg(TOKEN, 'sendMessage', {
                    chat_id: chatId,
                    text: `🔞 *${SHOP_NAME}*\n\nС возвращением! Выберите действие:`,
                    parse_mode: 'Markdown', reply_markup: mainMenuKb(),
                  });
                  return res.status(200).json({ ok: true });
                }
              }
            }
          } catch (e) { /* DB unavailable — ask again */ }
        }

        s._step = 'age';
        await tg(TOKEN, 'sendMessage', {
          chat_id: chatId,
          text: `🔞 *${SHOP_NAME}*\n\nЭтот магазин содержит товары для взрослых.\n\nДля подтверждения возраста введите дату рождения в формате *ДД.ММ.ГГГГ*`,
          parse_mode: 'Markdown',
        });
        return res.status(200).json({ ok: true });
      }

      // Handle shared contact (phone button)
      if (msg.contact) {
        const s = getSession(uid);
        if (s._step === 'phone') {
          s._phone = msg.contact.phone_number || '';
          s._step = 'address';
          // Remove custom keyboard
          await tg(TOKEN, 'sendMessage', {
            chat_id: chatId,
            text: `✅ Номер получен: ${s._phone}\n\n📍 Введите *адрес доставки*:\n\n_Город, улица, дом, квартира_`,
            parse_mode: 'Markdown',
            reply_markup: { remove_keyboard: true },
          });
          return res.status(200).json({ ok: true });
        }
      }

      // Admin commands
      if (ADMIN_ID && uid === ADMIN_ID) {
        if (text === '/orders') { await handleAdminOrders(chatId); return res.status(200).json({ ok: true }); }
        if (text === '/customers') { await handleAdminCustomers(chatId); return res.status(200).json({ ok: true }); }
        if (text === '/stats') { await handleAdminStats(chatId); return res.status(200).json({ ok: true }); }
      }

      // If not verified, ask for age
      if (!isVerified(uid)) {
        const s = getSession(uid);
        if (s._step !== 'age') { s._step = 'age'; }
        await handleTextInput(chatId, uid, msg.from.username, text);
        return res.status(200).json({ ok: true });
      }

      // Checkout/age flow
      const handled = await handleTextInput(chatId, uid, msg.from.username, text);
      if (handled) return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Intimate shop bot error:', err);
    return res.status(200).json({ ok: true });
  }
}
