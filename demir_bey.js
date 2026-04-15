const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cron = require('node-cron');
require('dotenv').config();

const dbPath = path.resolve(__dirname, 'signals.db');
const db = new sqlite3.Database(dbPath);

// Stat tablosunu başlat
db.run(`CREATE TABLE IF NOT EXISTS demir_stats (
    date TEXT PRIMARY KEY,
    processed INTEGER DEFAULT 0,
    penalties INTEGER DEFAULT 0,
    bonuses INTEGER DEFAULT 0,
    bypassed INTEGER DEFAULT 0
)`);

function recordStat(type) {
    const today = new Date().toISOString().split('T')[0];
    db.run("INSERT OR IGNORE INTO demir_stats (date) VALUES (?)", [today], () => {
        let col = "processed";
        if (type === 'penalty') col = "penalties";
        else if (type === 'bonus') col = "bonuses";
        else if (type === 'bypassed') col = "bypassed";

        db.run(`UPDATE demir_stats SET processed = processed + 1, ${col} = ${col} + 1 WHERE date = ?`, [today]);
    });
}

function recordBypass() {
    const today = new Date().toISOString().split('T')[0];
    db.run("INSERT OR IGNORE INTO demir_stats (date) VALUES (?)", [today], () => {
        db.run(`UPDATE demir_stats SET bypassed = bypassed + 1 WHERE date = ?`, [today]);
    });
}

/**
 * Demir Bey (Likidite ve Kayan Nokta Yöneticisi)
 * 
 * Bu ajan, Altay Bey'in teknik olarak bulduğu sinyalin,
 * borsa (BingX) sipariş defterinde (Order Book) yeterli likiditeye
 * sahip olup olmadığını ve spread (Alış/Satış makası) oranının
 * işlem girmeye uygun olup olmadığını kontrol eder.
 * 
 * Amaç: Yüksek kayma (slippage) riskini filtrelemek ve 
 * gerektiğinde işleme ceza puanı (-15) kesmektir.
 */

async function checkLiquidityAsync(symbol, direction, currentPrice, stopPrice, globalVol) {
    try {
        let fetchSymbol = symbol.includes('-') ? symbol : symbol.replace('USDT', '-USDT');

        let tier = 3;
        const tier1List = ['BTCUSDT','ETHUSDT','BTC-USDT','ETH-USDT','BNBUSDT','BNB-USDT','SOLUSDT','SOL-USDT'];
        if (tier1List.includes(symbol)) {
            tier = 1;
        } else if (globalVol && parseFloat(globalVol) >= 150000000) {
            tier = 2; // 150M+ hacim uzeri Tier-2
        }

        const url = `https://open-api.bingx.com/openApi/swap/v2/quote/depth?symbol=${fetchSymbol}&limit=30`;
        const response = await axios.get(url, { timeout: 1500 }); 
        
        if (response.data && response.data.code === 0 && response.data.data) {
            const data = response.data.data;
            if (!data.bids || !data.asks || data.bids.length === 0 || data.asks.length === 0) {
                recordBypass();
                return { scoreMod: 0, msg: "Likidite verisi eksik (Otonom İzin)", telemetry: {tier} };
            }

            const bestBidPrice = parseFloat(data.bids[0][0]);
            const bestAskPrice = parseFloat(data.asks[0][0]);

            if (bestAskPrice === 0) {
                recordBypass();
                return { scoreMod: 0, msg: "Ask Price = 0 (Otonom İzin)", telemetry: {tier} };
            }

            const spreadPct = ((bestAskPrice - bestBidPrice) / bestAskPrice) * 100;
            
            let bidsVolumeUsd = 0;
            // Sadece İlk 10 Kademe (Gerçekçi slippage alanı)
            const bidsCount = Math.min(data.bids.length, 10);
            for (let i = 0; i < bidsCount; i++) {
                bidsVolumeUsd += parseFloat(data.bids[i][0]) * parseFloat(data.bids[i][1]);
            }
            
            let asksVolumeUsd = 0;
            const asksCount = Math.min(data.asks.length, 10);
            for (let i = 0; i < asksCount; i++) {
                asksVolumeUsd += parseFloat(data.asks[i][0]) * parseFloat(data.asks[i][1]);
            }

            let estimatedRiskUsd = 500 * 0.01; // Varsayılan $5 risk (%1)
            let stopDistanceRatio = 0.01;
            if (currentPrice && stopPrice && currentPrice > 0) {
                stopDistanceRatio = Math.abs(currentPrice - stopPrice) / currentPrice;
            }
            if (stopDistanceRatio <= 0.0001) stopDistanceRatio = 0.001; 
            const estimatedNotional = estimatedRiskUsd / stopDistanceRatio;

            // Terslik Derinliği: LONG giriyorsak Asks (Satış Emri arıyoruz), SHORT yapıyorsak Bids.
            const opposingDepthUsd = direction === 'LONG' ? asksVolumeUsd : bidsVolumeUsd;
            const depthRatio = estimatedNotional > 0 ? (opposingDepthUsd / estimatedNotional) : 999;

            let scoreMod = 0;
            let msg = '';
            
            if (tier === 1) {
                if (spreadPct > 0.45) { scoreMod -= 15; msg = `Tier-1 Yüksek Spread (%${spreadPct.toFixed(2)})`; }
                else if (spreadPct > 0.25) { scoreMod -= 5; msg = `Tier-1 Orta Spread (%${spreadPct.toFixed(2)})`; }
                
                if (depthRatio < 5) { scoreMod -= 15; msg += ` | Sığ Tahta (${Math.round(depthRatio)}x Ratio)`; }
                else if (depthRatio < 10) { scoreMod -= 5; msg += ` | Zayıf Tahta (${Math.round(depthRatio)}x Ratio)`; }
            } else if (tier === 2) {
                if (spreadPct > 0.60) { scoreMod -= 15; msg = `Tier-2 Yüksek Spread (%${spreadPct.toFixed(2)})`; }
                else if (spreadPct > 0.35) { scoreMod -= 5; msg = `Tier-2 Orta Spread (%${spreadPct.toFixed(2)})`; }
                
                if (depthRatio < 8) { scoreMod -= 15; msg += ` | Sığ Tahta (${Math.round(depthRatio)}x Ratio)`; }
                else if (depthRatio < 15) { scoreMod -= 5; msg += ` | Zayıf Tahta (${Math.round(depthRatio)}x Ratio)`; }
            } else {
                if (spreadPct > 0.80) { scoreMod -= 15; msg = `Tier-3 Yüksek Spread (%${spreadPct.toFixed(2)})`; }
                else if (spreadPct > 0.50) { scoreMod -= 5; msg = `Tier-3 Orta Spread (%${spreadPct.toFixed(2)})`; }
                
                if (depthRatio < 8) { scoreMod -= 15; msg += ` | Sığ Tahta (${Math.round(depthRatio)}x Ratio)`; }
                else if (depthRatio < 15) { scoreMod -= 5; msg += ` | Zayıf Tahta (${Math.round(depthRatio)}x Ratio)`; }
            }

            // Sabit Maksimum penalty -15
            if (scoreMod < -15) scoreMod = -15;

            let decision = 'PASS';
            if (scoreMod === -15) decision = 'HARD_VETO';
            else if (scoreMod < 0) decision = 'SOFT_PENALTY';

            const telemetry = {
                tier: tier,
                spreadPct: parseFloat(spreadPct.toFixed(3)),
                bidsUsd: Math.round(bidsVolumeUsd),
                asksUsd: Math.round(asksVolumeUsd),
                estimatedNotional: Math.round(estimatedNotional),
                depthRatio: parseFloat(depthRatio.toFixed(1)),
                decision: decision
            };

            if (scoreMod === 0) {
                recordStat('normal');
                return { scoreMod: 0, msg: "", telemetry };
            } else {
                recordStat('penalty');
                return { scoreMod: scoreMod, msg: msg.replace(/^ \| /, ''), telemetry };
            }
        }
        
        recordBypass();
        return { scoreMod: 0, msg: "Likidite API Hatası (Otonom İzin)", telemetry: {tier: 3} };
    } catch (err) {
        recordBypass();
        return { scoreMod: 0, msg: `Demir Bey Timeout/Hata (Otonom İzin)`, telemetry: {tier: 3} };
    }
}

