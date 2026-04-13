import re

with open('/Users/periskop/.gemini/antigravity/scratch/crypto-signal-app/backend/scanner.js', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Soft Veto
s_old = """                if (isBlocked) {
                    console.log(`[SHADOW BLOCK] Sinyal Engellendi: ${signal.symbol} -> ${blockReason}`);
                    await db.run(
                        "INSERT INTO shadow_trades (symbol, type, entryPrice, targetPrice, stopPrice, lessonId, qualityScore) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        [signal.symbol, signal.type, signal.entryPrice, signal.targetPrice, signal.stopPrice, blockLessonId, signal.qualityScore]
                    );

                    // Telegram Admin'e Uyarı Gönder
                    if (telegramBot && CONFIG.telegramAdminId) {
                        try {
                            telegramBot.sendMessage(CONFIG.telegramAdminId, `🤖 *Otonom Ajan Sinyali Reddetti (Shadow Mode)* 🤖\\n\\n🎯 *Parite:* #${signal.symbol} (${signal.type})\\n⛔ *Sebep:* ${blockReason}\\n\\nBu sinyal veritabanına ve gruba düşmedi. Sadece gölge modunda arka planda PnL takibine alındı.`, { parse_mode: 'Markdown' });
                        } catch(e) {}
                    }
                    continue; // Skip DB insertion and everything else
                }"""

s_new = """                if (isBlocked) {
                    console.log(`[SHADOW BLOCK] Danışman LLM Puan Kırdı: ${signal.symbol} -> ${blockReason}`);
                    
                    signal.qualityScore -= 25;
                    signal.warnings = (signal.warnings ? signal.warnings + ', ' : '') + 'LLM VETOSU (-25)';

                    await db.run(
                        "INSERT INTO shadow_trades (symbol, type, entryPrice, targetPrice, stopPrice, lessonId, qualityScore) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        [signal.symbol, signal.type, signal.entryPrice, signal.targetPrice, signal.stopPrice, blockLessonId, signal.qualityScore]
                    );

                    // Telegram Admin'e Uyarı Gönder
                    if (telegramBot && CONFIG.telegramAdminId) {
                        try {
                            telegramBot.sendMessage(CONFIG.telegramAdminId, `👨‍🏫 *Danışman Ajan Sinyali Notladı (Soft Veto)* 👨‍🏫\\n\\n🎯 *Parite:* #${signal.symbol} (${signal.type})\\n⛔ *Uyarı:* ${blockReason}\\n\\nBu sinyal veritabanına kaydedildi ancak Kalite Puanı -25 düşürüldü. Gölge PnL takibine de alındı.`, { parse_mode: 'Markdown' });
                        } catch(e) {}
                    }
                }"""

code = code.replace(s_old, s_new)

# 2. Prevent Auto-Trade if SCORE drops below threshold
a_old = """                // --- AUTO TRADING BLOCK START ---
                if (process.env.BINGX_API_KEY && process.env.PERISKOP_TELEGRAM_ID && !symbolInfo.isAsset) {"""

a_new = """                // --- AUTO TRADING BLOCK START ---
                if (signal.qualityScore < dynamicThreshold) {
                    console.log(`[AUTO-TRADE] Atlandı: Soft Veto Sonrası Puanı ${signal.qualityScore} (Gerekli: ${dynamicThreshold})`);
                } else if (process.env.BINGX_API_KEY && process.env.PERISKOP_TELEGRAM_ID && !symbolInfo.isAsset) {"""

code = code.replace(a_old, a_new)

with open('/Users/periskop/.gemini/antigravity/scratch/crypto-signal-app/backend/scanner.js', 'w', encoding='utf-8') as f:
    f.write(code)

print("Phase 3 Soft Veto Script Finished")
