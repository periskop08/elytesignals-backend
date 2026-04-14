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

async function checkLiquidityAsync(symbol, direction) {
    try {
        if (symbol === 'BTCUSDT' || symbol === 'ETHUSDT' || symbol === 'BTC-USDT' || symbol === 'ETH-USDT') {
            recordBypass();
            return { scoreMod: 0, msg: "Lider Muafiyeti (Bypass)" };
        }

        let fetchSymbol = symbol.includes('-') ? symbol : symbol.replace('USDT', '-USDT');
        const url = `https://open-api.bingx.com/openApi/swap/v2/quote/depth?symbol=${fetchSymbol}&limit=30`;
        const response = await axios.get(url, { timeout: 1500 }); // 1.5 Saniye hard-timeout
        
        if (response.data && response.data.code === 0 && response.data.data) {
            const data = response.data.data;
            if (!data.bids || !data.asks || data.bids.length === 0 || data.asks.length === 0) {
                recordBypass();
                return { scoreMod: 0, msg: "Likidite verisi eksik (Bypass)" };
            }

            const bestBidPrice = parseFloat(data.bids[0][0]);
            const bestAskPrice = parseFloat(data.asks[0][0]);

            if (bestAskPrice === 0) {
                recordBypass();
                return { scoreMod: 0, msg: "Ask Price = 0 (Bypass)" };
            }

            // Makas (Spread) yüzdesini hesapla
            const spreadPct = ((bestAskPrice - bestBidPrice) / bestAskPrice) * 100;
            
            // Eğer spread %0.4'ten büyükse bu ciddi bir slippage riski oluşturur (Altcoinlerde ani hacimsizlik)
            if (spreadPct > 0.4) {
                recordStat('penalty');
                return { scoreMod: -15, msg: `Yüksek Spread Riski (%${spreadPct.toFixed(2)}) (-15)` };
            }

            // Toplam Hacimi (İlk 5 Kademe) Hesapla
            let bidsVolumeUsd = 0;
            for (let b of data.bids) {
                bidsVolumeUsd += parseFloat(b[0]) * parseFloat(b[1]);
            }
            
            let asksVolumeUsd = 0;
            for (let a of data.asks) {
                asksVolumeUsd += parseFloat(a[0]) * parseFloat(a[1]);
            }

            // Eğer girmek istediğimiz tarafın karşısındaki hacim inanılmaz sığ ise (örn 10.000$'dan küçükse) kayma olacaktır
            if (direction === 'LONG' && asksVolumeUsd < 15000) {
                recordStat('penalty');
                return { scoreMod: -15, msg: `Sığ Satış Tahtası ($${Math.round(asksVolumeUsd)}) (-15)` };
            } else if (direction === 'SHORT' && bidsVolumeUsd < 15000) {
                recordStat('penalty');
                return { scoreMod: -15, msg: `Sığ Alış Tahtası ($${Math.round(bidsVolumeUsd)}) (-15)` };
            }

            // Eğer tahta çok derinse ve spread çok darsa (+5 Bonus)
            if (spreadPct < 0.10 && asksVolumeUsd > 50000 && bidsVolumeUsd > 50000) {
                recordStat('bonus');
                return { scoreMod: 5, msg: `Sağlam Likidite Tahtası (+5)` };
            }

            recordStat('normal');
            return { scoreMod: 0, msg: "Tahta Standart (Pas Geçildi)" };
        }
        
        recordBypass();
        return { scoreMod: 0, msg: "Likidite API Hatası (Bypass)" };
    } catch (err) {
        recordBypass();
        return { scoreMod: 0, msg: `Demir Bey Timeout/Hata (Bypass)` };
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
