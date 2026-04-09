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
        const usdtPairs = list.filter(item => item.symbol.endsWith('-USDT') && parseFloat(item.quoteVolume) > 3000000); // En az 3M Volume
        usdtPairs.sort((a,b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
        return usdtPairs.slice(0, limit).map(i => ({ symbol: i.symbol, quoteVolume: parseFloat(i.quoteVolume) }));
    } catch (e) {
        return [{symbol: 'BTC-USDT', quoteVolume: 20000000}]; 
    }
}

async function backtest(pairData) {
    const symbol = pairData.symbol;
    const pairVol = pairData.quoteVolume;
    let candles = await fetchBingxCandles(symbol, 750); // Son 1 ay yaklasik 720 saat
    if (!candles || candles.length < 200) return null;
    
    let oldSystemTrades = [];
    let newSystemTrades = [];
    
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
        const eq = (rangeHigh + rangeLow)/2;
        
        let dipDeviation = false; let tepeDeviation = false;
        if (recentMin <= rangeLow * 1.005 && currentPrice > rangeLow && currentPrice > highs[lows.lastIndexOf(recentMin)]) dipDeviation = true;
        if (recentMax >= rangeHigh * 0.995 && currentPrice < rangeHigh && currentPrice < lows[highs.lastIndexOf(recentMax)]) tepeDeviation = true;
        
        if (!dipDeviation && !tepeDeviation) continue;
        
        const direction = dipDeviation ? 'LONG' : 'SHORT';
        let qualityScore = 0;
        
        // FVG
        let hasFVG = false;
        for (let j = closes.length - 3; j <= closes.length - 1; j++) {
            if (j >= 2) {
                if (direction === 'LONG' && highs[j-2] < lows[j]) hasFVG = true; 
                if (direction === 'SHORT' && lows[j-2] > highs[j]) hasFVG = true; 
            }
        }
        if (hasFVG) qualityScore += 15;
        
        // ORDER BLOCK
        const obZone = direction === 'LONG' ? [rangeLow - (currentATR * 1.5), rangeLow + (currentATR * 1.5)] : [rangeHigh - (currentATR * 1.5), rangeHigh + (currentATR * 1.5)];
        let hasOB = false;
        for (let k = closes.length - 36; k <= closes.length - 6; k++) {
            if (direction === 'LONG' && closes[k] < opens[k] && closes[k] <= obZone[1] && closes[k] >= obZone[0] && highs[k+1] > highs[k]) { hasOB = true; break; }
            if (direction === 'SHORT' && closes[k] > opens[k] && closes[k] >= obZone[0] && closes[k] <= obZone[1] && lows[k+1] < lows[k]) { hasOB = true; break; }
        }
        if (hasOB) qualityScore += 25;
        
        // VOLUME
        const avgVol = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
        if (volumes[volumes.length-1] / (avgVol || 1) >= 1.2) qualityScore += 15;
        
        // KAMA
        const kama = calculateKAMA(closes, 10, 2, 30);
        if (kama[kama.length-1]) {
            if (direction === 'LONG' && currentPrice > kama[kama.length-1]) qualityScore += 5;
            else if (direction === 'SHORT' && currentPrice < kama[kama.length-1]) qualityScore += 5;
        }
        
        // STOCH RSI
        const stoch = StochasticRSI.calculate({ values: closes, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 });
        if (stoch.length > 0) {
            const tk = stoch[stoch.length-1].k;
            if (direction==='LONG' && tk > 80) qualityScore -= 10;
            if (direction==='SHORT' && tk < 20) qualityScore -= 10;
        }
        
        // ICHIMOKU
        const ichi = IchimokuCloud.calculate({ high: highs, low: lows, conversionPeriod: 9, basePeriod: 26, spanPeriod: 52, displacement: 26 });
        if (ichi.length > 0) {
            const ic = ichi[ichi.length-1];
            if (direction==='LONG' && currentPrice > ic.spanA && currentPrice > ic.spanB && ic.conversion > ic.base) qualityScore += 15;
            if (direction==='SHORT' && currentPrice < ic.spanA && currentPrice < ic.spanB && ic.conversion < ic.base) qualityScore += 15;
        }

        let requiredRR = 1.5;
        let dynamicStop = direction === 'LONG' ? currentPrice - (currentATR * 1.5) : currentPrice + (currentATR * 1.5);
        let risk = Math.abs(currentPrice - dynamicStop);
        let riskPct = (risk / currentPrice) * 100;

        if (riskPct > 3.5) continue; // max sl pct

        let targetP_organic = eq;
        let reward_organic = Math.abs(currentPrice - targetP_organic);
        let organicRR = risk > 0 ? (reward_organic / risk) : 0;

        // PUANLAMALAR (Ortak)
        let qualityScoreSys1 = qualityScore; // RR 1.0 için (Puan bonusu yok)
        let qualityScoreSys2 = qualityScore; // RR 1.5 için (Eğer RR >= 1.5 ise +5, >=2.0 ise +25 bonus alacak organik)

        if (organicRR >= 2.0) qualityScoreSys2 += 25;
        else if (organicRR >= 1.5) qualityScoreSys2 += 5;

        // Hacim Barajı Kontrolü (Long 10M, Short 3M)
        if (direction === 'LONG' && pairVol < 10000000) continue;
        if (direction === 'SHORT' && pairVol < 3000000) continue;

        let sys1Active = false;
        let sys2Active = false;

        // Asimetrik Puan Barajı (Long 55, Short 60)
        let minScore = direction === 'LONG' ? 55 : 60;

        if (qualityScoreSys1 >= minScore) { sys1Active = true; }
        if (qualityScoreSys2 >= minScore) { sys2Active = true; }

        if (!sys1Active && !sys2Active) continue;

        // Simülasyon 1: 1.0 RR Minimum
        let reqReward_1 = risk * 1.0;
        let extReward_1 = reward_organic < reqReward_1 ? reqReward_1 : reward_organic;
        let maxRew_1 = risk * 3.0;
        if(extReward_1 > maxRew_1) extReward_1 = maxRew_1;
        let target_1 = direction === 'LONG' ? currentPrice + extReward_1 : currentPrice - extReward_1;
        let finalRR_1 = risk > 0 ? (extReward_1 / risk) : 0;

        // Simülasyon 2: 1.5 RR Minimum (Premium varsa 2.0)
        let reqRR_2 = riskPct > 2.5 ? 2.0 : 1.5;
        let reqReward_2 = risk * reqRR_2;
        let extReward_2 = reward_organic < reqReward_2 ? reqReward_2 : reward_organic;
        let maxRew_2 = risk * 3.0;
        if(extReward_2 > maxRew_2) extReward_2 = maxRew_2;
        let target_2 = direction === 'LONG' ? currentPrice + extReward_2 : currentPrice - extReward_2;
        let finalRR_2 = risk > 0 ? (extReward_2 / risk) : 0;

        let outcome_1 = 'PENDING';
        let outcome_2 = 'PENDING';

        for (let f = i; f < candles.length; f++) {
            if (outcome_1 === 'PENDING') {
                if (direction === 'LONG') {
                    if (candles[f].low <= dynamicStop) outcome_1 = 'LOSS';
                    else if (candles[f].high >= target_1) outcome_1 = 'WIN';
                } else {
                    if (candles[f].high >= dynamicStop) outcome_1 = 'LOSS';
                    else if (candles[f].low <= target_1) outcome_1 = 'WIN';
                }
            }

            if (outcome_2 === 'PENDING') {
                if (direction === 'LONG') {
                    if (candles[f].low <= dynamicStop) outcome_2 = 'LOSS';
                    else if (candles[f].high >= target_2) outcome_2 = 'WIN';
                } else {
                    if (candles[f].high >= dynamicStop) outcome_2 = 'LOSS';
                    else if (candles[f].low <= target_2) outcome_2 = 'WIN';
                }
            }

            if (outcome_1 !== 'PENDING' && outcome_2 !== 'PENDING') break;
        }

        if (sys1Active && finalRR_1 >= 1.0) {
            oldSystemTrades.push({ outcome: outcome_1, rr: finalRR_1, direction });
        }
        if (sys2Active && finalRR_2 >= reqRR_2) {
            newSystemTrades.push({ outcome: outcome_2, rr: finalRR_2, direction });
        }
        
        i += 6; // Spam prevention
    }
    
    return { symbol, oldSystemTrades, newSystemTrades };
}

