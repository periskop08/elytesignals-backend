require('dotenv').config();
const cron = require('node-cron');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-3.1-pro" });

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

async function fetchBingxCandles(symbol, intervalMinutes, limit) {
    try {
        const res = await axios.get(`https://open-api.bingx.com/openApi/swap/v3/quote/klines?symbol=${symbol}&interval=1h&limit=${limit}`);
        let list = res.data.data;
        list.sort((a, b) => a.time - b.time);
        return list.map(k => ({
            open: parseFloat(k.open),
            high: parseFloat(k.high),
            low: parseFloat(k.low),
            close: parseFloat(k.close),
            volume: parseFloat(k.volume)
        }));
    } catch (e) { return null; }
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
                if (trade.lessonId) {
                    try {
                        const lessonData = await runQuery("SELECT lessonText FROM ai_lessons WHERE id = ?", [trade.lessonId]);
                        if (lessonData && lessonData.length > 0) {
                            const originalLesson = lessonData[0].lessonText;
                            const candles = await fetchBingxCandles(trade.symbol, 60, 24);
                            let candleContext = "Son 24 Saatlik Veri Mevcut Değil.";
                            if (candles && candles.length > 0) {
                                candleContext = candles.map((c, i) => `H${i+1}: Açılış=${c.open.toFixed(4)}, Kapanış=${c.close.toFixed(4)}, Hacim=${c.volume.toFixed(0)}`).join('\n');
                            }

                            const prompt = `Sen profesyonel bir Kurumsal Hedge Fon Analisti ve Risk Yöneticisisin. Aşağıdaki işlem, daha önce kendi ürettiğin BİR KURAL (Lesson) sebebiyle GİRİLMEYEREK ENGELLENDİ.
Fakat işlem şaşırtıcı şekilde HEDEFE ULAŞTI (Win). Kuralımız çok katı davranmış.

Engelleyici Orijinal Kuralımız:
${originalLesson}

İşlem Grafiği Verileri:
Varlık: ${trade.symbol} (${trade.type})
Giriş Fiyatı: ${trade.entryPrice}
Ulaştığı Hedef: ${trade.targetPrice}
Son 24 Saatlik Mum Akışı:
${candleContext}

Görev: Kuralı tamamen çöpe atmak yerine, bu olayı analiz edip kurala bir "İSTİSNA (Exception)" maddesi ekleyeceksin.
Bana Orijinal Kuralı tekrar ver, devamına da "İSTİSNA: [Bu şartlar altındaysa kurala uyulmayabilir...]" şeklinde tek bir net uyarı ekle. Laf kalabalığı yapma, direkt kuralı ve istisnasını yaz.`;

                            const aiRes = await model.generateContent(prompt);
                            const exceptionRuleText = aiRes.response.text().trim();

                            await runExec("UPDATE ai_lessons SET lessonText = ? WHERE id = ?", [exceptionRuleText, trade.lessonId]);
                            console.log(`[SHADOW EXPLORATION] Kural güncellendi: ${exceptionRuleText}`);

                            if (bot && TELEGRAM_ADMIN_CHAT_ID) {
                                bot.sendMessage(TELEGRAM_ADMIN_CHAT_ID, `⚠️ *Ajan Yanıldı! (Katı Kurallar Revize Edildi)* ⚠️\n\n🎯 #${trade.symbol} işlemine "Ders ID:${trade.lessonId}" nedeniyle girmemiştik ancak işlem HEDEFE GİTTİ!\n\n🧠 *Kural Silinmedi, İstisna Eklendi:*\nSistemin analizi sonucu Ders ${trade.lessonId} yeniden yorumlandı ve "İstisna" alt başlığına sahip esnek bir ağaç yapısına geçildi.\n\n_Yeni Kural:_ ${exceptionRuleText}`, { parse_mode: 'Markdown' });
                            }
                        }
                    } catch (err) {
                        console.error("[SHADOW EVOLUTION] Error adapting AI lesson:", err.message);
                    }
                } else {
                    if (bot && TELEGRAM_ADMIN_CHAT_ID) {
                        bot.sendMessage(TELEGRAM_ADMIN_CHAT_ID, `⚠️ *Ajan Yanıldı!* \n🎯 #${trade.symbol} işlemi HEDEFE GİTTİ!`);
                    }
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
