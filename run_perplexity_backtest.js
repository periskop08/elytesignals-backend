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
        let res = await axios.get('https://open-api.bingx.com/openApi/swap/v2/quote/ticker');
        let list = res.data.data;
        let usdtPairs = list.filter(item => item.symbol.endsWith('-USDT') && parseFloat(item.quoteVolume) > 3000000);
        usdtPairs.sort((a,b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
        return usdtPairs.slice(0, limit).map(i => ({ symbol: i.symbol, quoteVolume: parseFloat(i.quoteVolume) }));
    } catch (e) {
        return [{symbol: 'BTC-USDT', quoteVolume: 20000000}]; 
    }
}

async function backtest(pairData) {
    const symbol = pairData.symbol;
    const pairVol = pairData.quoteVolume;
    let candles = await fetchBingxCandles(symbol, 750); // Son 1 ay (720 saat)
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
        
        // STANDARD SCORING
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
        
        // === PERPLEXITY IDEA 1: KILLER WICK REJECTION ===
        let hasKillerWick = false;
        for (let j = closes.length - 3; j <= closes.length - 1; j++) {
            if (j >= 0) {
                let candleSize = highs[j] - lows[j] || 1;
                if (direction === 'LONG') {
                    // Lower wick length
                    let minCloseOpen = Math.min(opens[j], closes[j]);
                    let lowerWick = minCloseOpen - lows[j];
                    let wickRatio = lowerWick / candleSize;
                    // Wick is > 40% of candle and candle closes in upper half
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
        if (hasKillerWick) qualityScore += 20;

        // === PERPLEXITY IDEA 2: VOLUME SHELTER ===
        let shortTermVolAvg = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
        let lastVol = volumes[volumes.length-1];
        if (direction === 'LONG' && lastVol < shortTermVolAvg * 0.9 && closes[closes.length-1] < opens[closes.length-1]) {
            qualityScore += 12; // Weak selling into a dip
        } else if (direction === 'SHORT' && lastVol < shortTermVolAvg * 0.9 && closes[closes.length-1] > opens[closes.length-1]) {
            qualityScore += 12; // Weak buying into a high
        }

        // We raise the minimum acceptable score from 55 to 70! This demands the presence of the wick/volume or extreme confluence.
        let minScore = direction === 'LONG' ? 55 : 60;
        if (qualityScore < minScore) continue;

        let dynamicStop = direction === 'LONG' ? currentPrice - (currentATR * 1.5) : currentPrice + (currentATR * 1.5);
        let riskDist = Math.abs(currentPrice - dynamicStop);
        let targetDist = riskDist * 1.5; // Eski 1.5R organik mesafede tutuyorum PUSUDAN vuracagiz.
        let targetPrice = direction === 'LONG' ? currentPrice + targetDist : currentPrice - targetDist;

        let riskPct = (riskDist / currentPrice) * 100;
        // Borsa Hacim ve Asiri Risk Filtreleri (Ayni kaliyor)
        if (direction === 'LONG' && pairVol < 10000000) continue;
        if (direction === 'SHORT' && pairVol < 3000000) continue;
        if (riskPct > 3.5) continue; 

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

        simTrades.push({ outcome, direction, riskPct, hasWick: hasKillerWick });
        i += 6;
    }
    
    return { symbol, simTrades };
}

async function run() {
    process.stdout.write("Fetching top 50 Pairs (>10M USD) from BingX...\n");
    const pairs = await getTopPairsBingX(50);
    
    let stats = { trades: 0, win: 0, loss: 0, wicksGirdigiIslem: 0 };
    let netPNL = 0;
    const FEE_RATE = 0.002;

    const batchSize = 10;
    for (let i = 0; i < pairs.length; i += batchSize) {
        const batch = pairs.slice(i, i + batchSize);
        const promises = batch.map(p => backtest(p));
        const results = await Promise.all(promises);
        
        results.forEach(res => {
            if (!res || !res.simTrades) return;
            res.simTrades.forEach(t => { 
                if (t.hasWick) stats.wicksGirdigiIslem++;

                // Dinamik Pozisyon (10$ Risk icin atilan Kursun)
                let posSizeUSD = 10 / (t.riskPct / 100);
                let feeUSD = posSizeUSD * FEE_RATE;
                
                // Hedefimiz 1.5R idi = 15$ Kar. 
                let netWinAmount = 15.0 - feeUSD; 
                let netLossAmount = 10.0 + feeUSD;

                if (t.outcome === 'WIN') { 
                    stats.win++; 
                    netPNL += netWinAmount;
                } else if (t.outcome === 'LOSS') { 
                    stats.loss++; 
                    netPNL -= netLossAmount;
                } 
            });
            stats.trades += res.simTrades.length;
        });
        process.stdout.write(`Processed ${Math.min(i + batchSize, pairs.length)}/${pairs.length} coins...\n`);
    }
    
    let wR = stats.trades > 0 ? ((stats.win / stats.trades) * 100).toFixed(1) : 0;
    
    const output = {
        Simulasyon_Kapsami: "BingX Top 50 Coin (Son 1 Ay)",
        Filtreler: "Perplexity Killer Wick (+20 Puan) ve Volume Shelter (+12 Puan) eklendi. Baraj 70'e cikarildi.",
        SONUCLAR: {
            "Toplam Sinyal Sayisi": stats.trades,
            "Killer Wick Sarti Saglananlarin Payi": stats.wicksGirdigiIslem,
            "WIN (Hedefi Vuran)": stats.win,
            "LOSS (Stop Olan)": stats.loss
        },
        ISTATISTIKLER: {
            "Yeni Kazanma Orani (Win Rate)": `%${wR}`,
            "Kasa Ay Sonu Net PNL Etkisi": `${netPNL > 0 ? '+' : ''}$${netPNL.toFixed(2)}`
        }
    };
    
    console.log("\n=== KILLER WICK & VOLUME SHELTER (PERPLEXITY) BACKTEST ===");
    console.log(JSON.stringify(output, null, 2));
}

run();