async function sendTelegramMessage(message) {
    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.ADMIN_TELEGRAM_ID) return;
    try {
        const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
        await axios.post(url, {
            chat_id: process.env.ADMIN_TELEGRAM_ID,
            text: message,
            parse_mode: 'Markdown'
        });
    } catch (e) {
        console.error('[Demir Bey] Telegram Hatası:', e.message);
    }
}

// Her Gece 03:40'ta Günlük Rapor Gönder
cron.schedule('40 3 * * *', () => {
    const today = new Date().toISOString().split('T')[0];
    db.get("SELECT * FROM demir_stats WHERE date = ?", [today], async (err, row) => {
        if (err) {
            console.error(err);
            return;
        }

        let msg = `🛡️ *Merhaba ben Demir Bey;*\n\nBugün Altay Bey'in ilettiği işlemleri emir defteri (likidite) açısından filtreledim. Günlük infaz raporum:\n\n`;
        
        if (!row || row.processed === 0) {
            msg += `📉 *0* işlem analiz edildi.\nPiyasada onayıma ulaşacak kalitede bir sinyal oluşmadı.`;
        } else {
            msg += `🔍 İncelenen Toplam Sinyal: *${row.processed}*\n`;
            msg += `🚨 Ceza Kesilip İptal Edilenler: *${row.penalties}*\n`;
            msg += `✅ Ekstra Bonus Puanı Alanlar: *${row.bonuses}*\n`;
            msg += `⚠️ Borsa API Hatası/Bypass: *${row.bypassed}*\n\n`;
            msg += `Saygılarımla, Tahta İnfazcınız.`;
        }
        
        await sendTelegramMessage(msg);
    });
}, {
    timezone: "Europe/Istanbul"
});

async function sendOnDutyMessage() {
    await sendTelegramMessage("🛡️ *Demir Bey*: Emir tahtası yetkilerimi devraldım komutanım. Görevimin başındayım!");
}

module.exports = {
    checkLiquidityAsync,
    sendOnDutyMessage
};
