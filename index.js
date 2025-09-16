// index.js - Render-ready Venom bot (keep-alive + fetch placeholder)
// Pas CONFIG hieronder aan via Render Environment Variables (of vervang direct)

const venom = require('venom-bot');
const axios = require('axios');
const storage = require('node-persist');

const CONFIG = {
  API_URL: process.env.GS_API_URL || 'https://goeiescheids.nl/api/games',
  BEARER_TOKEN: process.env.GS_BEARER_TOKEN || '', // zet in Render Secret
  CHECK_INTERVAL_MS: 10 * 60 * 1000, // 10 minuten
  WA_GROUP_NAME: process.env.WA_GROUP_NAME || 'GS/ILF M2 G(angsta)S Manager Club',
  KEEP_ALIVE_INTERVAL_MS: 10 * 60 * 1000, // 10 minuten
  KEEP_ALIVE_NUMBER: process.env.KEEP_ALIVE_NUMBER || '31651491786', // internationaal formaat
};

// storage init
async function initStorage() {
  await storage.init({ dir: 'data' });
}

// Venom setup (Render flags)
async function setupVenom() {
  const client = await venom.create({
    session: 'bot-session',
    multidevice: false,
    puppeteerOptions: {
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    },
    printQRInTerminal: true, // Render logs zullen de QR tonen
  });
  console.log('Venom klaar.');
  return client;
}

// Fetch wedstrijden via API (zorg dat BEARER_TOKEN in Render Secrets staat)
async function fetchWedstrijden() {
  try {
    const now = new Date();
    const startDate = now.toISOString();
    const endDate = new Date(now.getTime() + 7*24*60*60*1000).toISOString();
    const filter = encodeURIComponent(JSON.stringify({ startDate, endDate }));
    const range = encodeURIComponent(JSON.stringify([0,50]));
    const sort = encodeURIComponent(JSON.stringify(['id','DESC']));
    const url = `${CONFIG.API_URL}?filter=${filter}&range=${range}&sort=${sort}`;

    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${CONFIG.BEARER_TOKEN}` }
    });
    return res.data || [];
  } catch (err) {
    console.error('fetchWedstrijden error:', err.response?.data || err.message);
    return [];
  }
}

// Detect new games
async function detectNieuweWedstrijden(current) {
  const known = (await storage.getItem('known')) || [];
  const knownIds = new Set(known.map(k => k.id));
  const nieuw = current.filter(w => !knownIds.has(w.id));
  if (nieuw.length > 0) await storage.setItem('known', current);
  return nieuw;
}

// send text to number (personal)
async function sendToNumber(client, number, text) {
  // number in internationaal formaat, e.g. 31651491786
  try {
    await client.sendText(`${number}@c.us`, text);
  } catch (e) {
    console.error('sendToNumber error:', e?.message || e);
  }
}

// notify group by group name fuzzy match
async function notifyWhatsapp(client, wedstrijd) {
  try {
    const chats = await client.getAllChats();
    const groupChat = chats.find(c => c.isGroup && c.name && c.name.toLowerCase().includes(CONFIG.WA_GROUP_NAME.toLowerCase()));
    const message = `📢 Nieuwe wedstrijd!\n${JSON.stringify(wedstrijd)}`;
    if (groupChat) {
      const chatId = groupChat.id._serialized || groupChat.id;
      await client.sendText(chatId, message);
      console.log('Gestuurd naar groep:', groupChat.name);
    } else {
      console.warn('Groep niet gevonden, fallback naar owner');
      await sendToNumber(client, CONFIG.KEEP_ALIVE_NUMBER, 'Nieuwe wedstrijd (fallback): ' + message);
    }
  } catch (e) {
    console.error('notifyWhatsapp error:', e?.message || e);
  }
}

// keep alive
async function keepAlive(client, logs) {
  const msg = `🤖 Bot actief! Nieuwe items: ${logs.length}`;
  await sendToNumber(client, CONFIG.KEEP_ALIVE_NUMBER, msg);
}

async function main() {
  await initStorage();
  const client = await setupVenom();

  console.log('Bot gestart. Scan QR vanuit de Render logs als dat nodig is.');

  let lastKeepAlive = Date.now();

  setInterval(async () => {
    try {
      const wedstrijden = await fetchWedstrijden();
      const nieuw = await detectNieuweWedstrijden(wedstrijden);

      for (const w of nieuw) {
        await notifyWhatsapp(client, w);
      }

      if (Date.now() - lastKeepAlive > CONFIG.KEEP_ALIVE_INTERVAL_MS) {
        await keepAlive(client, nieuw);
        lastKeepAlive = Date.now();
      }
    } catch (e) {
      console.error('Loop error:', e?.message || e);
    }
  }, CONFIG.CHECK_INTERVAL_MS);
}

main();
