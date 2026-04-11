require('dotenv').config();
const cron = require('node-cron');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const dbPath = path.resolve(__dirname, 'signals.db');
const db = new sqlite3.Database(dbPath);

const { TELEGRAM_BOT_TOKEN_ADMIN, TELEGRAM_ADMIN_CHAT_ID } = process.env;
const bot = TELEGRAM_BOT_TOKEN_ADMIN ? new TelegramBot(TELEGRAM_BOT_TOKEN_ADMIN, { polling: false }) : null;

function runQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function runExec(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

async function fetchCurrentPrice(symbol) {
    try {
        const res = await axios.get(`https://open-api.bingx.com/openApi/swap/v2/quote/ticker?symbol=${symbol}`);
        if (res.data && res.data.data && res.data.data.lastPrice) {
            return parseFloat(res.data.data.lastPrice);
        }
    } catch(e) { }
    return null;
}

async function checkShadowTrades() {
    try {
        const pending = await runQuery("SELECT * FROM shadow_trades WHERE status = 'PENDING'");
        if (!pending || pending.length === 0) return;

        for (const trade of pending) {
            const currentPrice = await fetchCurrentPrice(trade.symbol);
            if (!currentPrice) continue;

            let hitWin = false;
            let hitLoss = false;

            if (trade.type === 'LONG') {
                if (currentPrice >= trade.targetPrice) hitWin = true;
                if (currentPrice <= trade.stopPrice) hitLoss = true;
            } else {
                if (currentPrice <= trade.targetPrice) hitWin = true;
                if (currentPrice >= trade.stopPrice) hitLoss = true;
            }

            if (hitLoss) {
                await runExec("UPDATE shadow_trades SET status = 'LOSS', closedAt = CURRENT_TIMESTAMP WHERE id = ?", [trade.id]);
                console.log(`[SHADOW] Ajan Haklı Çıktı! Uzak durduğumuz ${trade.symbol} (${trade.type}) işlemi patladı (LOSS). Hafıza onaylandı.`);
                if (bot && TELEGRAM_ADMIN_CHAT_ID) {
                    bot.sendMessage(TELEGRAM_ADMIN_CHAT_ID, `🤖 *Ajan Haklı Çıktı! (Ders Onaylandı)* 🤖\n\n⛔ ${trade.symbol} işlemine Ders ID:${trade.lessonId} nedeniyle girmemiştik.\nİyi ki girmemişiz, işlem grafikte STOP-LOSS noktasına vurdu! Otonom öğrenim başarılı.`);
                }
            } else if (hitWin) {
                await runExec("UPDATE shadow_trades SET status = 'WIN', closedAt = CURRENT_TIMESTAMP WHERE id = ?", [trade.id]);
                console.log(`[SHADOW] Ajan Yanıldı! Engellediğimiz ${trade.symbol} (${trade.type}) işlemi hedefe ulaştı (WIN). Dersi güncellemeli.`);
                
                // Ders fazla katı ise, statusunu INVALID'e çekebiliriz
                if (trade.lessonId) {
                    await runExec("UPDATE ai_lessons SET status = 'INVALID' WHERE id = ?", [trade.lessonId]);
                }
                
                if (bot && TELEGRAM_ADMIN_CHAT_ID) {
                    bot.sendMessage(TELEGRAM_ADMIN_CHAT_ID, `⚠️ *Ajan Yanıldı! (Katı Kurallar Gevşetiliyor)* ⚠️\n\n🎯 ${trade.symbol} işlemine girmemiştik ancak işlem Hedefe (TP) gitti!\n🗑️ Ders ID:${trade.lessonId} gereksiz katı olduğu anlaşıldı ve hafızadan siliyorum (INVALID).`);
                }
            }
        }
    } catch (e) {
        console.error("Shadow check error:", e);
    }
}

console.log("[SHADOW_TRACKER] Gölge Takip Ajanı Aktif!");
setInterval(checkShadowTrades, 60000); // Her dakikada bir kontrol et
checkShadowTrades();
