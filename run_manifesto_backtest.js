const axios = require('axios');
const { ATR, SMA, IchimokuCloud, StochasticRSI, ADX } = require('technicalindicators');

// BINGX FETCH PAIRS
async function getTopPairsBingX(limit) {
    try {
        const res = await axios.get('https://open-api.bingx.com/openApi/swap/v2/quote/ticker');
        const list = res.data.data;
        const usdtPairs = list.filter(item => item.symbol.endsWith('-USDT') && parseFloat(item.quoteVolume) > 2000000);
        usdtPairs.sort((a,b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
        return usdtPairs.slice(0, limit).map(i => ({ symbol: i.symbol.replace('-', ''), volume: parseFloat(i.quoteVolume) }));
    } catch (e) {
        return []; 
    }
}

// BYBIT FETCH KLINES
async function fetchBybitCandles(symbol, intervalMinutes, limit) {
    try {
        const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${intervalMinutes}&limit=${limit}`;
        const { data } = await axios.get(url);
        if (!data || !data.result || !data.result.list) return null;
        const list = data.result.list.reverse();
        return list.map(k => ({
            open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5])
        }));
    } catch(e) { return null; }
}

async function run() {
    console.log("=== ELYTE MANIFESTO BACKTEST BAŞLIYOR (Son 30 Gün) ===");
    console.log("Kaynak: Bybit, Semboller: BingX, Barajlar: Sınıflandırılmış\n");

    const pairs = await getTopPairsBingX(150); // Miktar sınırlaması (Timeout olmaması için)
    console.log(`Toplam ${pairs.length} adet Coin analiz edilecek...`);

    let macroData = {};
    const btcKlines = await fetchBybitCandles('BTCUSDT', 60, 1000);
    const ethKlines = await fetchBybitCandles('ETHUSDT', 60, 1000);
    
        // Skor Bantları
    const scoreBands = {
        '45-60': { total: 0, tp: 0, sl: 0, long: 0, short: 0 }
    };

    let processedCount = 0;

    for (const p of pairs) {
        const symbol = p.symbol;
        const klines = await fetchBybitCandles(symbol, 60, 950);
        if (!klines || klines.length < 250) continue;

        processedCount++;
        process.stdout.write(`\rAnaliz edilen coin: ${processedCount}/${pairs.length}`);

        for (let i = 250; i < klines.length - 24; i++) {
            // Eval window
            const window = klines.slice(i - 100, i + 1);
            const opens = window.map(k => k.open);
            const highs = window.map(k => k.high);
            const lows = window.map(k => k.low);
            const closes = window.map(k => k.close);
            const volumes = window.map(k => k.volume);
            const currentPrice = closes[closes.length - 1];
            const currentOpen = opens[opens.length - 1];

            // Sweep (Agresif Mod - CHOCH Yok)
            const recentLows = lows.slice(-6);
            const recentHighs = highs.slice(-6);
            let recentMin = Math.min(...recentLows);
            let recentMax = Math.max(...recentHighs);
            
            const localLows = lows.slice(-24);
            const localHighs = highs.slice(-24);
            const localRangeLow = Math.min(...localLows);
            const localRangeHigh = Math.max(...localHighs);

            let dipDeviation = false; let tepeDeviation = false;
            let trapWickSize = 0;
            if (recentMin <= localRangeLow * 1.005 && currentPrice > localRangeLow) {
                dipDeviation = true;
                trapWickSize = Math.min(currentOpen, currentPrice) - lows[lows.length-1];
            }
            if (recentMax >= localRangeHigh * 0.995 && currentPrice < localRangeHigh) {
                tepeDeviation = true;
                trapWickSize = highs[highs.length-1] - Math.max(currentOpen, currentPrice);
            }

            // Breakout (Makro Filtreli)
            const prevRangeHigh = Math.max(...highs.slice(0, -1));
            const prevRangeLow = Math.min(...lows.slice(0, -1));
            
            const btcSMA = btcKlines && i < btcKlines.length ? (btcKlines[i].close > btcKlines[Math.max(0, i-50)].close ? 'BULL' : 'BEAR') : 'NEUTRAL';
            const ethSMA = ethKlines && i < ethKlines.length ? (ethKlines[i].close > ethKlines[Math.max(0, i-50)].close ? 'BULL' : 'BEAR') : 'NEUTRAL';
            
            if (currentPrice > prevRangeHigh && btcSMA==='BULL' && ethSMA==='BULL') dipDeviation = true;
            if (currentPrice < prevRangeLow && btcSMA==='BEAR' && ethSMA==='BEAR') tepeDeviation = true;

            if (!dipDeviation && !tepeDeviation) continue;

            const direction = dipDeviation ? 'LONG' : 'SHORT';
            
            // Hacim Koruması
            if (direction === 'LONG' && p.volume < 2000000) continue;
            if (direction === 'SHORT' && p.volume < 1000000) continue;

            // ZODYAK SCORING
            let qc = 0;
            const atrRes = ATR.calculate({high: highs, low: lows, close: closes, period: 14});
            const avgATR = atrRes[atrRes.length - 1] || (currentPrice * 0.015);
            
            let hasOB = false;
            const resZone = direction === 'LONG' ? [localRangeLow - (avgATR * 1.5), localRangeLow + (avgATR * 1.5)] : [localRangeHigh - (avgATR * 1.5), localRangeHigh + (avgATR * 1.5)];
            for (let k = closes.length - 36; k <= closes.length - 6; k++) {
                if (direction === 'LONG' && closes[k] < opens[k] && closes[k] <= resZone[1] && closes[k] >= resZone[0]) { hasOB = true; break; }
                if (direction === 'SHORT' && closes[k] > opens[k] && closes[k] >= resZone[0] && closes[k] <= resZone[1]) { hasOB = true; break; }
            }
            if (hasOB) qc += 25;

            let hasFVG = false;
            for (let j = closes.length - 3; j <= closes.length - 1; j++) {
                if (j >= 2) {
                    if (direction === 'LONG' && highs[j-2] < lows[j]) hasFVG = true; 
                    if (direction === 'SHORT' && lows[j-2] > highs[j]) hasFVG = true; 
                }
            }
            if (hasFVG) qc += 15;

            if (trapWickSize > avgATR * 1.2) qc += 20;

            if (direction === 'LONG' && btcSMA === 'BULL') qc += 15;
            else if (direction === 'LONG' && btcSMA === 'BEAR') qc -= 15;
            if (direction === 'SHORT' && btcSMA === 'BEAR') qc += 15;
            else if (direction === 'SHORT' && btcSMA === 'BULL') qc -= 15;

            const adxResult = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });
            const currentADX = adxResult.length > 0 ? adxResult[adxResult.length - 1].adx : 0;
            if (currentADX >= 25) qc += 10;
            else if (currentADX < 20) qc -= 10;
            
            const ichiRes = IchimokuCloud.calculate({ high: highs, low: lows, conversionPeriod: 9, basePeriod: 26, spanPeriod: 52, displacement: 26 });
            if (ichiRes && ichiRes.length > 0) {
                const currentIchi = ichiRes[ichiRes.length - 1];
                if (direction === 'LONG' && currentPrice > currentIchi.spanA && currentPrice > currentIchi.spanB && currentIchi.conversion > currentIchi.base) qc += 15;
                if (direction === 'SHORT' && currentPrice < currentIchi.spanA && currentPrice < currentIchi.spanB && currentIchi.conversion < currentIchi.base) qc += 15;
            }

            const currentVol = volumes[volumes.length - 1];
            const buyVol = currentVol * ((currentPrice - lows[lows.length-1]) / (highs[highs.length-1] - lows[lows.length-1] || 1));
            const sellVol = currentVol - buyVol;
            if (direction === 'LONG' && buyVol > sellVol * 1.5) qc += 15;
            if (direction === 'SHORT' && sellVol > buyVol * 1.5) qc += 15;

            // Outomes
            let band = '45-60';
            if (qc < 45 || qc > 60) continue; // Sadece 45-60 hedeflendi

            let dynamicStop = direction === 'LONG' ? currentPrice - (avgATR * 1.5) : currentPrice + (avgATR * 1.5);
            let risk = Math.abs(currentPrice - dynamicStop);
            let targetP = direction === 'LONG' ? currentPrice + (risk * 1.5) : currentPrice - (risk * 1.5);
            let outcome = 'LOSS'; // varsayılan
            
            for (let f = i+1; f < Math.min(i + 48, klines.length); f++) {
                if (direction === 'LONG') {
                    if (klines[f].low <= dynamicStop) { outcome = 'LOSS'; break; }
                    if (klines[f].high >= targetP) { outcome = 'WIN'; break; }
                } else {
                    if (klines[f].high >= dynamicStop) { outcome = 'LOSS'; break; }
                    if (klines[f].low <= targetP) { outcome = 'WIN'; break; }
                }
            }

            scoreBands[band].total++;
            direction === 'LONG' ? scoreBands[band].long++ : scoreBands[band].short++;
            outcome === 'WIN' ? scoreBands[band].tp++ : scoreBands[band].sl++;

            // Skip forward to avoid overlap
            i += 6;
        }
    }

    console.log("\n\n=== ELYTE GERÇEK PİYASA BACKTEST (KOMİSYON DAHİL) ===");
    console.log("Kasa Modeli: Risk: 1R = -$10 | Kâr (Net): 1.3R = +$13 (Borsa Kesintileri Düşüldü)");
    console.log("Süre: Son 30 Gün | Analiz Uzayı: " + pairs.length + " Coin Segmenti\n");

    const s = scoreBands['45-60'];
    const wr = s.tp + s.sl > 0 ? ((s.tp / (s.tp + s.sl)) * 100).toFixed(2) : 0;
    const pnl = (s.tp * 13) - (s.sl * 10);
    const rNet = pnl / 10;
    const dailySignal = (s.total / 30).toFixed(1);

    console.log(`• ZODYAK ALTIN KESİŞİM BÖLGESİ [45-60 PUAN]`);
    console.log(`   Toplam Üretilen Sinyal: ${s.total} adet (Günde ortalama ${dailySignal} Sinyal)`);
    console.log(`   Yön Dağılımı: ${s.long} LONG / ${s.short} SHORT`);
    console.log(`   İşlem Sonuçları: ${s.tp} Win / ${s.sl} Loss`);
    console.log(`   Kazanma Oranı (WinRate): ${wr}%`);
    console.log(`   NET R (Getiri Katsayısı): +${rNet.toFixed(1)} R`);
    console.log(`   NET Dolar Kazancı (500$ Kasa): +$${pnl}`);
}

run();
