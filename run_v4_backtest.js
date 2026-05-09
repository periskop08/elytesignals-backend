const axios = require('axios');
const { ATR, SMA, ADX } = require('technicalindicators');

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

function calculateContextScore(currentPrice, curSma200, globalMarketState, currentADX, rvol, globalVol, direction) {
    let score = 0;
    
    if (direction === 'LONG') {
        if (currentPrice > curSma200) score += 15;
        else score -= 10;
    } else {
        if (currentPrice < curSma200) score += 15;
        else score -= 10;
    }

    let isBtcBull = globalMarketState.btcSMA === 'BULL';
    let isEthBull = globalMarketState.ethSMA === 'BULL';
    
    if (direction === 'LONG' && isBtcBull && isEthBull) score += 15;
    else if (direction === 'SHORT' && !isBtcBull && !isEthBull) score += 15;
    else score -= 5;

    if (currentADX >= 20) score += 10;
    else score += 5;

    if (rvol > 1.2) score += 10;
    if (direction === 'LONG' && globalVol < 2000000) score -= 20;
    if (direction === 'SHORT' && globalVol < 1500000) score -= 20;

    return score;
}

function calculateTriggerScore(closes, highs, lows, opens, direction, swingHighs, swingLows) {
    let score = 0;
    let sweepDetected = false;
    let chochDetected = false;
    const currentJ = closes.length - 1;
    
    if (currentJ >= 10) {
        let min10Low = Math.min(...lows.slice(currentJ-10, currentJ));
        let max10High = Math.max(...highs.slice(currentJ-10, currentJ));
        if (direction === 'LONG' && lows[currentJ] < min10Low && closes[currentJ] > opens[currentJ]) sweepDetected = true;
        else if (direction === 'SHORT' && highs[currentJ] > max10High && closes[currentJ] < opens[currentJ]) sweepDetected = true;
    }
    if (sweepDetected) score += 15;

    if (direction === 'LONG' && swingHighs.length > 0) {
        if (highs[currentJ] > swingHighs[swingHighs.length - 1].price) chochDetected = true;
    } else if (direction === 'SHORT' && swingLows.length > 0) {
        if (lows[currentJ] < swingLows[swingLows.length - 1].price) chochDetected = true;
    }
    if (chochDetected) score += 20;

    let isKillerWick = false;
    let candleSize = highs[currentJ] - lows[currentJ] || 1;
    if (direction === 'LONG') {
        let lowerWick = Math.min(opens[currentJ], closes[currentJ]) - lows[currentJ];
        if (lowerWick/candleSize > 0.40) isKillerWick = true;
    } else {
        let upperWick = highs[currentJ] - Math.max(opens[currentJ], closes[currentJ]);
        if (upperWick/candleSize > 0.40) isKillerWick = true;
    }
    if (isKillerWick) score += 10;

    return { score, sweepDetected, chochDetected };
}

function calculateExecutionScore(riskPct, rr, currentVol, avgVol) {
    let score = 0;
    if (riskPct < 3.0) score += 10;
    if (currentVol > avgVol) score += 10;
    if (rr >= 2.0) score += 10;
    else score += 5;
    return score;
}

