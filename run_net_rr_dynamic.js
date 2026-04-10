const axios = require('axios');
const { ATR, SMA, IchimokuCloud, StochasticRSI } = require('technicalindicators');

function calculateKAMA(prices, period = 10, fastEMA = 2, slowEMA = 30) {
    if (prices.length <= period) return Array(prices.length).fill(null);
    let kamaValues = [];
    let sum = 0;
    for (let i = 0; i < period; i++) sum += prices[i];
    let prevKAMA = sum / period;
    for (let i = 0; i < period; i++) kamaValues.push(null);
    kamaValues[period - 1] = prevKAMA;
    const fastest = 2 / (fastEMA + 1);
    const slowest = 2 / (slowEMA + 1);
    for (let i = period; i < prices.length; i++) {
        let change = Math.abs(prices[i] - prices[i - period]);
        let volatility = 0;
        for (let j = i - period + 1; j <= i; j++) {
            volatility += Math.abs(prices[j] - prices[j - 1]);
        }
        let ER = volatility === 0 ? 0 : change / volatility;
        let SC = Math.pow(ER * (fastest - slowest) + slowest, 2);
        let currKAMA = prevKAMA + SC * (prices[i] - prevKAMA);
        kamaValues.push(currKAMA);
        prevKAMA = currKAMA;
    }
    return kamaValues;
}

async function fetchBingxCandles(symbol, limit) {
    try {
        const res = await axios.get(`https://open-api.bingx.com/openApi/swap/v3/quote/klines?symbol=${symbol}&interval=1h&limit=${limit}`);
        let list = res.data.data;
        list.sort((a,b) => a.time - b.time);
        return list.map(k => ({
            open: parseFloat(k.open), high: parseFloat(k.high), low: parseFloat(k.low), close: parseFloat(k.close), volume: parseFloat(k.volume), date: parseInt(k.time)
        }));
    } catch(e) { return null; }
}

