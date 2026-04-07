const { ATR, IchimokuCloud, StochasticRSI } = require('technicalindicators');
const YF = require('yahoo-finance2').default;
const yahooFinance = new YF({suppressNotices: ['yahooSurvey']});

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

async function fetchYF(symbol, daysOffset) {
    try {
        const queryOptions = { period1: new Date(Date.now() - daysOffset * 24 * 60 * 60 * 1000), interval: '1h' };
        const result = await yahooFinance.chart(symbol, queryOptions);
        let quotes = result.quotes.filter(q => q.open !== null && q.close !== null);
        return quotes.map(q => ({
            open: q.open, high: q.high, low: q.low, close: q.close, volume: q.volume || 0, date: new Date(q.date).getTime()
        }));
    } catch(e) { return null; }
}

async function backtestIndicatorOnly(symbol) {
    let candles = await fetchYF(symbol, 180);
    if (!candles || candles.length < 150) return null;
    let trades = [];
    
    // We look at 100 candle windows
    for (let i = 100; i < candles.length - 10; i++) {
        const window = candles.slice(i - 100, i + 1);
        const highs = window.map(k => k.high);
        const lows = window.map(k => k.low);
        const closes = window.map(k => k.close);
        const volumes = window.map(k => k.volume);
        
        const currentPrice = closes[closes.length - 1];
        
        const atrRes = ATR.calculate({high: highs, low: lows, close: closes, period: 14});
        const currentATR = atrRes[atrRes.length - 1] || (currentPrice * 0.015);
        
        // KAMA
        const kama = calculateKAMA(closes, 10, 2, 30);
        const currentKAMA = kama[kama.length - 1];
        
        // StochRSI
        const stoch = StochasticRSI.calculate({ values: closes, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 });
        const currentStoch = stoch.length > 0 ? stoch[stoch.length - 1].k : 50;
        
        // Ichimoku
        const ichi = IchimokuCloud.calculate({ high: highs, low: lows, conversionPeriod: 9, basePeriod: 26, spanPeriod: 52, displacement: 26 });
        const currentIchi = ichi.length > 0 ? ichi[ichi.length - 1] : null;
        
        // Order Flow 
        const buyVol = volumes[volumes.length-1] * ((closes[closes.length-1] - lows[lows.length-1]) / (highs[highs.length-1] - lows[lows.length-1] || 1));
        const sellVol = volumes[volumes.length-1] - buyVol;
        
        let direction = null;
        let score = 0;
        
        // LONG EVAL
        let longScore = 0;
        if (currentIchi && currentPrice > currentIchi.spanA && currentPrice > currentIchi.spanB && currentIchi.conversion > currentIchi.base) longScore += 15;
        if (currentPrice > currentKAMA) longScore += 5;
        if (buyVol > sellVol) longScore += 8;
        if (currentStoch > 80) longScore -= 10;
        
        // SHORT EVAL
        let shortScore = 0;
        if (currentIchi && currentPrice < currentIchi.spanA && currentPrice < currentIchi.spanB && currentIchi.conversion < currentIchi.base) shortScore += 15;
        if (currentPrice < currentKAMA) shortScore += 5;
        if (sellVol > buyVol) shortScore += 8;
        if (currentStoch < 20) shortScore -= 10;
        
        if (longScore >= 20 && longScore > shortScore) { direction = 'LONG'; score = longScore; }
        else if (shortScore >= 20 && shortScore > longScore) { direction = 'SHORT'; score = shortScore; }
        
        if (!direction) continue;
        
        let risk = currentATR * 1.5;
        let dynamicStop = direction === 'LONG' ? currentPrice - risk : currentPrice + risk;
        let reward = risk * 2.0; // 1:2 RR
        let targetP = direction === 'LONG' ? currentPrice + reward : currentPrice - reward;
        
        let outcome = 'PENDING';
        for (let f = i + 1; f < candles.length; f++) {
            if (direction === 'LONG') {
                if (candles[f].low <= dynamicStop) { outcome = 'LOSS'; break; }
                if (candles[f].high >= targetP) { outcome = 'WIN'; break; }
            } else {
                if (candles[f].high >= dynamicStop) { outcome = 'LOSS'; break; }
                if (candles[f].low <= targetP) { outcome = 'WIN'; break; }
            }
        }
        
        trades.push({ date: new Date(candles[i].date).toLocaleString(), direction, score, outcome });
        i += 10; // cooldown to prevent identical overlapping signals
    }
    
    return { symbol, trades };
}

async function run() {
    const pairs = ['NVDA', 'AMD', 'AAPL', 'TSLA'];
    let results = [];
    for (let p of pairs) {
        let res = await backtestIndicatorOnly(p);
        if (res) results.push(res);
    }
    console.log(JSON.stringify(results, null, 2));
}

run();