async function run() {
    console.log("=== ELYTE ENGINE V4 BACKTEST BAŞLIYOR (Son 30 Gün) ===");
    console.log("Sistem: 3-Katmanlı Motor (Context, Trigger, Execution) + BOS/CHoCH Teyidi");
    console.log("Kaynak: Bybit, Semboller: BingX İlk 50\n");

    const pairs = await getTopPairsBingX(50);
    console.log(`Toplam ${pairs.length} adet Coin analiz edilecek...`);

    const btcKlines = await fetchBybitCandles('BTCUSDT', 60, 1000);
    const ethKlines = await fetchBybitCandles('ETHUSDT', 60, 1000);
    
    // Manifesto gereği 5 puanlık bantlar
    const bands = [
        { label: '0-59 (Çöp)', min: 0, max: 59 },
        { label: '60-74 (Watchlist)', min: 60, max: 74 }, // 12-14.8 ham -> 60-74
        { label: '75-89 (Active)', min: 75, max: 89 },
        { label: '90-100 (Elite)', min: 90, max: 100 }
    ];
    
    let stats = {};
    for(let b of bands) {
        stats[b.label] = { total: 0, long: 0, short: 0, win: 0, loss: 0 };
    }

    let processedCount = 0;

    for (const p of pairs) {
        const symbol = p.symbol;
        const klines = await fetchBybitCandles(symbol, 60, 950);
        if (!klines || klines.length < 250) continue;

        processedCount++;
        process.stdout.write(`\rAnaliz edilen coin: ${processedCount}/${pairs.length}`);

        for (let i = 250; i < klines.length - 24; i++) {
            const window = klines.slice(i - 100, i + 1);
            const opens = window.map(k => k.open);
            const highs = window.map(k => k.high);
            const lows = window.map(k => k.low);
            const closes = window.map(k => k.close);
            const volumes = window.map(k => k.volume);
            const currentPrice = closes[closes.length - 1];

            // 200 SMA
            const sma200Values = SMA.calculate({ period: 200, values: closes });
            const curSma200 = sma200Values[sma200Values.length - 1];

            // Fractal
            let swingHighs = [];
            let swingLows = [];
            for (let x = 2; x < highs.length - 2; x++) {
                if (highs[x] > highs[x-2] && highs[x] > highs[x-1] && highs[x] > highs[x+1] && highs[x] > highs[x+2]) {
                    swingHighs.push({index: x, price: highs[x]});
                }
                if (lows[x] < lows[x-2] && lows[x] < lows[x-1] && lows[x] < lows[x+1] && lows[x] < lows[x+2]) {
                    swingLows.push({index: x, price: lows[x]});
                }
            }

            const atrRes = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
            const currentATR = atrRes[atrRes.length - 1] || (currentPrice * 0.015);
            const adxResult = ADX.calculate({high: highs, low: lows, close: closes, period: 14});
            const currentADX = adxResult.length > 0 ? adxResult[adxResult.length - 1].adx : 25;
            const currentVol = volumes[volumes.length - 1] || 0;
            const avgVol = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
            const rvol = currentVol / (avgVol || 1);

            let direction = currentPrice > curSma200 ? 'LONG' : 'SHORT';
            if (lows[lows.length - 1] < Math.min(...lows.slice(-6, -1))) direction = 'LONG';
            if (highs[highs.length - 1] > Math.max(...highs.slice(-6, -1))) direction = 'SHORT';

            const btcSMA = btcKlines && i < btcKlines.length ? (btcKlines[i].close > btcKlines[Math.max(0, i-50)].close ? 'BULL' : 'BEAR') : 'NEUTRAL';
            const ethSMA = ethKlines && i < ethKlines.length ? (ethKlines[i].close > ethKlines[Math.max(0, i-50)].close ? 'BULL' : 'BEAR') : 'NEUTRAL';
            const globalMarketState = { btcSMA, ethSMA };

            let ctxScore = calculateContextScore(currentPrice, curSma200, globalMarketState, currentADX, rvol, p.volume, direction);
            let trgObj = calculateTriggerScore(closes, highs, lows, opens, direction, swingHighs, swingLows);
            
            let slMultiplier = 1.5;
            let dynamicStop = direction === 'LONG' ? currentPrice - (currentATR * slMultiplier) : currentPrice + (currentATR * slMultiplier);
            let risk = Math.abs(currentPrice - dynamicStop);
            let targetP = direction === 'LONG' ? currentPrice + (risk * 1.5) : currentPrice - (risk * 1.5);
            let riskPct = (risk / currentPrice) * 100;
            
            let exeScore = calculateExecutionScore(riskPct, 1.5, currentVol, avgVol);

            let finalScore = (ctxScore * 0.40) + (trgObj.score * 0.35) + (exeScore * 0.25);
            
            if (trgObj.sweepDetected && !trgObj.chochDetected) {
                finalScore -= 15;
            }
            if (!trgObj.sweepDetected && !trgObj.chochDetected) continue;

            let mappedScore = Math.round(finalScore * 5); // x5 for 100-scale
            
            let bandKey = null;
            for(let b of bands) {
                if (mappedScore >= b.min && mappedScore <= b.max) {
                    bandKey = b.label; break;
                }
            }
            if (!bandKey) continue;

            let outcome = 'LOSS';
            for (let f = i+1; f < Math.min(i + 48, klines.length); f++) {
                if (direction === 'LONG') {
                    if (klines[f].low <= dynamicStop) { outcome = 'LOSS'; break; }
                    if (klines[f].high >= targetP) { outcome = 'WIN'; break; }
                } else {
                    if (klines[f].high >= dynamicStop) { outcome = 'LOSS'; break; }
                    if (klines[f].low <= targetP) { outcome = 'WIN'; break; }
                }
            }

            stats[bandKey].total++;
            direction === 'LONG' ? stats[bandKey].long++ : stats[bandKey].short++;
            outcome === 'WIN' ? stats[bandKey].win++ : stats[bandKey].loss++;

            i += 6; // forward step
        }
    }

    console.log("\n\n=== ELYTE GERÇEK PİYASA BACKTEST SONUÇLARI (500$ Kasa Simülasyonu) ===");
    console.log("Kasa Modeli: Başlangıç $500 | Risk: 1R = -$10 | Kâr (Net): 1.5R = +$15");
    console.log("Barajlar 5'er Puanlık Segmentlerde Listelenmiştir:\n");

    let totalPnl = 0;

    for (let b of bands) {
        const s = stats[b.label];
        if (s.total === 0) continue;
        const wr = s.win + s.loss > 0 ? ((s.win / (s.win + s.loss)) * 100).toFixed(2) : 0;
        const pnl = (s.win * 15) - (s.loss * 10);
        if (b.label.includes('Active') || b.label.includes('Elite')) {
            totalPnl += pnl; // Sadece Watchlist ve çöp harici işlemler kasaya yansır
        }
        
        console.log(`• BARAJ: [${b.label}]`);
        console.log(`   Toplam Üretilen Sinyal: ${s.total} adet`);
        console.log(`   Yön Dağılımı: ${s.long} LONG / ${s.short} SHORT`);
        console.log(`   İşlem Sonuçları: ${s.win} Win / ${s.loss} Loss`);
        console.log(`   Kazanma Oranı (WinRate): %${wr}`);
        console.log(`   NET Dolar Kazancı: ${pnl >= 0 ? '+' : ''}$${pnl}\n`);
    }

    console.log(`========================================`);
    console.log(`💲 AYLIK FON KAPANIŞ BİLANÇOSU:`);
    console.log(`Başlangıç Kasası: $500`);
    console.log(`Net Kâr/Zarar: ${totalPnl >= 0 ? '+' : ''}$${totalPnl} (Sadece Active/Elite Sinyaller)`);
    console.log(`Aylık Büyüme (ROI): %${((totalPnl / 500) * 100).toFixed(2)}`);
    console.log(`========================================\n`);
}

run();