async function run() {
    process.stdout.write("Fetching top 50 Pairs (>10M USD Volume) from BingX...\n");
    const pairs = await getTopPairsBingX(50);
    
    let statsOld = { trades: 0, win: 0, loss: 0, totalR: 0, shorts: 0, longs: 0 };
    let statsNew = { trades: 0, win: 0, loss: 0, totalR: 0, shorts: 0, longs: 0 };
    
    const batchSize = 10;
    for (let i = 0; i < pairs.length; i += batchSize) {
        const batch = pairs.slice(i, i + batchSize);
        const promises = batch.map(p => backtest(p));
        const results = await Promise.all(promises);
        
        results.forEach(res => {
            if (!res) return;
            
            res.oldSystemTrades.forEach(t => { 
                if(t.direction === 'SHORT') statsOld.shorts++; else statsOld.longs++;
                if (t.outcome === 'WIN') { statsOld.win++; statsOld.totalR += t.rr; }
                else if (t.outcome === 'LOSS') { statsOld.loss++; statsOld.totalR -= 1; }
            });
            
            res.newSystemTrades.forEach(t => { 
                if(t.direction === 'SHORT') statsNew.shorts++; else statsNew.longs++;
                if (t.outcome === 'WIN') { statsNew.win++; statsNew.totalR += t.rr; }
                else if (t.outcome === 'LOSS') { statsNew.loss++; statsNew.totalR -= 1; }
            });
            
            statsOld.trades += res.oldSystemTrades.length;
            statsNew.trades += res.newSystemTrades.length;
        });
        process.stdout.write(`Processed ${Math.min(i + batchSize, pairs.length)}/${pairs.length} coins...\n`);
    }
    
    let wR_Old = statsOld.trades > 0 ? ((statsOld.win / (statsOld.win + statsOld.loss)) * 100).toFixed(1) : 0;
    let wR_New = statsNew.trades > 0 ? ((statsNew.win / (statsNew.win + statsNew.loss)) * 100).toFixed(1) : 0;
    
    const output = {
        testedPairsCount: pairs.length,
        period: "1 Month (720 Hours)",
        GECMIS_DONEM_RR_1_0_SISTEMI: {
            "Total Signals": statsOld.trades,
            "Direction": `LONG: ${statsOld.longs} | SHORT: ${statsOld.shorts}`,
            "TP (Wins)": statsOld.win,
            "SL (Losses)": statsOld.loss,
            "Win Rate (wR)": `%${wR_Old}`,
            "Total R Gained": parseFloat(statsOld.totalR.toFixed(2)) + " R",
            "Monthly Account Growth ($10 Risk per trade)": "$" + (statsOld.totalR * 10).toFixed(2)
        },
        YENI_DONEM_RR_1_5_STI: {
            "Total Signals": statsNew.trades,
            "Direction": `LONG: ${statsNew.longs} | SHORT: ${statsNew.shorts}`,
            "TP (Wins)": statsNew.win,
            "SL (Losses)": statsNew.loss,
            "Win Rate (wR)": `%${wR_New}`,
            "Total R Gained": parseFloat(statsNew.totalR.toFixed(2)) + " R",
            "Monthly Account Growth ($10 Risk per trade)": "$" + (statsNew.totalR * 10).toFixed(2)
        }
    };
    
    console.log("=== MONTHLY R:R SYSTEM COMPARATIVE BACKTEST ===");
    console.log(JSON.stringify(output, null, 2));
}

run();
