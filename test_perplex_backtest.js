const axios = require('axios');
const { ATR, SMA, EMA, RSI, ADX } = require('technicalindicators');

const CONFIG = {
    minScore: 40,
    longVol: 4000000,
    shortVol: 2000000
};

// --- BINGX API HELPERS ---
async function getUsdtPairs() {
    try {
        const response = await axios.get('https://api.binance.com/api/v3/ticker/24hr');
        const symbols = response.data;
        const ignoredStables = ['USDCUSDT', 'USD1USDT', 'USDEUSDT', 'BUSDUSDT', 'TUSDUSDT', 'FDUSDUSDT', 'EURUSDT', 'DAIUSDT', 'USTCUSDT', 'PYUSDUSDT'];
        const usdtPairs = symbols.filter(s => 
            s.symbol.endsWith('USDT') && 
            !ignoredStables.includes(s.symbol) && 
            parseFloat(s.quoteVolume) >= 2000000 
        );
        return usdtPairs.map(s => ({ 
            symbol: s.symbol, 
            bingxSymbol: s.symbol.replace('USDT', '-USDT'),
            volume: parseFloat(s.quoteVolume) 
        }));
    } catch (e) {
        console.error("Ticker fetch error:", e.message);
        return [];
    }
}

async function fetchCandles(bingxSymbol, limit = 1000) {
    try {
        const res = await axios.get(`https://open-api.bingx.com/openApi/swap/v3/quote/klines?symbol=${bingxSymbol}&interval=1h&limit=${limit}`);
        let list = res.data.data || [];
        list.sort((a,b) => a.time - b.time);
        
        return list.map(k => ({
            open: parseFloat(k.open),
            high: parseFloat(k.high),
            low: parseFloat(k.low),
            close: parseFloat(k.close),
            volume: parseFloat(k.volume),
            time: parseInt(k.time)
        }));
    } catch (e) {
        return null;
    }
}

// --- ANALYSIS HELPERS ---
function calculateTrend(closes) {
    if (closes.length < 50) return 'NEUTRAL';
    const ema20 = EMA.calculate({period: 20, values: closes});
    const sma50 = SMA.calculate({period: 50, values: closes});
    const { RSI } = require('technicalindicators');
    const rsi = RSI.calculate({period: 14, values: closes});
    
    if (!ema20.length || !sma50.length || !rsi.length) return 'NEUTRAL';

    const lastClose = closes[closes.length - 1];
    const lastEma = ema20[ema20.length - 1];
    const lastSma = sma50[sma50.length - 1];

    if (lastClose > lastEma && lastEma > lastSma) return 'BULL';
    if (lastClose < lastEma && lastEma < lastSma) return 'BEAR';
    return 'NEUTRAL';
}

