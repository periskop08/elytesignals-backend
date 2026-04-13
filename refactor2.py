import re

with open('/Users/periskop/.gemini/antigravity/scratch/crypto-signal-app/backend/scanner.js', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Dynamic Threshold
t_old = """        // V3.3 (Hacim ve Ağ Optimizasyonu) Yeni Baraj 55 (Ticari Hacmi Koruma Refleksi)
        if (direction === 'LONG' && qualityScore < 55) {
            return null;
        }
        if (direction === 'SHORT' && qualityScore < 55) {
            return null;
        }

        // 🚨 DEMİR BEY (LİKİDİTE VE KAYMA KALKANI - SOFT-FAIL) 🚨
        if (qualityScore >= 55) {"""

t_new = """        // 1. Dinamik Kalite Barajı (Dynamic Threshold)
        let dynamicThreshold = 55;
        if (breakdown.regime === 'TRENDING_VOLATILE') dynamicThreshold = 50;
        else if (breakdown.regime === 'RANGING') dynamicThreshold = 60;
        
        if (qualityScore < dynamicThreshold) {
            return null;
        }

        // 🚨 DEMİR BEY (LİKİDİTE VE KAYMA KALKANI - SOFT-FAIL) 🚨
        if (qualityScore >= dynamicThreshold) {"""

code = code.replace(t_old, t_new)


# 2. Memory Decay
code = code.replace(
    "SELECT * FROM ai_lessons WHERE status = 'ACTIVE' ORDER BY id DESC LIMIT 15",
    "SELECT * FROM ai_lessons WHERE status = 'ACTIVE' AND datetime(createdAt) >= datetime('now', '-30 days') ORDER BY id DESC LIMIT 15"
)


# 3. Dynamic Slippage
s_old = """                                        const slippage = Math.abs(currentLivePrice - signal.entryPrice) / signal.entryPrice;
                                        if (slippage > 0.003) {
                                            slippageExceeded = true;
                                        }"""
s_new = """                                        const slippage = Math.abs(currentLivePrice - signal.entryPrice) / signal.entryPrice;
                                        const riskWidth = Math.abs(signal.entryPrice - signal.stopPrice) / signal.entryPrice;
                                        const maxSlippage = Math.max(0.002, riskWidth * 0.15); // Stop'un %15'ine kadar müsaade (min binde 2)
                                        if (slippage > maxSlippage) {
                                            slippageExceeded = true;
                                        }"""
code = code.replace(s_old, s_new)


# 4. Correlation Engine
c_old = """                                } else {
                                    // +--- DYNAMIC POSITION SIZING (RİSK ÇARPANI VE KALİTE) ---+
                                    let riskMultiplier = 1.0;"""

c_new = """                                } else {
                                    // +--- SEPET KORELASYON MOTORU ---+
                                    let skipAutoTrade = false;
                                    try {
                                        const sectorMap = {
                                            "BTC": "L1", "ETH": "L1", "SOL": "L1", "AVAX": "L1", "BNB": "L1",
                                            "FET": "AI", "AGIX": "AI", "WLD": "AI", "RENDER": "AI", "NEAR": "AI", "TAO": "AI",
                                            "DOGE": "MEME", "SHIB": "MEME", "PEPE": "MEME", "BOME": "MEME", "FLOKI": "MEME", "WIF":"MEME"
                                        };
                                        const baseSymbol = signal.symbol.replace('-USDT', '').replace('USDT', '');
                                        const clusterName = sectorMap[baseSymbol] || 'OTHER';
                                        
                                        if (clusterName !== 'OTHER') {
                                            const activeTrades = await db.all("SELECT symbol FROM user_trades WHERE status = 'ACTIVE'");
                                            let clusterCount = 0;
                                            activeTrades.forEach(t => {
                                                const tBase = t.symbol.replace('-USDT', '').replace('USDT', '');
                                                if (sectorMap[tBase] === clusterName) clusterCount++;
                                            });
                                            if (clusterCount >= 2) {
                                                skipAutoTrade = true;
                                                console.log(`[CORRELATION REJECT] ${clusterName} sektöründe zaten ${clusterCount} adet aktif işlem var. Borsaya oto-emir atılmayacak (UI Sinyali Aktif).`);
                                                if (bot && CONFIG.telegramAdminId) {
                                                    bot.sendMessage(CONFIG.telegramAdminId, `🛡️ *Sepet Riski Koruma Kalkanı Devrede*\n\n🎯 #${signal.symbol} işlemi için sinyal üretildi ancak **borsaya emir gönderilmedi!**\nNedeni: Sepette zaten maksimum toleransta (2 adet) açık **${clusterName}** coini bulunuyor.`, { parse_mode: 'Markdown' });
                                                }
                                            }
                                        }
                                    } catch(e) {}

                                    if (!skipAutoTrade) {
                                        // +--- DYNAMIC POSITION SIZING (RİSK ÇARPANI VE KALİTE) ---+
                                        let riskMultiplier = 1.0;"""

code = code.replace(c_old, c_new)

# Match the catch block closing for Auto-Trade
b_old = """                                            console.error(`[AUTO-TRADE] Borsa Emir İletim Hatası:`, e.message);
                                        }
                                    }
                                } else {"""
                                
b_new = """                                            console.error(`[AUTO-TRADE] Borsa Emir İletim Hatası:`, e.message);
                                        }
                                    } // End !skipAutoTrade
                                    }
                                } else {"""

code = code.replace(b_old, b_new)

with open('/Users/periskop/.gemini/antigravity/scratch/crypto-signal-app/backend/scanner.js', 'w', encoding='utf-8') as f:
    f.write(code)

print("Phase 2 Python refactoring saved successfully.")
