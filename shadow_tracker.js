require('dotenv').config();
const cron = require('node-cron');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { logTokenUsage } = require('./usage_tracker');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-3.1-pro-preview" });

const dbPath = path.resolve(__dirname, 'signals.db');
const db = new sqlite3.Database(dbPath);

const { TELEGRAM_BOT_TOKEN, ADMIN_TELEGRAM_ID } = process.env;
const bot = TELEGRAM_BOT_TOKEN ? new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false }) : null;

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

const ASSET_MAP = {
    'XAUUSD': 'NCCOGOLD2USD-USDT',
    'XAGUSD': 'NCCOXAG2USD-USDT',
    'EURUSD': 'NCFXEUR2USD-USDT',
    'AAPL': 'NCSKAAPL2USD-USDT',
    'TSLA': 'NCSKTSLA2USD-USDT',
    'NASDAQ': 'NCSINASDAQ1002USD-USDT',
    'SP500': 'NCSISP5002USD-USDT',
    'DOW': 'NCSIDJI2USD-USDT'
};

function resolveBingxSymbol(rawSymbol) {
    if (!rawSymbol) return rawSymbol;
    if (ASSET_MAP[rawSymbol]) return ASSET_MAP[rawSymbol];
    return rawSymbol.includes('-') ? rawSymbol : rawSymbol.replace('USDT', '-USDT');
}

async function fetchCurrentPrice(rawSymbol) {
    try {
        const symbol = resolveBingxSymbol(rawSymbol);
        const res = await axios.get(`https://open-api.bingx.com/openApi/swap/v2/quote/ticker?symbol=${symbol}`);
        if (res.data && res.data.data && res.data.data.lastPrice) {
            return parseFloat(res.data.data.lastPrice);
        }
    } catch(e) { }
    return null;
}