function processCandleWindow(symbolObj, allCandles, index) {
    // index is the current "live" candle we are evaluating
    const klinesFull = allCandles.slice(0, index + 1);
    if(klinesFull.length < 210) return null;

    const closesFull = klinesFull.map(k => k.close);
    const sma200Values = SMA.calculate({period: 200, values: closesFull});
    const curSma200 = sma200Values[sma200Values.length - 1];

    // Get last 100 context candles
    const klines = klinesFull.slice(-100);
    const opens = klines.map(k => k.open);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const closes = klines.map(k => k.close);
    
    const currentPrice = closes[closes.length - 1];
    const currentOpen = opens[opens.length - 1];
    const currentHigh = highs[highs.length - 1];
    const currentLow = lows[lows.length - 1];

    const rangeHigh = Math.max(...highs);
    const rangeLow = Math.min(...lows);

    const atrRes = ATR.calculate({high: highs, low: lows, close: closes, period: 14});
    const currentATR = atrRes[atrRes.length - 1] || (currentPrice * 0.015);
    
    let avgATR = currentATR;
    if (atrRes.length >= 14) {
         const last14 = atrRes.slice(-14);
         avgATR = last14.reduce((acc, val) => acc + val, 0) / 14;
    }

    // Likidite SWEEP kontrolü (Son 6 muma göre)
    const recentLows = lows.slice(-6);
    const recentHighs = highs.slice(-6);
    let recentMin = Math.min(...recentLows);
    let recentMax = Math.max(...recentHighs);
    let direction = null;
    let sweepIdx = -1;

    // Uzun Fitil (Killer Wick) hesabı - güncel mum için
    let wickSize = 0;
    
    if (recentMin <= rangeLow * 1.005 && currentPrice > rangeLow) {
        let idx = lows.lastIndexOf(recentMin);
        if (idx !== -1 && currentPrice > highs[idx]) {
            direction = 'LONG';
            sweepIdx = idx;
            const tOpen = opens[closes.length - 1];
            const tClose = closes[closes.length - 1];
            wickSize = Math.min(tOpen, tClose) - currentLow; // Alt fitil
        }
    } else if (recentMax >= rangeHigh * 0.995 && currentPrice < rangeHigh) {
        let idx = highs.lastIndexOf(recentMax);
        if (idx !== -1 && currentPrice < lows[idx]) {
            direction = 'SHORT';
            sweepIdx = idx;
            const tOpen = opens[closes.length - 1];
            const tClose = closes[closes.length - 1];
            wickSize = currentHigh - Math.max(tOpen, tClose); // Üst fitil
        }
    }

    if (!direction) return null;

    // Hacim Kontrolü
    const globalVol = symbolObj.volume;
    if (direction === 'LONG' && globalVol < CONFIG.longVol) return null;
    if (direction === 'SHORT' && globalVol < CONFIG.shortVol) return null;

    // Macro Trend (BTC/Global representation using local trend equivalent)
    const localTrend = calculateTrend(closesFull);

    // ADX Hesaplama (Ranging Limit tespiti)
    const adxRes = ADX.calculate({high: highs, low: lows, close: closes, period: 14});
    const currentADX = adxRes.length > 0 ? adxRes[adxRes.length - 1].adx : 25;
    const isRangingLimit = currentADX < 20;

    // HARD-BLOCK VETO KURALI: Ranging Piyasada Makro Trende Karşı İşlem AÇILAMAZ!
    if (isRangingLimit) {
        if (direction === 'LONG' && localTrend === 'BEAR') return null; // VETO
        if (direction === 'SHORT' && localTrend === 'BULL') return null; // VETO
    }

    // Puanlama Sistemi
    let qualityScore = 0;

    // Order Block
    const obZone = direction === 'LONG' ? [rangeLow - (currentATR * 1.5), rangeLow + (currentATR * 1.5)] : [rangeHigh - (currentATR * 1.5), rangeHigh + (currentATR * 1.5)];
    const obCandlesStart = closes.length - 36;
    let hasOB = false;
    for (let i = obCandlesStart; i <= closes.length - 6; i++) {
        if (i < 0) continue;
        if (direction === 'LONG' && closes[i] < opens[i] && closes[i] <= obZone[1] && closes[i] >= obZone[0]) {
            if (highs[i+1] > highs[i]) { hasOB = true; break; }
        } else if (direction === 'SHORT' && closes[i] > opens[i] && closes[i] >= obZone[0] && closes[i] <= obZone[1]) {
            if (lows[i+1] < lows[i]) { hasOB = true; break; }
        }
    }

    // FVG
    let hasFVG = false;
    const lastIdx = closes.length - 1;
    if (direction === 'LONG' && highs[lastIdx-2] < lows[lastIdx]) hasFVG = true; 
    if (direction === 'SHORT' && lows[lastIdx-2] > highs[lastIdx]) hasFVG = true; 

    if (hasOB) qualityScore += 25;
    if (hasFVG) qualityScore += 15;

    // 200 SMA TUZAĞI BONUSU / CEZASI
    let isOppositeSMA = false;
    if (direction === 'LONG' && currentPrice < curSma200) isOppositeSMA = true;
    if (direction === 'SHORT' && currentPrice > curSma200) isOppositeSMA = true;

    if (isOppositeSMA) {
        // Killer Wick (Wick > 1.5 ATR) AND (OB or FVG)
        if (wickSize > (avgATR * 1.5) && (hasOB || hasFVG)) {
            qualityScore += 15; // TUZAK BONUSU (Ceza yerine Bonus)
        } else {
            qualityScore -= 15; // STANDART CEZA
        }
    }

    // Ranging Limit Cezası
    if (isRangingLimit) {
        qualityScore -= 15;
    }

    // Volatilite Cezası
    if (currentATR > avgATR * 2.0) qualityScore -= 15;

    // RSI Cezası
    const rsiRes = RSI.calculate({period: 14, values: closes});
    const currentRSI = rsiRes[rsiRes.length - 1] || 50;
    if (direction === 'LONG' && currentRSI > 75) qualityScore -= 10;
    if (direction === 'SHORT' && currentRSI < 25) qualityScore -= 10;

    // Eşik Kontrolü
    if (qualityScore < CONFIG.minScore) return null;

    // Hedef(TP) ve Stop(SL) belirleme
    let rrRatio = isRangingLimit ? 1.0 : 1.5; // RANGING LIMIT TP KISILTILIYOR
    
    // Ufak komisyon vs toleransı ekleniyor stop'a (eski mantık ATR tabanlı)
    let stopLoss = 0;
    if (direction === 'LONG') stopLoss = Math.min(...lows.slice(sweepIdx)) * 0.998;
    else stopLoss = Math.max(...highs.slice(sweepIdx)) * 1.002;
    
    let risk = Math.abs(currentPrice - stopLoss);
    if(risk < currentPrice * 0.005) {
        risk = currentPrice * 0.005;
        stopLoss = direction === 'LONG' ? currentPrice - risk : currentPrice + risk;
    }

    let targetPrice = direction === 'LONG' ? currentPrice + (risk * rrRatio) : currentPrice - (risk * rrRatio);

    return {
        symbol: symbolObj.symbol,
        direction,
        entryPrice: currentPrice,
        stopLoss,
        targetPrice,
        score: qualityScore,
        isRangingLimit,
        risk
    };
}

