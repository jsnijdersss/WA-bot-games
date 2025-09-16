// index.js - Render-ready Venom bot (keep-alive + fetch placeholder)

// ---------- IMPORTS ----------
const venom = require('venom-bot');
const axios = require('axios');
const storage = require('node-persist');
const express = require('express');

// ---------- CONFIG ----------
const CONFIG = {
  API_URL: process.env.GS_API_URL || 'https://goeiescheids.nl/api/games',
  BEARER_TOKEN: process.env.GS_BEARER_TOKEN || '', // zet in Render Secret
  CHECK_INTERVAL_MS: 1 * 60 * 1000, // elke minuut check
  WA_GROUP_NAME:
    process.env.WA_GROUP_NAME || 'GS/ILF M2 G(angsta)S Manager Club',
  KEEP_ALIVE_INTERVAL_MS: 5 * 60 * 1000, // elke 5 minuten
  KEEP_ALIVE_NUMBER: process.env.KEEP_ALIVE_NUMBER || '31651491786', // internationaal formaat
};

// ---------- INIT STORAGE ----------
async function initStorage() {
  await storage.init({ dir: 'data' });
}

// ---------- VENOM SETUP ----------
async function setupVenom() {
  const client = await venom.create({
    session: 'bot-session',
    multidevice: false,
    puppeteerOptions: {
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
    },
    printQRInTerminal: true, // Render logs tonen QR
  });
  console.log('Venom klaar ✅');
  return client;
}

// ---------- FETCH WEDSTRIJDEN ----------
async function fetchWedstrijden() {
  try {
    const now = new Date();
    const startDate = now.toISOString();
    const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const filter = encodeURIComponent(JSON.stringify({ startDate, endDate }));
    const range = encodeURIComponent(JSON.stringify([0, 50]));
    const sort = encodeURIComponent(JSON.stringify(['id', 'DESC']));
    const url = `${CONFIG.API_URL}?filter=${filter}&range=${range}&sort=${sort}`;

    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${CONFIG.BEARER_TOKEN}` },
    });
    return res.data || [];
  } catch (err) {
    console.error('fetchWedstrijden error:', err.response?.data || err.message);
    return [];
  }
}

// ---------- DETECT NEW ----------
async function detectNieuweWedstrijden(current) {
  const known = (await storage.getItem('known')) || [];
  const knownIds = new Set(known.map((k) => k.id));
  const nieuw = current.filter((w) => !knownIds.has(w.id));
  if (nieuw.length > 0) await storage.setItem('known', current);
  return nieuw;
}

// ---------- SEND TO NUMBER ----------
async function sendToNumber(client, number, text) {
  try {
    await client.sendText(`${number}@c.us`, text);
  } catch (e) {
    console.error('sendToNumber error:', e?.message || e);
  }
}

// ---------- NOTIFY GROUP ----------
async function notifyWhatsapp(client, wedstrijd) {
  try {
    const chats = await client.getAllChats();
    const groupChat = chats.find(
      (c) =>
        c.isGroup &&
        c.name &&
        c.name.toLowerCase().includes(CONFIG.WA_GROUP_NAME.toLowerCase())
    );
    const message = `📢 Nieuwe wedstrijd!\n${JSON.stringify(wedstrijd, null, 2)}`;
    if (groupChat) {
      const chatId = groupChat.id._serialized || groupChat.id;
      await client.sendText(chatId, message);
      console.log('Gestuurd naar groep:', groupChat.name);
    } else {
      console.warn('Groep niet gevonden, fallback naar owner');
      await sendToNumber(
        client,
        CONFIG.KEEP_ALIVE_NUMBER,
        'Nieuwe wedstrijd (fallback): ' + message
      );
    }
  } catch (e) {
    console.error('notifyWhatsapp error:', e?.message || e);
  }
}

// ---------- KEEP ALIVE ----------
async function keepAlive(client, logs) {
  const msg = `🤖 Bot actief! Nieuwe items: ${logs.length}`;
  await sendToNumber(client, CONFIG.KEEP_ALIVE_NUMBER, msg);
}

// ---------- MAIN ----------
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

// ---------- DUMMY EXPRESS SERVER (Render happy) ----------
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('🤖 WhatsApp bot draait ✅'));
app.listen(PORT, () => console.log(`Dummy server running on port ${PORT}`));