async function fetchBingxCandles(rawSymbol, intervalMinutes, limit) {
    try {
        const symbol = resolveBingxSymbol(rawSymbol);
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

async function checkSandboxRules(lessonId) {
    if (!lessonId) return;
    const lessonData = await runQuery("SELECT status, matchCount, successCount, lessonText FROM ai_lessons WHERE id = ?", [lessonId]);
    if (!lessonData || lessonData.length === 0) return;
    const l = lessonData[0];
    if (l.status !== 'TEST') return;
    
    if (l.matchCount >= 15) {
        const missedWins = l.matchCount - l.successCount;
        const netR = l.successCount - (missedWins * 1.25);
        
        if (netR > 0) {
             await runExec("UPDATE ai_lessons SET status = 'ACTIVE', reliability = 100, missCount = 0 WHERE id = ?", [lessonId]);
             if (bot && process.env.ADMIN_TELEGRAM_ID) {
                 bot.sendMessage(process.env.ADMIN_TELEGRAM_ID, `🐺 *Börü Bey: Sandbox Kuralı Başarıyla Mezun Oldu!* 🐺\n\n🎯 Ders ID: ${lessonId}\n📊 15 Sinyal Testinde Net Beklenti (R-Expectancy): +${netR.toFixed(2)}R\nAna sisteme 'ACTIVE' olarak eklendi! Artık canlı işlemleri filtreleyecek.\n\n_Kural:_ ${l.lessonText}`);
             }
        } else {
             await runExec("UPDATE ai_lessons SET status = 'ARCHIVED' WHERE id = ?", [lessonId]);
             if (bot && process.env.ADMIN_TELEGRAM_ID) {
                 bot.sendMessage(process.env.ADMIN_TELEGRAM_ID, `🗑️ *Börü Bey: Sandbox Kuralı Çöpe Atıldı!* 🗑️\n\n🎯 Ders ID: ${lessonId}\n📊 15 Sinyal Testinde Fırsat Maliyeti (False Veto) ağır bastı! (Net R: ${netR.toFixed(2)}R). Kural uzun vadede zarar ettireceği için Arşive (ARCHIVED) alındı.`);
             }
        }
    }
}

async function checkShadowTrades() {
    try {
        const pending = await runQuery("SELECT * FROM shadow_trades WHERE status IN ('PENDING', 'SHADOW_TEST_PENDING')");
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
                if (trade.status === 'SHADOW_TEST_PENDING') {
                    await runExec("UPDATE shadow_trades SET status = 'SHADOW_TEST_LOSS', closedAt = CURRENT_TIMESTAMP WHERE id = ?", [trade.id]);
                    if (trade.lessonId) {
                        await runExec("UPDATE ai_lessons SET matchCount = matchCount + 1, successCount = successCount + 1 WHERE id = ?", [trade.lessonId]);
                        await checkSandboxRules(trade.lessonId);
                    }
                } else {
                    await runExec("UPDATE shadow_trades SET status = 'LOSS', closedAt = CURRENT_TIMESTAMP WHERE id = ?", [trade.id]);
                    console.log(`[BÖRÜ_BEY] Sistem Haklı Çıktı! Uzak durduğumuz ${trade.symbol} (${trade.type}) işlemi patladı (LOSS).`);
                    let reliabilityMsg = "";
                    let lessonDescription = `Ders ID:${trade.lessonId}`;
                    if (trade.lessonId === -999) {
                        lessonDescription = `"Yetersiz ADX / Düşük Kalite Skoru (Sabit Motor Kuralı)"`;
                    } else if (trade.lessonId === -998) {
                        lessonDescription = `"Demir Bey Tahta Koruması (Sığ Tahta / Yüksek Makas)"`;
                    } else if (trade.lessonId) {
                        await runExec("UPDATE ai_lessons SET reliability = reliability + 10 WHERE id = ?", [trade.lessonId]);
                        reliabilityMsg = " (Kural Güvenilirliği +10 Puan Arttı!)";
                        try {
                            const lRow = await runQuery("SELECT lessonText FROM ai_lessons WHERE id = ?", [trade.lessonId]);
                            if (lRow && lRow.length > 0) {
                                lessonDescription = `(Ders ID:${trade.lessonId})\n_${lRow[0].lessonText}_`;
                            }
                        } catch(err) {}
                    }
                    
                    if (bot && process.env.ADMIN_TELEGRAM_ID) {
                        bot.sendMessage(process.env.ADMIN_TELEGRAM_ID, `🐺 *Börü Bey Haklı Çıktı! (Ders Onaylandı)* 🐺\n\n⛔ ${trade.symbol} işlemine şu sebeple girmemiştik:\n${lessonDescription}\n\nİyi ki girmemişiz, işlem grafikte STOP-LOSS noktasına vurdu! Otonom takım çalışması başarılı.${reliabilityMsg}`, { parse_mode: 'Markdown' });
                    }
                }
            } else if (hitWin) {
                if (trade.status === 'SHADOW_TEST_PENDING') {
                    await runExec("UPDATE shadow_trades SET status = 'SHADOW_TEST_WIN', closedAt = CURRENT_TIMESTAMP WHERE id = ?", [trade.id]);
                    if (trade.lessonId) {
                        await runExec("UPDATE ai_lessons SET matchCount = matchCount + 1 WHERE id = ?", [trade.lessonId]);
                        await checkSandboxRules(trade.lessonId);
                    }
                } else {
                    await runExec("UPDATE shadow_trades SET status = 'WIN', closedAt = CURRENT_TIMESTAMP WHERE id = ?", [trade.id]);
                console.log(`[BÖRÜ_BEY] Sistem Yanıldı! Engellediğimiz ${trade.symbol} (${trade.type}) işlemi hedefe ulaştı (WIN).`);
                
                if (trade.lessonId === -999) {
                    if (bot && process.env.ADMIN_TELEGRAM_ID) {
                        bot.sendMessage(process.env.ADMIN_TELEGRAM_ID, `⚠️ *Sistem Vetosu (ADX) İhlali!* ⚠️\n\n🎯 #${trade.symbol} işlemi için ADX düşük diye koda koyduğumuz sabit kural işlemi iptal etmişti.\nFakat işlem HEDEFE GİTTİ (WIN)!\n\n_Bu işlem yapay zeka tarafından değil, 'scanner.js' sabit ADX kuralı tarafından engellenmişti. ADX barajını gözden geçirmek isteyebilirsin._`, { parse_mode: 'Markdown' });
                    }
                } else if (trade.lessonId === -998) {
                    if (bot && process.env.ADMIN_TELEGRAM_ID) {
                        bot.sendMessage(process.env.ADMIN_TELEGRAM_ID, `⚠️ *Demir Bey (Sığ Tahta) İhlali!* ⚠️\n\n🎯 #${trade.symbol} işlemi "Sığ Tahta/Yüksek Spread" diye Demir Bey tarafından çöpe atılmıştı.\nFakat işlem HEDEFE GİTTİ (WIN)!\n\n_Eğer bu uyarıları çok sık görüyorsan, Demir Bey'in Likidite makasını daraltmayı düşünebilirsin._`, { parse_mode: 'Markdown' });
                    }
                } else if (trade.lessonId) {
                    try {
                        const lessonData = await runQuery("SELECT lessonText, missCount FROM ai_lessons WHERE id = ?", [trade.lessonId]);
                        if (lessonData && lessonData.length > 0) {
                            const originalLesson = lessonData[0].lessonText;
                            const currentMissCount = lessonData[0].missCount || 0;

                            if (currentMissCount < 2) {
                                // 3-Strike Kuralı: Hemen kuralı bozma, sadece uyar ve güveni düşür.
                                await runExec("UPDATE ai_lessons SET missCount = missCount + 1, reliability = reliability - 5 WHERE id = ?", [trade.lessonId]);
                                if (bot && ADMIN_TELEGRAM_ID) {
                                    bot.sendMessage(process.env.ADMIN_TELEGRAM_ID, `⚠️ *Börü Bey Uyarıyor! (Fırsat Kaçtı)* ⚠️\n\n🎯 #${trade.symbol} işlemi HEDEFE GİTTİ ama biz şu kural yüzünden girmedik:\n_${originalLesson}_\n\n_Bu kuralın ${currentMissCount + 1}. falsosu! Hata payı (Miss) arttırıldı. Bir daha hata yaparsa yapay zeka tarafından revize edilecek._`, { parse_mode: 'Markdown' });
                                }
                            } else {
                                // Strike 3! Kuralı revize et ve Miss Count'u sıfırla
                                await runExec("UPDATE ai_lessons SET missCount = 0, reliability = reliability - 10 WHERE id = ?", [trade.lessonId]);
                                
                                const candles = await fetchBingxCandles(trade.symbol, 60, 24);
                                let candleContext = "Son 24 Saatlik Veri Mevcut Değil.";
                                if (candles && candles.length > 0) {
                                    candleContext = candles.map((c, i) => `H${i+1}: Açılış=${c.open.toFixed(4)}, Kapanış=${c.close.toFixed(4)}, Hacim=${c.volume.toFixed(0)}`).join('\n');
                                }

                                let breakdownContext = "Teknik Veri Yok.";
                                if (trade.breakdownData) {
                                    try {
                                        const bd = JSON.parse(trade.breakdownData);
                                        breakdownContext = `Market Rejimi: ${bd.regime || 'Bilinmiyor'}, ADX (Trend Gücü): ${bd.adx || 0}, Göreceli Hacim (RVöl): ${bd.rvol || 0}`;
                                    } catch(e) {}
                                }

                                const prompt = `Sen profesyonel bir Kurumsal Hedge Fon Analisti ve Risk Yöneticisisin. Aşağıdaki işlem, daha önce kendi ürettiğin BİR KURAL (Lesson) sebebiyle GİRİLMEYEREK ENGELLENDİ.
Fakat işlem şaşırtıcı şekilde HEDEFE ULAŞTI (Win). Kuralımız çok katı davranmış. (Not: Sistemimizin maksimum teknik Kalite Başarı Puanı 85 üzerinden değerlendirilmektedir).

Engelleyici Orijinal Kuralımız:
${originalLesson}

İşlem Grafiği Verileri:
Varlık: ${trade.symbol} (${trade.type})
Giriş Fiyatı: ${trade.entryPrice}
Ulaştığı Hedef: ${trade.targetPrice}

O Anki İşlem Teknik Durum Raporu:
${breakdownContext}

Son 24 Saatlik Mum Akışı:
${candleContext}

Görev: Kuralı tamamen çöpe atmak yerine, bu olayı analiz edip kurala bir "İSTİSNA (Exception)" maddesi ekleyeceksin.
Önce "GEREKÇE:" başlığı altında bu istisnayı NEDEN eklediğini (özellikle gönderilen Teknik Durum Raporunu ve ADX değerini kullanarak) detaylıca anlat. Sonra "YENİ KURAL:" başlığı altında Orijinal Kuralı ve İstisna kısmını birleştirerek yaz.`;

                                const aiRes = await model.generateContent(prompt);
                                await logTokenUsage('Börü Bey', aiRes);
                                const exceptionRuleText = aiRes.response.text().trim();

                                await runExec("UPDATE ai_lessons SET lessonText = ?, status = 'TEST', matchCount = 0, successCount = 0 WHERE id = ?", [exceptionRuleText, trade.lessonId]);
                                console.log(`[BÖRÜ_BEY] Kural 3. hatasında güncellendi ve TEST (Sandbox) moduna alındı: ${exceptionRuleText}`);

                                if (bot && ADMIN_TELEGRAM_ID) {
                                    bot.sendMessage(ADMIN_TELEGRAM_ID, `⚠️ *Börü Bey (Sandbox) Uyarıyor! (Kural Test Moduna Alındı!)* ⚠️\n\n🎯 #${trade.symbol} işlemine "Ders ID:${trade.lessonId}" nedeniyle girmedik ve işlem HEDEFE GİTTİ! (Bu kuralın 3. ciddi hatası).\n\n🧠 *Kural Silinmedi, İstisna Eklendi ve TEST'e Çekildi:*\nSistemin analizi sonucu Ders ${trade.lessonId} yeniden incelendi ve "İstisna" eklenerek Sandbox'a (TEST) itildi. 15 Başarılı Gölge işlem (Win Rate %60) görmeden Ana Sistemi etkileyemeyecek.\n\n_Börü Bey'in Otopsi Analizi:_\n${exceptionRuleText}`, { parse_mode: 'Markdown' });
                                }
                            }
                        }
                    } catch (err) {
                        console.error("[BÖRÜ_BEY] Error adapting AI lesson:", err.message);
                    }
                } else {
                    if (bot && ADMIN_TELEGRAM_ID) {
                        bot.sendMessage(ADMIN_TELEGRAM_ID, `⚠️ *Börü Bey Uyarıyor!* \n🎯 #${trade.symbol} işlemi HEDEFE GİTTİ ama biz girmedik!`);
                    }
                }
            }
        }
    }
} catch (e) {
        console.error("[BÖRÜ_BEY] Shadow check error:", e);
    }
}