// --- TRADE SIMULATOR ---
function simulateTrade(trade, forwardCandles) {
    // trade contains entryPrice, stopLoss, targetPrice, direction, risk
    // forwardCandles are the candles coming AFTER the entry candle
    let result = { status: 'PENDING', pnl: 0, closedAtIdx: -1, isBreakeven: false };

    // Breakeven kuralı: Hedefe vurmadan önce 1R (Veya ranging ise 0.8R) risk kârı alırsa SL girişe çekilir.
    let breakevenToleransR = trade.isRangingLimit ? 0.8 : 1.0;
    let breakevenPrice = trade.direction === 'LONG' ? trade.entryPrice + (trade.risk * breakevenToleransR) : trade.entryPrice - (trade.risk * breakevenToleransR);

    // Stop Loss updates when Breakeven hits
    let currentStop = trade.stopLoss;
    let breakevenHit = false;

    for (let i = 0; i < forwardCandles.length; i++) {
        const c = forwardCandles[i];

        if (trade.direction === 'LONG') {
            // Did it hit Target? Target assumes it touched the HIGH
            if (c.high >= trade.targetPrice) {
                 result.status = 'WIN';
                 result.pnl = ((trade.targetPrice - trade.entryPrice) / trade.entryPrice);
                 result.closedAtIdx = i;
                 break;
            }
            // Did it hit Stop?
            if (c.low <= currentStop) {
                 result.status = breakevenHit ? 'BREAKEVEN' : 'LOSS';
                 result.pnl = ((currentStop - trade.entryPrice) / trade.entryPrice);
                 result.closedAtIdx = i;
                 break;
            }
            // Did it hit Breakeven threshold?
            if (!breakevenHit && c.high >= breakevenPrice) {
                 breakevenHit = true;
                 currentStop = trade.entryPrice * 1.0015; // komisyonlu breakeven
            }

        } else { // SHORT
            // Did it hit Target? touches LOW
            if (c.low <= trade.targetPrice) {
                 result.status = 'WIN';
                 result.pnl = ((trade.entryPrice - trade.targetPrice) / trade.entryPrice);
                 result.closedAtIdx = i;
                 break;
            }
            // Did it hit Stop? touches HIGH
            if (c.high >= currentStop) {
                 result.status = breakevenHit ? 'BREAKEVEN' : 'LOSS';
                 result.pnl = ((trade.entryPrice - currentStop) / trade.entryPrice);
                 result.closedAtIdx = i;
                 break;
            }
            // Did it hit Breakeven threshold?
            if (!breakevenHit && c.low <= breakevenPrice) {
                 breakevenHit = true;
                 currentStop = trade.entryPrice * 0.9985;
            }
        }
    }

    return result;
}

