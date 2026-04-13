const axios = require('axios');

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
        const url = `https://open-api.bingx.com/openApi/swap/v2/quote/depth?symbol=${symbol}&limit=5`;
        const response = await axios.get(url, { timeout: 1500 }); // 1.5 Saniye hard-timeout
        
        if (response.data && response.data.code === 0 && response.data.data) {
            const data = response.data.data;
            if (!data.bids || !data.asks || data.bids.length === 0 || data.asks.length === 0) {
                return { scoreMod: 0, msg: "Likidite verisi eksik (Bypass)" };
            }

            const bestBidPrice = parseFloat(data.bids[0][0]);
            const bestAskPrice = parseFloat(data.asks[0][0]);

            if (bestAskPrice === 0) return { scoreMod: 0, msg: "Ask Price = 0 (Bypass)" };

            // Makas (Spread) yüzdesini hesapla
            const spreadPct = ((bestAskPrice - bestBidPrice) / bestAskPrice) * 100;
            
            // Eğer spread %0.4'ten büyükse bu ciddi bir slippage riski oluşturur (Altcoinlerde ani hacimsizlik)
            if (spreadPct > 0.4) {
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
                return { scoreMod: -15, msg: `Sığ Satış Tahtası ($${Math.round(asksVolumeUsd)}) (-15)` };
            } else if (direction === 'SHORT' && bidsVolumeUsd < 15000) {
                return { scoreMod: -15, msg: `Sığ Alış Tahtası ($${Math.round(bidsVolumeUsd)}) (-15)` };
            }

            // Eğer tahta çok derinse ve spread çok darsa (+5 Bonus)
            if (spreadPct < 0.10 && asksVolumeUsd > 50000 && bidsVolumeUsd > 50000) {
                return { scoreMod: 5, msg: `Sağlam Likidite Tahtası (+5)` };
            }

            return { scoreMod: 0, msg: "Tahta Standart (Pas Geçildi)" };
        }
        
        return { scoreMod: 0, msg: "Likidite API Hatası (Bypass)" };
    } catch (err) {
        return { scoreMod: 0, msg: `Demir Bey Timeout/Hata (Bypass)` };
    }
}

module.exports = {
    checkLiquidityAsync
};
