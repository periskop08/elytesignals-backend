require('dotenv').config();
const db = require('./database');
const TelegramBot = require('node-telegram-bot-api');
const telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

async function runFakeTest() {
    console.log("Fake signal test initializing...");
    const signal = {
        symbol: 'TESTUSDT',
        type: 'LONG',
        entryPrice: 1.05,
        targetPrice: 1.25,
        stopPrice: 0.95,
        qualityScore: 99,
        warnings: JSON.stringify(["Test Flag", "Bollinger Band Breakout"]),
        isAsset: false
    };

    try {
        const insertResult = await db.run(
            "INSERT INTO signals (symbol, type, entryPrice, targetPrice, stopPrice, qualityScore, warnings) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [signal.symbol, signal.type, signal.entryPrice, signal.targetPrice, signal.stopPrice, signal.qualityScore, signal.warnings]
        );
        const signalId = insertResult.id;
        console.log(`[FAKE] Signal inserted to DB with ID: ${signalId}`);

        if (process.env.TELEGRAM_VIP_GROUP_ID) {
            const hasFlag = true;
            const flagPart = hasFlag ? `🔥 Formasyon: Bayrak/Flama Modeli Tespit Edildi, +10 Kalite Puanı eklendi.\n\n` : `\n`;
            const categoryTag = signal.isAsset ? '[VARLIKLAR (FX/Emtia)]' : '[KRİPTO]';
            const msg = `🚨 *Elyte Sinyal Uygulaması Üzerinde '${categoryTag}' Kategorisinde Yeni Bir Test Sinyali Düştü!*\n\n` +
                        `⭐ Kalite Skoru: *${signal.qualityScore}*\n` +
                        `🎯 Yön: *${signal.type}*\n` + flagPart +
                        `_Detaylar ve seviyeler için Elyte aplikasyonuna girebilirsiniz..._ 🔭\n\n` +
                        `🔗 Web Platformu:\nhttps://www.elytesignals.com/dashboard`;
            await telegramBot.sendMessage(process.env.TELEGRAM_VIP_GROUP_ID, msg, { parse_mode: 'Markdown' });
            console.log("[FAKE] Signal successfully sent to Telegram!");
        } else {
             console.log("[FAKE] Missing TELEGRAM_VIP_GROUP_ID");
        }

    } catch (e) {
        console.error("Test failed:", e);
    }
    console.log("Done.");
    process.exit(0);
}

runFakeTest();
