const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const { SMA, EMA } = require('technicalindicators');

const db = new sqlite3.Database('./signals.db', (err) => {
    if (err) console.error("DB Err:", err);
});

function calculateTrendFromKlines(klines) {
    if (!klines || klines.length < 50) return 'NEUTRAL';
    const closes = klines.map(k => k.close);
    const ema20 = EMA.calculate({period: 20, values: closes});
    const sma50 = SMA.calculate({period: 50, values: closes});
    const rsi = require('technicalindicators').RSI.calculate({period: 14, values: closes});
    
    if (!ema20.length || !sma50.length || !rsi.length) return 'NEUTRAL';
    const lastClose = closes[closes.length - 1];
    const lastEma = ema20[ema20.length - 1];
    const lastSma = sma50[sma50.length - 1];
    const lastRsi = rsi[rsi.length - 1];

    if (lastClose > lastEma && lastEma > lastSma && lastRsi >= 55) return 'STRONG_BULL';
    if (lastClose > lastSma && lastRsi >= 50) return 'BULL';
    if (lastClose < lastEma && lastEma < lastSma && lastRsi <= 45) return 'STRONG_BEAR';
    if (lastClose < lastSma && lastRsi <= 50) return 'BEAR';
    return 'NEUTRAL';
}

async function fetchHistoricalBinance(symbol, interval, endTime) {
    try {
        const res = await axios.get(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=100&endTime=${endTime}`);
        return res.data.map(k => ({
            close: parseFloat(k[4]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            open: parseFloat(k[1]),
            volume: parseFloat(k[5]),
            closeTime: parseInt(k[6])
        }));
    } catch(e) { return null; }
}

async function fetchHistoricalBybit(symbol, interval, endTime) {
    try {
        const res = await axios.get(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=100&end=${endTime}`);
        return res.data.result.list.map(k => ({
            close: parseFloat(k[4]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            open: parseFloat(k[1]),
            volume: parseFloat(k[5]),
            closeTime: parseInt(k[0])
        })).reverse();
    } catch(e) { return null; }
}

async function startRetroTest() {
    console.log("[RETRO-TEST] Veritabani gecmis islemleri okutuluyor (Max 60)");
    
    const signals = await new Promise((resolve) => {
        db.all("SELECT * FROM signals WHERE status IN ('WIN', 'LOSS') ORDER BY createdAt DESC LIMIT 60", [], (err, rows) => {
            resolve(rows || []);
        });
    });

    console.log(`[RETRO-TEST] Degerlendirilecek kapanmis islem bulundu: ${signals.length}`);
    
    let blockedCount = 0;
    let successfulBlocks = 0; 
    let missedWins = 0; 

    for (let sig of signals) {
        // SQLite timestamps assumed UTC
        const tsMs = new Date(sig.createdAt + " UTC").getTime();
        
        const [btc1h, btc4h, btc1d, eth4h, dom4h] = await Promise.all([
            fetchHistoricalBybit('BTCUSDT', '60', tsMs),
            fetchHistoricalBybit('BTCUSDT', '240', tsMs),
            fetchHistoricalBybit('BTCUSDT', 'D', tsMs),
            fetchHistoricalBybit('ETHUSDT', '240', tsMs),
            fetchHistoricalBinance('BTCDOMUSDT', '4h', tsMs)
        ]);
        
        let blocked = false;
        let reasons = [];

        if (btc4h && btc1d && eth4h) {
            const btc4hTrend = calculateTrendFromKlines(btc4h);
            const btc1dTrend = calculateTrendFromKlines(btc1d);
            const eth4Trend = calculateTrendFromKlines(eth4h);
            
            let finalBtc = btc4hTrend;
            if ((btc4hTrend === 'BULL' || btc4hTrend === 'STRONG_BULL') && (btc1dTrend === 'BULL' || btc1dTrend === 'STRONG_BULL')) {
                 finalBtc = 'STRONG_BULL'; 
            } else if ((btc4hTrend === 'BEAR' || btc4hTrend === 'STRONG_BEAR') && (btc1dTrend === 'BEAR' || btc1dTrend === 'STRONG_BEAR')) {
                 finalBtc = 'STRONG_BEAR';
            }

            if (sig.type === 'SHORT' && (finalBtc === 'STRONG_BULL' || finalBtc === 'BULL')) blocked = true, reasons.push("BTC_BOGA");
            if (sig.type === 'LONG' && (finalBtc === 'STRONG_BEAR' || finalBtc === 'BEAR')) blocked = true, reasons.push("BTC_AYI");
            
            if (sig.type === 'SHORT' && (eth4Trend === 'STRONG_BULL' || eth4Trend === 'BULL')) blocked = true, reasons.push("ETH_BOGA");
            if (sig.type === 'LONG' && (eth4Trend === 'STRONG_BEAR' || eth4Trend === 'BEAR')) blocked = true, reasons.push("ETH_AYI");
            
            if (!blocked) {
                console.log(`✅ ONAYLANDI -> ID:${sig.id} | Sembol: ${sig.symbol} | Yön: ${sig.type} | Eski Puan: ${sig.qualityScore} | Sonuç: ${sig.status} | Tarih: ${sig.createdAt}`);
            }
            // console.log(`>> (${sig.createdAt}) ID:${sig.id} ${sig.type} ${sig.symbol} | Gecmis Sonuc: ${sig.status} | Bloklandi Mi?: ${blocked ? 'EVET' : 'HAYIR'} ${reasons.join('-')}`);
            
            if (blocked) {
                blockedCount++;
                if (sig.status === 'LOSS') successfulBlocks++;
                if (sig.status === 'WIN') missedWins++;
            }
        }
        await new Promise(r => setTimeout(r, 200)); // rate limit bypass
    }
    
    console.log("=========================================");
    console.log("         RETRO-TEST CANLI RAPORU         ");
    console.log("=========================================");
    console.log(`> Test Edilen Gecmis Islem : ${signals.length}`);
    console.log(`> Sistem Tarafindan Engellenen Islem : ${blockedCount}`);
    console.log(`> KURTARILAN ZARARLAR (Basarili Reddedilen) : ${successfulBlocks} adet stop engellendi!`);
    console.log(`> KACIRILAN KARLAR (Guvenlik sebebiyle ezilen) : ${missedWins} adet tp islem heba oldu.`);
    console.log("=========================================");
    process.exit(0);
}

startRetroTest();