// --- MAIN RUNNER ---
async function runBacktest() {
    console.log("Fetching USDT Pairs from BingX...");
    let pairs = await getUsdtPairs();
    console.log(`Found ${pairs.length} eligible pairs.`);

    let allGeneratedTrades = [];

    // Taramayı hızlandırmak için 10'arlı gruplarda (batches) işlem yapalım
    const batchSize = 10;
    for (let i = 0; i < pairs.length; i += batchSize) {
        const batch = pairs.slice(i, i + batchSize);
        console.log(`Processing batch ${i/batchSize + 1} / ${Math.ceil(pairs.length/batchSize)}...`);
        
        await Promise.all(batch.map(async (pair) => {
            const candles = await fetchCandles(pair.bingxSymbol, 1000); // 1 aylik (~720 saat + buffer)
            if (!candles || candles.length < 300) return;

            // Zaman makinesi: 250. mumdan başla 990. muma kadar her simülasyon adımı
            for (let idx = 250; idx < candles.length - 2; idx++) {
                const signal = processCandleWindow(pair, candles, idx);
                if (signal) {
                    // İşlem bulundu! İlerleyen mumlarda ne olduğunu simüle et
                    const forwardCandles = candles.slice(idx + 1);
                    const outcome = simulateTrade(signal, forwardCandles);
                    
                    if (outcome.status !== 'PENDING') {
                        signal.outcome = outcome.status;
                        signal.rawPnl = outcome.pnl; // percentage eg 0.05
                        allGeneratedTrades.push(signal);
                    }
                    
                    // İşlem bitene kadar zaman makinesini ileri atlat (Eşzamanlı pozisyon açmamak için)
                    if (outcome.closedAtIdx !== -1) {
                         idx = idx + outcome.closedAtIdx;
                    }
                }
            }
        }));
    }

    // --- EVALUATION & MANIFESTO REPORTING ---
    console.log(`\\n--- BACKTEST RESULTS (${allGeneratedTrades.length} Total Trades) ---`);
    
    // Groups: 40-44, 45-49, 50-54, 55-59, 60-64, 65-69, 70-74, 75-100
    const scoreGroups = [
        { min: 40, max: 44, trades: [] },
        { min: 45, max: 49, trades: [] },
        { min: 50, max: 54, trades: [] },
        { min: 55, max: 59, trades: [] },
        { min: 60, max: 64, trades: [] },
        { min: 65, max: 69, trades: [] },
        { min: 70, max: 74, trades: [] },
        { min: 75, max: 200, trades: [] }
    ];

    allGeneratedTrades.forEach(t => {
        let matchedGroup = scoreGroups.find(g => t.score >= g.min && t.score <= g.max);
        if (matchedGroup) matchedGroup.trades.push(t);
    });

    const STARTING_CAPITAL = 500;
    const LEVERAGE = 20;

    scoreGroups.forEach(group => {
        if (group.trades.length === 0) return;

        let wins = group.trades.filter(t => t.outcome === 'WIN').length;
        let losses = group.trades.filter(t => t.outcome === 'LOSS').length;
        let breakevens = group.trades.filter(t => t.outcome === 'BREAKEVEN').length;
        
        // Note: Mathematical Win Rate conceptually drops breakevens or treats them as neutral, we calculate strict Win Rate as Wins / (Wins+Losses)
        let strictTotal = wins + losses;
        let winRate = strictTotal > 0 ? (wins / strictTotal) * 100 : 0;

        // PnL Simulation ($500 Account -> 10% Risk per trade = $50 Margin)
        // Position Size = Margin * Leverage = $1000 Total Size. 
        // Gross_PnL = Position Size * rawPnl
        let currentCapital = STARTING_CAPITAL;
        
        group.trades.forEach(t => {
            let margin = Math.min(50, currentCapital * 0.1); // Use 10% or max $50 per trade
            let posSize = margin * LEVERAGE;
            let usdProfit = posSize * t.rawPnl;
            currentCapital += usdProfit;
        });

        let netGainUsd = currentCapital - STARTING_CAPITAL;

        console.log(`\\n[SCORE RANGE: ${group.min} - ${group.max === 200 ? '100+' : group.max}]`);
        console.log(`- Toplam Islem: ${group.trades.length} | LONG: ${group.trades.filter(t=>t.direction==='LONG').length} / SHORT: ${group.trades.filter(t=>t.direction==='SHORT').length}`);
        console.log(`- Sonuclar: WIN: ${wins} | LOSS: ${losses} | BREAKEVEN: ${breakevens}`);
        console.log(`- Strict Win Rate: %${winRate.toFixed(2)}`);
        console.log(`- Kasadaki Net Degisim: ${netGainUsd >= 0 ? '+' : ''}$${netGainUsd.toFixed(2)} USD (Son Kasa: $${currentCapital.toFixed(2)})`);
    });
}

runBacktest().catch(console.error);
