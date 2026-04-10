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

        let dynamicStop = direction === 'LONG' ? currentPrice - (currentATR * 1.5) : currentPrice + (currentATR * 1.5);
        let risk = Math.abs(currentPrice - dynamicStop);
        let riskPct = (risk / currentPrice) * 100;

        if (riskPct > 3.5) continue; 

        if (direction === 'LONG' && pairVol < 10000000) continue;
        if (direction === 'SHORT' && pairVol < 3000000) continue;

        let minScore = direction === 'LONG' ? 55 : 60;
        if (qualityScore < minScore) continue;

        // Old System: Brüt 1.5R hedefler, borsa kesintisiyle elinde kalan Net ~1.1R
        let extReward_1 = risk * 1.5;
        let target_1 = direction === 'LONG' ? currentPrice + extReward_1 : currentPrice - extReward_1;

        // New System: Net 1.5R kalması için Brüt 2.0R hedefler
        let extReward_2 = risk * 2.0;
        let target_2 = direction === 'LONG' ? currentPrice + extReward_2 : currentPrice - extReward_2;

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

        oldSystemTrades.push({ outcome: outcome_1, direction });
        newSystemTrades.push({ outcome: outcome_2, direction });
        
        i += 6;
    }
    
    return { symbol, oldSystemTrades, newSystemTrades };
}

async function run() {
    process.stdout.write("Fetching top 50 Pairs (>10M USD Volume) from BingX...\n");
    const pairs = await getTopPairsBingX(50);
    
    let statsOld = { trades: 0, win: 0, loss: 0, longs: 0, shorts: 0 };
    let statsNew = { trades: 0, win: 0, loss: 0, longs: 0, shorts: 0 };
    
    const batchSize = 10;
    for (let i = 0; i < pairs.length; i += batchSize) {
        const batch = pairs.slice(i, i + batchSize);
        const promises = batch.map(p => backtest(p));
        const results = await Promise.all(promises);
        
        results.forEach(res => {
            if (!res) return;
            res.oldSystemTrades.forEach(t => { 
                if(t.direction === 'SHORT') statsOld.shorts++; else statsOld.longs++;
                if (t.outcome === 'WIN') statsOld.win++; 
                else if (t.outcome === 'LOSS') statsOld.loss++; 
            });
            res.newSystemTrades.forEach(t => { 
                if(t.direction === 'SHORT') statsNew.shorts++; else statsNew.longs++;
                if (t.outcome === 'WIN') statsNew.win++; 
                else if (t.outcome === 'LOSS') statsNew.loss++; 
            });
            statsOld.trades += res.oldSystemTrades.length;
            statsNew.trades += res.newSystemTrades.length;
        });
        process.stdout.write(`Processed ${Math.min(i + batchSize, pairs.length)}/${pairs.length} coins...\n`);
    }
    
    let wR_Old = statsOld.trades > 0 ? ((statsOld.win / (statsOld.win + statsOld.loss)) * 100).toFixed(1) : 0;
    let wR_New = statsNew.trades > 0 ? ((statsNew.win / (statsNew.win + statsNew.loss)) * 100).toFixed(1) : 0;
    
    // Fee calculations based on $1000 Position Size per Trade (e.g. $50 x 20)
    const POS_SIZE = 1000;
    const FEE_PERCENT = 0.002; // BINGX Market Entry + Limit/Market Exit averages ~0.2% total
    const FEE_USD = POS_SIZE * FEE_PERCENT; // = $2.00
    
    // Old System Base Values
    const RISK_USD = 10.0;
    const NET_LOSS = RISK_USD + FEE_USD; // $12.00
    const OLD_REWARD_GROSS = 15.0; // 1.5R
    const OLD_NET_PROFIT = OLD_REWARD_GROSS - FEE_USD; // $13.00

    // New System Base Values
    const NEW_REWARD_GROSS = 20.0; // 2.0R Brüt hedefleniyor
    const NEW_NET_PROFIT = NEW_REWARD_GROSS - FEE_USD; // $18.00 (Tam olarak 1.5 katı NET R)

    const oldTotalUSD = (statsOld.win * OLD_NET_PROFIT) - (statsOld.loss * NET_LOSS);
    const newTotalUSD = (statsNew.win * NEW_NET_PROFIT) - (statsNew.loss * NET_LOSS);

    const output = {
        testedPairsCount: pairs.length,
        period: "Son 1 Ay (720 Saatlik MUM Verisi)",
        parametreler: "Kasa $500, Marjin $50, Kaldıraç 20x -> Pozisyon Boyutu $1000 (Her sinyal 1% Stop = $10 Risk + $2 Borsa Komisyonu = $12 NET LOSS)",
        MEVCUT_SISTEM_BRUT_1_5R: {
            "Sinyal Kalitesi": "1.5 R Hedefliyor (Kâr edince borsaya $2 veriyor eline $13 geçiyor)",
            "Toplam Sinyal": statsOld.trades,
            "Yönler": `LONG: ${statsOld.longs} | SHORT: ${statsOld.shorts}`,
            "WIN (TP)": statsOld.win,
            "LOSS (SL)": statsOld.loss,
            "Win Rate": `%${wR_Old}`,
            "Aylik Net Kazancli Islem Getirisi": `+ $${(statsOld.win * OLD_NET_PROFIT).toFixed(2)}`,
            "Aylik Net Zararli Islem Kaybi": `- $${(statsOld.loss * NET_LOSS).toFixed(2)}`,
            "AY SONU NET PNL (Kasa Etkisi)": `$${oldTotalUSD.toFixed(2)}`
        },
        YENI_SISTEM_NET_1_5R_BRUT_2_0R: {
            "Sinyal Kalitesi": "2.0 R Hedefliyor (Borsaya $2 verince net Kâr $18 kalıyor, Net Risk $12 hesabı tam 1.5 Net R!)",
            "Toplam Sinyal": statsNew.trades,
            "Yönler": `LONG: ${statsNew.longs} | SHORT: ${statsNew.shorts}`,
            "WIN (TP)": statsNew.win,
            "LOSS (SL)": statsNew.loss,
            "Win Rate": `%${wR_New}`,
            "Aylik Net Kazancli Islem Getirisi": `+ $${(statsNew.win * NEW_NET_PROFIT).toFixed(2)}`,
            "Aylik Net Zararli Islem Kaybi": `- $${(statsNew.loss * NET_LOSS).toFixed(2)}`,
            "AY SONU NET PNL (Kasa Etkisi)": `$${newTotalUSD.toFixed(2)}`
        }
    };
    
    console.log("=== BINGX 1 AYLIK NET KOMISYON HESAPLAMALI BACKTEST ===");
    console.log(JSON.stringify(output, null, 2));
}

run();
