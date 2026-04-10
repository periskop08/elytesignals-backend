const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');

const db = new sqlite3.Database('./signals.db');

async function fetchHistoricalCandles(symbol, endTimeMs) {
    try {
        let sym = symbol;
        if(sym.endsWith('-USDT')) sym = sym.replace('-USDT', 'USDT');
        
        // Sinyal üretildiği andan (endTimeMs) geriye dönük son 50 mum (H1) fitil/hacim analizi için yeterli.
        const res = await axios.get(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1h&endTime=${endTimeMs}&limit=50`);
        let list = res.data;
        return list.map(k => ({
            time: k[0],
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5])
        }));
    } catch(e) {
        return null;
    }
}

db.all(`SELECT symbol, type, qualityScore, status, createdAt FROM signals WHERE status IN ('WIN','LOSS') ORDER BY createdAt DESC LIMIT 60`, [], async (err, rows) => {
    if (err) throw err;
    
    let stats = {
        total: rows.length,
        originalWins: 0,
        originalLosses: 0,
        thresh70: { passes: 0, wins: 0, losses: 0 },
        thresh75: { passes: 0, wins: 0, losses: 0 }
    };

    console.log(`Veritabanından Geriye Dönük ${rows.length} Sinyal Okundu. Klines dataları çekilip Perplexity analizi başlatılıyor...`);

    for(let row of rows) {
        if (row.status === 'WIN') stats.originalWins++;
        if (row.status === 'LOSS') stats.originalLosses++;

        let signalTimeMs = new Date(row.createdAt + 'Z').getTime();
        let candles = await fetchHistoricalCandles(row.symbol, signalTimeMs);
        
        let killerWickBonus = 0;
        let volumeShelterBonus = 0;
        
        if (candles && candles.length >= 25) {
            const lows = candles.map(c => c.low);
            const highs = candles.map(c => c.high);
            const opens = candles.map(c => c.open);
            const closes = candles.map(c => c.close);
            const volumes = candles.map(c => c.volume);
            const direction = row.type;

            // --- KILLER WICK (Son 3 1H mumunda) ---
            let hasKillerWick = false;
            for (let j = closes.length - 3; j <= closes.length - 1; j++) {
                if (j >= 0) {
                    let candleSize = highs[j] - lows[j] || 1;
                    if (direction === 'LONG') {
                        let minCloseOpen = Math.min(opens[j], closes[j]);
                        let lowerWick = minCloseOpen - lows[j];
                        let wickRatio = lowerWick / candleSize;
                        // Baraj 65'ti. Çok daha seçici olalım: Fitil, mumun en az yarisindan buyuk olsun
                        if (wickRatio > 0.40 && closes[j] > ((highs[j] + lows[j])/2)) {
                            hasKillerWick = true; break;
                        }
                    } else {
                        let maxCloseOpen = Math.max(opens[j], closes[j]);
                        let upperWick = highs[j] - maxCloseOpen;
                        let wickRatio = upperWick / candleSize;
                        if (wickRatio > 0.40 && closes[j] < ((highs[j] + lows[j])/2)) {
                            hasKillerWick = true; break;
                        }
                    }
                }
            }
            if (hasKillerWick) killerWickBonus = 20;

            // --- VOLUME SHELTER ---
            let shortTermVolAvg = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
            let lastVol = volumes[volumes.length-1];
            if (direction === 'LONG' && lastVol < shortTermVolAvg * 0.9 && closes[closes.length-1] < opens[closes.length-1]) {
                volumeShelterBonus = 12;
            } else if (direction === 'SHORT' && lastVol < shortTermVolAvg * 0.9 && closes[closes.length-1] > opens[closes.length-1]) {
                volumeShelterBonus = 12;
            }
        }

        // Simüle Edilmiş Yeni Skor = Veritabanındaki Orijinal Kalite Skoru + Yeni Kurallar
        let simulatedQualityScore = row.qualityScore + killerWickBonus + volumeShelterBonus;

        // 70 Puan Barajı Testi
        if (simulatedQualityScore >= 70) {
            stats.thresh70.passes++;
            if (row.status === 'WIN') stats.thresh70.wins++;
            if (row.status === 'LOSS') stats.thresh70.losses++;
        }

        // 75 Puan Barajı Testi
        if (simulatedQualityScore >= 75) {
            stats.thresh75.passes++;
            if (row.status === 'WIN') stats.thresh75.wins++;
            if (row.status === 'LOSS') stats.thresh75.losses++;
        }
        
        await new Promise(r => setTimeout(r, 100)); // Anti-spam delay
    }

    let origWR = stats.total > 0 ? (stats.originalWins / stats.total * 100).toFixed(1) : 0;
    let t70WR = stats.thresh70.passes > 0 ? (stats.thresh70.wins / stats.thresh70.passes * 100).toFixed(1) : 0;
    let t75WR = stats.thresh75.passes > 0 ? (stats.thresh75.wins / stats.thresh75.passes * 100).toFixed(1) : 0;

    const output = {
        SİMULASYON: "Canlı Veritabanı (Geçmiş Gerçek Sinyallerin Perplexity Filtresinden Geçirilmesi)",
        ORİJİNAL_DURUM: {
            "İncelenen Toplam Sinyal (DB)": stats.total,
            "Kazananlar": stats.originalWins,
            "Kaybedenler": stats.originalLosses,
            "Orijinal WinRate": `%${origWR}`
        },
        BARAJ_70_TEST: {
            "Bu Sinyallerden 70 Puanı Aşabilenler": stats.thresh70.passes,
            "70 Barajını Aşanlardaki WIN Sayısı": stats.thresh70.wins,
            "70 Barajını Aşanlardaki LOSS Sayısı": stats.thresh70.losses,
            "70 BARAJINDA YENİ WİNRATE": `%${t70WR}`
        },
        BARAJ_75_TEST: {
            "Bu Sinyallerden 75 Puanı Aşabilenler": stats.thresh75.passes,
            "75 Barajını Aşanlardaki WIN Sayısı": stats.thresh75.wins,
            "75 Barajını Aşanlardaki LOSS Sayısı": stats.thresh75.losses,
            "75 BARAJINDA YENİ WİNRATE": `%${t75WR}`
        }
    };
    
    console.log("\n=== VERİTABANI PERPLEXITY & BARAJ BACKTESTİ ===");
    console.log(JSON.stringify(output, null, 2));
});