console.log("[BÖRÜ_BEY] Gölge Takip Ajanı (Börü Bey) Aktif!");
setInterval(checkShadowTrades, 60000); // Her dakikada bir kontrol et
checkShadowTrades();

// Her gece 03:20'de Börü Bey'in Telegram raporu
cron.schedule('20 3 * * *', async () => {
    try {
        const row = await runQuery(`SELECT count(id) as cnt FROM user_trades WHERE status = 'CLOSED' AND pnl < 0 AND datetime(closedAt) > datetime('now', '-24 hours')`);
        let totalAutopsy = (row && row.length > 0) ? row[0].cnt : 0;

        // Shadow İstatistiklerini Topla
        const shadowsToday = await runQuery(`SELECT * FROM shadow_trades WHERE status IN ('WIN', 'SHADOW_TEST_WIN', 'LOSS', 'SHADOW_TEST_LOSS') AND datetime(closedAt) > datetime('now', '-24 hours')`);
        
        let winC = 0, lossC = 0;
        let totalR = 0;

        if (shadowsToday && shadowsToday.length > 0) {
            for (let st of shadowsToday) {
                if (st.status.includes('WIN')) {
                    winC++;
                    // Calculate R Reward
                    const risk = Math.abs(st.entryPrice - st.stopPrice);
                    const reward = Math.abs(st.targetPrice - st.entryPrice);
                    const R = risk > 0 ? (parseFloat((reward / risk).toFixed(2))) : 0;
                    totalR += R;
                } else if (st.status.includes('LOSS')) {
                    lossC++;
                    totalR -= 1.0; // 1 R Loss
                }
            }
        }

        let totalSCount = winC + lossC;
        let wr = totalSCount > 0 ? ((winC / totalSCount) * 100).toFixed(1) : 0;
        let theoGrowth = totalR > 0 ? `+%${totalR.toFixed(2)}` : `%${totalR.toFixed(2)}`;

        let msg = `🐺 *Merhaba ben Börü Bey; Görevimin başındayım.*\n\nBugün ana portföyümüzdeki işlemleri saniye saniye takip ederek, stop olan *${totalAutopsy}* adet işlemi incelenmesi için Arif Bey'e (Otopsi) sevk ettim.\n\n`;
        
        msg += `📊 *BÖRÜ BEY GÖLGE (SHADOW) PERFORMANSI (Son 24s)* 📊\n`;
        msg += `_Sistemin reddettiği ama benim arka planda sanal olarak işlemeye devam ettiğim sinyallerin durumu:_\n\n`;
        msg += `🔹 *Takip Edilen:* ${totalSCount} İşlem\n`;
        msg += `✅ *Hedefe Ulaşan (Win):* ${winC}\n`;
        msg += `❌ *Patlayan (Loss):* ${lossC}\n`;
        msg += `🎯 *Win Rate:* %${wr}\n`;
        msg += `📏 *Kazanılan Net R:* ${totalR.toFixed(2)} R\n`;
        msg += `💰 *Teorik Kasa Etkisi:* ${theoGrowth} (İşlem başı %1 risk ile)\n\n`;
        msg += `Nöbete devam ediyorum, iyi geceler.`;

        if (bot && process.env.ADMIN_TELEGRAM_ID) {
            await bot.sendMessage(process.env.ADMIN_TELEGRAM_ID, msg, { parse_mode: 'Markdown' });
            console.log("[BÖRÜ_BEY] Günlük detaylı rapor Telegram'a iletildi.");
        }
    } catch(e) {
        console.error("[BÖRÜ_BEY] Günlük rapor hatası:", e.message);
    }
});