async function getTopPairsBingX(limit) {
    try {
        const res = await axios.get('https://open-api.bingx.com/openApi/swap/v2/quote/ticker');
        const list = res.data.data;
        const usdtPairs = list.filter(item => item.symbol.endsWith('-USDT') && parseFloat(item.quoteVolume) > 3000000);
        usdtPairs.sort((a,b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
        return usdtPairs.slice(0, limit).map(i => ({ symbol: i.symbol, quoteVolume: parseFloat(i.quoteVolume) }));
    } catch (e) {
        return [{symbol: 'BTC-USDT', quoteVolume: 20000000}]; 
    }
}

async function backtest(pairData) {
    const symbol = pairData.symbol;
    const pairVol = pairData.quoteVolume;
    let candles = await fetchBingxCandles(symbol, 750); // 1 Month
    if (!candles || candles.length < 200) return null;
    
    let simTrades = [];
    
    for (let i = 100; i < candles.length - 24; i++) {
        const window = candles.slice(i - 100, i + 1);
        const opens = window.map(k => k.open);
        const highs = window.map(k => k.high);
        const lows = window.map(k => k.low);
        const closes = window.map(k => k.close);
        const volumes = window.map(k => k.volume);
        const currentPrice = closes[closes.length - 1];
        
        const atrRes = ATR.calculate({high: highs, low: lows, close: closes, period: 14});
        const currentATR = atrRes[atrRes.length - 1] || (currentPrice * 0.015);
        
        const recentLows = lows.slice(-6);
        const recentHighs = highs.slice(-6);
        let recentMin = Math.min(...recentLows);
        let recentMax = Math.max(...recentHighs);
        const rangeHigh = Math.max(...highs);
        const rangeLow = Math.min(...lows);
        
        let dipDeviation = false; let tepeDeviation = false;
        if (recentMin <= rangeLow * 1.005 && currentPrice > rangeLow && currentPrice > highs[lows.lastIndexOf(recentMin)]) dipDeviation = true;
        if (recentMax >= rangeHigh * 0.995 && currentPrice < rangeHigh && currentPrice < lows[highs.lastIndexOf(recentMax)]) tepeDeviation = true;
        
        if (!dipDeviation && !tepeDeviation) continue;
        const direction = dipDeviation ? 'LONG' : 'SHORT';
        let qualityScore = 0;
        
        let hasFVG = false;
        for (let j = closes.length - 3; j <= closes.length - 1; j++) {
            if (j >= 2) {
                if (direction === 'LONG' && highs[j-2] < lows[j]) hasFVG = true; 
                if (direction === 'SHORT' && lows[j-2] > highs[j]) hasFVG = true; 
            }
        }
        if (hasFVG) qualityScore += 15;
        
        const obZone = direction === 'LONG' ? [rangeLow - (currentATR * 1.5), rangeLow + (currentATR * 1.5)] : [rangeHigh - (currentATR * 1.5), rangeHigh + (currentATR * 1.5)];
        let hasOB = false;
        for (let k = closes.length - 36; k <= closes.length - 6; k++) {
            if (direction === 'LONG' && closes[k] < opens[k] && closes[k] <= obZone[1] && closes[k] >= obZone[0] && highs[k+1] > highs[k]) { hasOB = true; break; }
            if (direction === 'SHORT' && closes[k] > opens[k] && closes[k] >= obZone[0] && closes[k] <= obZone[1] && lows[k+1] < lows[k]) { hasOB = true; break; }
        }
        if (hasOB) qualityScore += 25;
        
        const avgVol = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
        if (volumes[volumes.length-1] / (avgVol || 1) >= 1.2) qualityScore += 15;
        
        const kama = calculateKAMA(closes, 10, 2, 30);
        if (kama[kama.length-1]) {
            if (direction === 'LONG' && currentPrice > kama[kama.length-1]) qualityScore += 5;
            else if (direction === 'SHORT' && currentPrice < kama[kama.length-1]) qualityScore += 5;
        }
        
        const stoch = StochasticRSI.calculate({ values: closes, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 });
        if (stoch.length > 0) {
            const tk = stoch[stoch.length-1].k;
            if (direction==='LONG' && tk > 80) qualityScore -= 10;
            if (direction==='SHORT' && tk < 20) qualityScore -= 10;
        }
        
        const ichi = IchimokuCloud.calculate({ high: highs, low: lows, conversionPeriod: 9, basePeriod: 26, spanPeriod: 52, displacement: 26 });
        if (ichi.length > 0) {
            const ic = ichi[ichi.length-1];
            if (direction==='LONG' && currentPrice > ic.spanA && currentPrice > ic.spanB && ic.conversion > ic.base) qualityScore += 15;
            if (direction==='SHORT' && currentPrice < ic.spanA && currentPrice < ic.spanB && ic.conversion < ic.base) qualityScore += 15;
        }

        let minScore = direction === 'LONG' ? 55 : 60;
        if (qualityScore < minScore) continue;

        let dynamicStop = direction === 'LONG' ? currentPrice - (currentATR * 1.5) : currentPrice + (currentATR * 1.5);
        let riskDist = Math.abs(currentPrice - dynamicStop);
        let riskPct = (riskDist / currentPrice) * 100;

        // USER RULES
        // 1. SL Mesafesi (Risk) %1'den az olanlari iptal et. (Hatta %3.5 max kurali gecerli olsun risk yonetimi acisindan).
        if (riskPct < 1.0) continue; 
        if (riskPct > 3.5) continue;

        if (direction === 'LONG' && pairVol < 10000000) continue;
        if (direction === 'SHORT' && pairVol < 3000000) continue;

        // 2. TP mesafesini her zaman SL mesafesinin KESİN VEYA 2 katina koy (Gross 2.0R hedefleniyor)
        let targetDist = riskDist * 2.0;
        let targetPrice = direction === 'LONG' ? currentPrice + targetDist : currentPrice - targetDist;

        let outcome = 'PENDING';
        for (let f = i; f < candles.length; f++) {
            if (direction === 'LONG') {
                if (candles[f].low <= dynamicStop) outcome = 'LOSS';
                else if (candles[f].high >= targetPrice) outcome = 'WIN';
            } else {
                if (candles[f].high >= dynamicStop) outcome = 'LOSS';
                else if (candles[f].low <= targetPrice) outcome = 'WIN';
            }
            if (outcome !== 'PENDING') break;
        }

        if (outcome !== 'PENDING') {
            simTrades.push({ outcome, direction, riskPct });
        }
        i += 6;
    }
    
    return { symbol, simTrades };
}

async function run() {
    process.stdout.write("Fetching top 50 Pairs (>10M USD Volume) from BingX...\n");
    const pairs = await getTopPairsBingX(50);
    
    let stats = { trades: 0, win: 0, loss: 0, longs: 0, shorts: 0 };
    
    let totalNetPNL = 0;
    const FEE_RATE = 0.002; // BINGX %0.2 round trip fee tahmini limit.

    const batchSize = 10;
    for (let i = 0; i < pairs.length; i += batchSize) {
        const batch = pairs.slice(i, i + batchSize);
        const promises = batch.map(p => backtest(p));
        const results = await Promise.all(promises);
        
        results.forEach(res => {
            if (!res || !res.simTrades) return;
            res.simTrades.forEach(t => { 
                if(t.direction === 'SHORT') stats.shorts++; else stats.longs++;
                
                // DINAMIK POZISYON HESAPLAMA (Risk = $10 hedefleniyor)
                let posSizeUSD = 10 / (t.riskPct / 100);
                let feeUSD = posSizeUSD * FEE_RATE; // ~%0.2 round trip from position
                
                let netWinAmount = 20.0 - feeUSD; 
                let netLossAmount = 10.0 + feeUSD;

                if (t.outcome === 'WIN') { 
                    stats.win++; 
                    totalNetPNL += netWinAmount;
                } else if (t.outcome === 'LOSS') { 
                    stats.loss++; 
                    totalNetPNL -= netLossAmount;
                } 
            });
            stats.trades += res.simTrades.length;
        });
        process.stdout.write(`Processed ${Math.min(i + batchSize, pairs.length)}/${pairs.length} coins...\n`);
    }
    
    let wR = stats.trades > 0 ? ((stats.win / (stats.win + stats.loss)) * 100).toFixed(1) : 0;
    
    const output = {
        testedPairsCount: pairs.length,
        period: "1 Ay (720 Saat)",
        rules: "1) SL mesafesi < %1 reddedildi. 2) TP mesafesi = 2.0 * SL (Gross 2.0R). 3) Dinamik Pozisyon ($10 Risk Hedefi)",
        DINAMIK_POZISYON_SIMULASYONU: {
            "Toplam Sinyal": stats.trades,
            "Yönler": `LONG: ${stats.longs} | SHORT: ${stats.shorts}`,
            "WIN (TP)": stats.win,
            "LOSS (SL)": stats.loss,
            "Kazanma Orani": `%${wR}`,
            "AY SONU NET PNL (Kasa Etkisi)": `${totalNetPNL > 0 ? '+' : ''}$${totalNetPNL.toFixed(2)}`
        }
    };
    
    console.log("\n=== DINAMIK POZISYON + %1 STOP FILTRESI SIMULASYONU ===");
    console.log(JSON.stringify(output, null, 2));
}

run();
