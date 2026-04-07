const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const db = new sqlite3.Database(path.join(__dirname, 'signals.db'));

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.PERISKOP_TELEGRAM_ID;

const warnings = JSON.stringify(['Flag/Pennant (+10)', 'Flag RVOL Bonus (+5)']);
const symbol = 'TESTBAYRAK';
const type = 'LONG';
const entry = 0.50;
const target = 0.58;
const stop = 0.47;

db.run(
    "INSERT INTO signals (symbol, type, entryPrice, targetPrice, stopPrice, qualityScore, warnings, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE')",
    [symbol, type, entry, target, stop, 95, warnings],
    async function(err) {
        if (err) { console.error(err); process.exit(1); }
        const message = `🚨 *YENİ SİNYAL BULUNDU* 🚨\n\n📌 Sembol: ${symbol}\n📈 Yön: LONG 🟢\n⚖️ Kalite Skoru: 95 ⚡️\n\n💰 Giriş: $${entry}\n🎯 Hedef: $${target}\n🛑 Stop: $${stop}\n\n🔥 Formasyon: Bayrak/Flama Modeli Tespit Edildi, +10 Kalite Puanı\n\nPeriskop Yapay Zeka Analizi`;
        try {
            await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: 'Markdown'
            });
            console.log('Test signal and Telegram sent successfully.');
        } catch(e) {
            console.error('Telegram error:', e.message);
        }
    }
);
