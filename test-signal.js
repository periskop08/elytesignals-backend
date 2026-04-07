require('dotenv').config();
const db = require('./database');
const TelegramBot = require('node-telegram-bot-api');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
const VIP_GROUP = process.env.TELEGRAM_VIP_GROUP_ID;

const fakeSignal = {
    symbol: "TEST/USDT",
    type: "LONG",
    entryPrice: 65000,
    targetPrice: 70000,
    stopPrice: 62000,
    qualityScore: 99.9,
    warnings: "[]",
    status: "ACTIVE"
};

async function createTestSignal() {
    console.log("Creating test signal...");
    try {
        await db.run(
            "INSERT INTO signals (symbol, type, entryPrice, targetPrice, stopPrice, qualityScore, warnings, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [fakeSignal.symbol, fakeSignal.type, fakeSignal.entryPrice, fakeSignal.targetPrice, fakeSignal.stopPrice, fakeSignal.qualityScore, fakeSignal.warnings, fakeSignal.status]
        );
        console.log("✅ Db insert success! Signal visible on App.");
        
        if (VIP_GROUP) {
            const msg = `🚨 *Elyte Sinyal Uygulaması Üzerinde Yeni Bir Sinyal Düştü!*\n\n` +
                        `⭐ Kalite Skoru: *${fakeSignal.qualityScore}*\n` +
                        `🎯 Yön: *${fakeSignal.type}*\n\n` +
                        `_Detaylar ve seviyeler için Elyte aplikasyonuna girebilirsiniz..._ 🔭\n\n` +
                        `🔗 Web Platformu:\nhttps://www.elytesignals.com/dashboard`;
            await bot.sendMessage(VIP_GROUP, msg, { parse_mode: 'Markdown' });
            console.log("✅ Telegram message sent to VIP Group!");
        } else {
            console.log("No VIP group ID set in .env!");
        }
    } catch (e) {
        console.error("Test failed:", e);
    }
    process.exit(0);
}

setTimeout(createTestSignal, 1500);
