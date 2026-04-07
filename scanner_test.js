const axios = require('axios');
const cron = require('node-cron');
const db = require('./database');
const { ATR, SMA, ADX, EMA, IchimokuCloud, StochasticRSI } = require('technicalindicators');
const { analyzeElliottWaves } = require('./elliott');
const TelegramBot = require('node-telegram-bot-api');
const { exec } = require('child_process');
const { appendToSheet } = require('./google-api');
const { placeOrder, getPosition } = require('./bybit-trade');
const YahooFinanceClass = require('yahoo-finance2').default;
const yahooFinance = new YahooFinanceClass();

const ASSET_SYMBOLS = [
    { symbol: 'XAUUSD', isAsset: true, fetchId: 'GC=F' }, // Gold
    { symbol: 'XAGUSD', isAsset: true, fetchId: 'SI=F' }, // Silver
    { symbol: 'USOIL', isAsset: true, fetchId: 'CL=F' },  // Crude Oil
    { symbol: 'EURUSD', isAsset: true, fetchId: 'EURUSD=X' },
    { symbol: 'AAPL', isAsset: true, fetchId: 'AAPL' },
    { symbol: 'TSLA', isAsset: true, fetchId: 'TSLA' },
    { symbol: 'NASDAQ', isAsset: true, fetchId: '^IXIC' }
];

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


async function fetchCandles(symbolInfo, intervalMinutes, limit) {
    if (typeof symbolInfo === 'string' || !symbolInfo.isAsset) { // Crypto (Bybit)
        const sym = typeof symbolInfo === 'string' ? symbolInfo : symbolInfo.symbol;
        const res = await axios.get(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${sym}&interval=${intervalMinutes}&limit=${limit}`);
        // Bybit returns newest first, we reverse to oldest first
        return res.data.result.list.map(k => ({
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5]),
            closeTime: parseInt(k[0])
        })).reverse();
    } else { // Asset (Yahoo)
        let yInt = '1h';
        let yDays = 30; // 30 days history is usually limit for 1h
        if (intervalMinutes === 240) { yInt = '1d'; yDays = 120; }
        if (intervalMinutes === 1440) { yInt = '1d'; yDays = 400; } // 200 mum = en az 300 gün
        const queryOptions = { period1: new Date(Date.now() - yDays * 24 * 60 * 60 * 1000), interval: yInt };
        const result = await yahooFinance.chart(symbolInfo.fetchId, queryOptions);
        let quotes = result.quotes.filter(q => q.open !== null && q.close !== null);
        if (quotes.length > limit) quotes = quotes.slice(-limit);
        // Yahoo returns oldest first natively
        return quotes.map(q => ({
            open: q.open,
            high: q.high,
            low: q.low,
            close: q.close,
            volume: q.volume || 0,
            closeTime: new Date(q.date).getTime()
        }));
    }
}

let telegramBot = null;
if (process.env.TELEGRAM_BOT_TOKEN) {
    telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
}

let globalMarketState = {
    btcTrend: 'NEUTRAL',
    btc1h: 'NEUTRAL',
    btc4h: 'NEUTRAL',
    btc1d: 'NEUTRAL',
    ethTrend: 'NEUTRAL',
    btcDomTrend: 'NEUTRAL',
    dxyTrend: 'NEUTRAL',
    timestamp: 0
};

const CONFIG = {
    minRR: 1.0,           // 1.0-2.0 arası
    obLookback: 30,       // 14-50 arası  
    minScore: 40,         // 30-70 arası
    fvgRequired: false,   // true/false
    sma50Filter: 'soft',  // 'hard'/'soft'
    adxThreshold: 25,     // 15-35 arası
    maxActiveTrades: 10,  // Aynı anda maksimum açık BOT işlemi
    priceTolerancePct: 0.3, // İşleme girmek için tolerans %
    isMacroNewsDay: false // FOMC, NFP gibi ekstrem günlerde EURUSD filtresi
};

// --- GLOBAL MARKET SENSOR START ---
async function fetchBinanceKlines(symbol, interval) {
    try {
        const res = await axios.get(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=100`);
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

async function fetchBybitKlinesGlobal(symbol, interval) {
    try {
        const res = await axios.get(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=100`);
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

async function analyzeGlobalMarket() {
    try {
        console.log('[GLOBAL SENSOR] Fetching macro market data...');
        const [btc1h, btc4h, btc1d, eth4h, dom4h, dxy4h] = await Promise.all([
            fetchBybitKlinesGlobal('BTCUSDT', '60'),
            fetchBybitKlinesGlobal('BTCUSDT', '240'),
            fetchBybitKlinesGlobal('BTCUSDT', 'D'),
            fetchBybitKlinesGlobal('ETHUSDT', '240'),
            fetchBinanceKlines('BTCDOMUSDT', '4h'),
            fetchCandles({isAsset: true, fetchId: 'DX-Y.NYB'}, 240, 100)
        ]);
        
        const btc1hTrend = calculateTrendFromKlines(btc1h);
        const btc4hTrend = calculateTrendFromKlines(btc4h);
        const btc1dTrend = calculateTrendFromKlines(btc1d);
        
        let finalBtc = btc4hTrend;
        if ((btc4hTrend === 'BULL' || btc4hTrend === 'STRONG_BULL') && (btc1dTrend === 'BULL' || btc1dTrend === 'STRONG_BULL')) {
             finalBtc = 'STRONG_BULL'; 
        } else if ((btc4hTrend === 'BEAR' || btc4hTrend === 'STRONG_BEAR') && (btc1dTrend === 'BEAR' || btc1dTrend === 'STRONG_BEAR')) {
             finalBtc = 'STRONG_BEAR';
        }

        globalMarketState = {
            btcTrend: finalBtc,
            btc1h: btc1hTrend,
            btc4h: btc4hTrend,
            btc1d: btc1dTrend,
            ethTrend: calculateTrendFromKlines(eth4h),
            btcDomTrend: calculateTrendFromKlines(dom4h),
            dxyTrend: calculateTrendFromKlines(dxy4h),
            timestamp: Date.now()
        };
        console.log(`[GLOBAL SENSOR] BTC: ${globalMarketState.btcTrend} | DXY: ${globalMarketState.dxyTrend} | ETH: ${globalMarketState.ethTrend}`);
    } catch(e) {
        console.error('[GLOBAL SENSOR] Error:', e.message);
    }
}
// --- GLOBAL MARKET SENSOR END ---

async function getUsdtPairs() {
    try {
        const response = await axios.get('https://api.bybit.com/v5/market/instruments-info?category=linear');
        const symbols = response.data.result.list;
        const stableCoins = ['USDCUSDT'];

        const usdtPairs = symbols.filter(s => 
            s.quoteCoin === 'USDT' && 
            s.status === 'Trading' && 
            !stableCoins.includes(s.symbol)
        );
        return usdtPairs.map(s => s.symbol);
    } catch (error) {
        console.error('Bybit ExchangeInfo Error:', error.message);
        return [];
    }
}

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Aktif sinyalleri kontrol et, duruma göre Win veya Loss yap
async function checkActiveSignals() {
    try {
        const activeSignals = await db.all("SELECT * FROM signals WHERE status = 'ACTIVE'");
        if(!activeSignals || activeSignals.length === 0) return;

        console.log(`[SCANNER] Checking ${activeSignals.length} active signals...`);

        // Batch fetch all prices at once (Bybit API)
        const res = await axios.get('https://api.bybit.com/v5/market/tickers?category=linear');
        const priceMap = {};
        res.data.result.list.forEach(t => priceMap[t.symbol] = parseFloat(t.lastPrice));

        // --- AUTO TRADING CHECK START ---
        if (process.env.BYBIT_API_KEY) {
            try {
                // Sadece veritabanında tablomuz varsa çalışır (database.js db error atmaması için tablonun olduğunu varsayıyoruz)
                const activeTrades = await db.all("SELECT * FROM user_trades WHERE status = 'ACTIVE'");
                for (const trade of activeTrades) {
                    try {
                        const position = await getPosition(trade.symbol);
                        if (!position || parseFloat(position.size) === 0) {
                            // Pozisyon Borsada Kapanmış (TP/SL)
                            console.log(`[AUTO-TRADE-CHECK] Pozisyon Borsada Kapalı Tespit Edildi: ${trade.symbol}`);
                            const currentP = priceMap[trade.symbol];
                            if(currentP) {
                                let pnl = 0;
                                if (trade.type === 'LONG') pnl = ((currentP - trade.entryPrice) / trade.entryPrice) * 100 * 10;
                                else pnl = ((trade.entryPrice - currentP) / trade.entryPrice) * 100 * 10;

                                let reason = pnl > 0 ? 'NATIVE_TP' : 'NATIVE_SL';
                                await db.run(
                                    "UPDATE user_trades SET status = 'CLOSED', pnl = ?, closeReason = ?, closedAt = CURRENT_TIMESTAMP WHERE id = ?",
                                    [pnl, reason, trade.id]
                                );
                                
                                // Orijinal Global sinyal duruyor olabilir. Ancak Kullanıcı Şahsi Favorilerinde "Aktif" olanları göstermeyeceğimizden listeden düşecektir.
                            }
                        }
                    } catch(e) {}
                }
            } catch(e) {}
        }
        // --- AUTO TRADING CHECK END ---

        for (const signal of activeSignals) {
            try {
                 const currentPrice = priceMap[signal.symbol];
                 if (!currentPrice) continue;
                 
                 let newStatus = null;
                 let pnl = 0;
                 
                 if (signal.type === 'LONG') {
                     pnl = ((currentPrice - signal.entryPrice) / signal.entryPrice) * 100;
                     if (currentPrice >= signal.targetPrice) newStatus = 'WIN';
                     else if (currentPrice <= signal.stopPrice) newStatus = 'LOSS';
                 } else if (signal.type === 'SHORT') {
                     pnl = ((signal.entryPrice - currentPrice) / signal.entryPrice) * 100;
                     if (currentPrice <= signal.targetPrice) newStatus = 'WIN';
                     else if (currentPrice >= signal.stopPrice) newStatus = 'LOSS';
                 }
                 
                 // %2 kâr barajı kontrolü
                 if (pnl >= 2.0 && !signal.reachedTwoPercent) {
                     await db.run("UPDATE signals SET reachedTwoPercent = 1 WHERE id = ?", [signal.id]);
                 }

                 if (newStatus) {
                     await db.run("UPDATE signals SET status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?", [newStatus, signal.id]);
                     console.log(`[SCANNER] Signal ${signal.symbol} closed as ${newStatus}`);
                     
                     // Google Sheets'te Güncelle
                     try {
                         const googleApi = require('./google-api');
                         if (googleApi.updateSheetSignalStatus) {
                             await googleApi.updateSheetSignalStatus(signal.id, newStatus);
                         }
                     } catch (err) {
                         console.error("[SHEETS] Tablodaki durum güncellenemedi:", err);
                     }
                 }
            } catch(e) {
                // Ignore single coin error
            }
        }
    } catch (e) {
        console.error("Error checking active signals:", e);
    }

    // Pozisyonlar kapanmış olabilir, boşalan yerleri doldur
    await backfillTrades();
}

async function backfillTrades() {
    if (!process.env.BYBIT_API_KEY || !process.env.PERISKOP_TELEGRAM_ID) return;

    try {
        const activeCountRes = await db.get("SELECT COUNT(*) as count FROM user_trades WHERE status = 'ACTIVE'");
        const activeCount = activeCountRes ? activeCountRes.count : 0;
        
        if (activeCount >= CONFIG.maxActiveTrades) return;
        
        let slotsAvailable = CONFIG.maxActiveTrades - activeCount;

        // Havuz: Henüz BOT'ta açık işlemi olmayan Sinyalleri çek (Sıralama: Kalite Skoru yüksek olan önce)
        const candidateSignals = await db.all(`
            SELECT s.* 
            FROM signals s
            LEFT JOIN user_trades ut ON s.id = ut.signalId
            WHERE s.status = 'ACTIVE' AND ut.id IS NULL
            ORDER BY s.qualityScore DESC, s.createdAt DESC
        `);

        if(candidateSignals.length === 0) return;

        console.log(`[BACKFILL] Bos slot: ${slotsAvailable}. Bekleyen ${candidateSignals.length} adet havuz sinyali degerlendiriliyor...`);

        // Bybit fiyatları
        const res = await axios.get('https://api.bybit.com/v5/market/tickers?category=linear');
        const priceMap = {};
        res.data.result.list.forEach(t => priceMap[t.symbol] = parseFloat(t.lastPrice));

        for (const signal of candidateSignals) {
            if (slotsAvailable <= 0) break;

            const currentPrice = priceMap[signal.symbol];
            if (!currentPrice) continue;

            const diffPct = Math.abs((currentPrice - signal.entryPrice) / signal.entryPrice) * 100;
            if (diffPct <= CONFIG.priceTolerancePct) {
                // Şart sağlandı: Limiti yemedik, fiyat da çok kaçmamış
                console.log(`[BACKFILL] Uygun fiyat bulundu! Emir Gönderiliyor: ${signal.symbol} (Score: ${signal.qualityScore})`);
                try {
                    const orderId = await placeOrder(signal.symbol, signal.type, currentPrice, signal.targetPrice, signal.stopPrice);
                    if (orderId) {
                        await db.run(
                            "INSERT INTO user_trades (telegramId, signalId, symbol, type, entryPrice, targetPrice, stopPrice, status, bybitOrderId) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)",
                            [process.env.PERISKOP_TELEGRAM_ID, signal.id, signal.symbol, signal.type, currentPrice, signal.targetPrice, signal.stopPrice, orderId]
                        );
                        
                        const checkFav = await db.get("SELECT id FROM favorites WHERE telegramId = ? AND signalId = ?", [process.env.PERISKOP_TELEGRAM_ID, signal.id]);
                        if(!checkFav) {
                            await db.run("INSERT INTO favorites (telegramId, signalId) VALUES (?, ?)", [process.env.PERISKOP_TELEGRAM_ID, signal.id]);
                        }
                        slotsAvailable--;
                    }
                } catch(e) {
                     console.error(`[BACKFILL] Hata:`, e.message);
                }
            } else {
                 const dir = currentPrice > signal.entryPrice ? 'Yukarı' : 'Aşağı';
                 console.log(`[BACKFILL] Atlanıyor: ${signal.symbol} (Fiyat %${diffPct.toFixed(2)} ${dir} kaçmış. Tolerans: %${CONFIG.priceTolerancePct})`);
            }
        }
    } catch(e) {
        console.error("Backfill Error:", e);
    }
}

async function analyzeCoin(symbolInfo) {
    try {
        const sym = typeof symbolInfo === 'string' ? symbolInfo : symbolInfo.symbol;
        const klines = await fetchCandles(symbolInfo, 60, 100);
        if(!klines || klines.length < 100) return null; 

        const opens = klines.map(k => k.open);
        const highs = klines.map(k => k.high);
        const lows = klines.map(k => k.low);
        const closes = klines.map(k => k.close);
        const volumes = klines.map(k => k.volume);
        
        const currentPrice = closes[closes.length - 1];
        const rangeHigh = Math.max(...highs);
        const rangeLow = Math.min(...lows);
        const eq = (rangeHigh + rangeLow) / 2;

        const atrRes = ATR.calculate({high: highs, low: lows, close: closes, period: 14});
        const currentATR = atrRes[atrRes.length - 1] || (currentPrice * 0.015);
        
        let avgATR = currentATR;
        if (atrRes.length >= 14) {
             const last14 = atrRes.slice(-14);
             avgATR = last14.reduce((acc, val) => acc + val, 0) / 14;
        }

        // TEMEL HESAPLAMALAR
        const recentLows = lows.slice(-6);
        const recentHighs = highs.slice(-6);
        let recentMin = Math.min(...recentLows);
        let recentMax = Math.max(...recentHighs);
        let dipDeviation = false;
        let tepeDeviation = false;

        // MATEMATİKSEL LİKİDİTE KONTROLÜ (SWEEP & RECLAIM ZORUNLU TABAN KURAL)
        let sweepIdxLong = -1;
        if (recentMin <= rangeLow * 1.005 && currentPrice > rangeLow) {
            let sweepIdx = lows.lastIndexOf(recentMin);
            if (sweepIdx !== -1) {
                let wick = Math.min(opens[sweepIdx], closes[sweepIdx]) - lows[sweepIdx];
                if (wick >= currentATR * 0.8 && currentPrice > (lows[sweepIdx] + wick * 0.5)) {
                    if (currentPrice > highs[sweepIdx]) { // CHOCH
                        dipDeviation = true;
                        sweepIdxLong = sweepIdx;
                    }
                }
            }
        }

        let sweepIdxShort = -1;
        if (recentMax >= rangeHigh * 0.995 && currentPrice < rangeHigh) {
            let sweepIdx = highs.lastIndexOf(recentMax);
            if (sweepIdx !== -1) {
                let upperWick = highs[sweepIdx] - Math.max(opens[sweepIdx], closes[sweepIdx]);
                if (upperWick >= currentATR * 0.8 && currentPrice < (highs[sweepIdx] - upperWick * 0.5)) {
                    if (currentPrice < lows[sweepIdx]) {
                        tepeDeviation = true;
                        sweepIdxShort = sweepIdx;
                    }
                }
            }
        }

        // SWEEP YOKSA IŞLEM YOK
        if (!dipDeviation && !tepeDeviation) return null;

        const direction = dipDeviation ? 'LONG' : 'SHORT';

        // --- GLOBAL MARKET CONTEXT FILTER ---
        if (!symbolInfo.isAsset) { // Varlıklar BTC trendinden etkilenmez!
            if (direction === 'SHORT' && (globalMarketState.btcTrend === 'STRONG_BULL' || globalMarketState.btcTrend === 'BULL')) {
                 return null; // Akıntıya Karşı İşlem Açma! (Boğada Short Reddi)
            }
            if (direction === 'LONG' && (globalMarketState.btcTrend === 'STRONG_BEAR' || globalMarketState.btcTrend === 'BEAR')) {
                 return null; // Ayıda Long Reddi
            }
        } else {
            // EURUSD Günlük SMA 200 Filtresi
            if (sym === 'EURUSD') {
                if (CONFIG.isMacroNewsDay) {
                     qualityScore -= 20;
                     warnings.push('Macro News Penalty (-20)');
                }
                const eu1d = await fetchCandles(symbolInfo, 1440, 205);
                if (eu1d && eu1d.length >= 200) {
                     const sma200 = SMA.calculate({period: 200, values: eu1d.map(x => x.close)});
                     const curSma = sma200[sma200.length - 1];
                     if (direction === 'LONG' && currentPrice < curSma) return null; // 200DMA altında Long yasak
                     if (direction === 'SHORT' && currentPrice > curSma) return null; // 200DMA üstünde Short yasak
                }
            }
            
            // Emtia - DXY Ters Korelasyon Filtresi
            if (sym === 'XAUUSD' || sym === 'USOIL') {
                 // Dolar güçleniyorsa (BULL), Altın ve Petrol LONG alınmaz. Dolar düşüyorsa (BEAR) SHORT alınmaz.
                 if (direction === 'LONG' && (globalMarketState.dxyTrend === 'STRONG_BULL' || globalMarketState.dxyTrend === 'BULL')) return null;
                 if (direction === 'SHORT' && (globalMarketState.dxyTrend === 'STRONG_BEAR' || globalMarketState.dxyTrend === 'BEAR')) return null;
            }
        }

        // 1. ETH Trend (Total Altcoin Piyasası Proxy) Filtresi:
        if (sym !== 'BTCUSDT' && (!symbolInfo.isAsset)) {
            if (direction === 'SHORT' && (globalMarketState.ethTrend === 'STRONG_BULL' || globalMarketState.ethTrend === 'BULL')) {

                 return null; // Altcoinler yükselirken short arama
            }
            if (direction === 'LONG' && (globalMarketState.ethTrend === 'STRONG_BEAR' || globalMarketState.ethTrend === 'BEAR')) {
                 return null; // Altcoinler kan ağlarken long arama
            }
        }

        // --- SKORLAMA (SCORING) ALTYAPISI ---
        let qualityScore = 0;
        let warnings = [];
        let breakdown = { ob: false, fvg: false, rvol: 0, adx: 0, rr: 0, trend4h: "neutral" };

        // 2. BTC Dominans (BTCDOM) Makro Etkisi
        // Dominansın yönü özellikle LONG (Altcoin alımı) işlemlerini etkiler
        if (direction === 'LONG' && (!symbolInfo.isAsset)) {
             if (globalMarketState.btcDomTrend === 'STRONG_BULL' || globalMarketState.btcDomTrend === 'BULL') {
                 if (sym === 'BTCUSDT') {
                     qualityScore += 15; // Para BTC'ye akıyor, BTC LONG ödüllendirilir.
                 } else {
                     qualityScore -= 15; // Likidite BTC'ye geçiyor, ceza.
                     warnings.push('High BTC.D Penalty (-15)');
                 }
             } else if (globalMarketState.btcDomTrend === 'STRONG_BEAR' || globalMarketState.btcDomTrend === 'BEAR') {
                 if (sym === 'BTCUSDT') {
                     qualityScore -= 15; // Para altcoinlere kayıyor, BTC zayıflar.
                     warnings.push('Low BTC.D Penalty for BTC (-15)');
                 } else {
                     qualityScore += 15; // Altsezon döngüsü, ödül.
                 }
             }
        }

        // 3. Volatilite (ATR) Ani Haber/Fakeout Filtresi
        if (currentATR > avgATR * 2.0) {
            qualityScore -= 15;
            warnings.push('High Volatility (ATR Spike -15)');
        }

        // 4. RSI (1H) Tükenmişlik (Over-extension) Filtresi
        const rsiRes = require('technicalindicators').RSI.calculate({period: 14, values: closes});
        const currentRSI = rsiRes.length > 0 ? rsiRes[rsiRes.length - 1] : 50;
        
        if (direction === 'LONG' && currentRSI > 75) {
            qualityScore -= 10;
            warnings.push('RSI Overbought for LONG (-10)');
        } else if (direction === 'SHORT' && currentRSI < 25) {
            qualityScore -= 10;
            warnings.push('RSI Oversold for SHORT (-10)');
        }

        // 5. RSI Hidden Divergence (Gizli Uyumsuzluk) Bonusu
        const sweepIdx = direction === 'LONG' ? sweepIdxLong : sweepIdxShort;
        let hasHiddenDivergence = false;
        
        const getRSI = (idx) => {
            const rIdx = idx - 14;
            return (rIdx >= 0 && rIdx < rsiRes.length) ? rsiRes[rIdx] : 50;
        };

        if (sweepIdx > 20) {
            const currentSweepPrice = direction === 'LONG' ? lows[sweepIdx] : highs[sweepIdx];
            const currentSweepRSI = getRSI(sweepIdx);
            
            // Son 30 mumdan 5 mum oncesine kadar tarama (Gecmis dalgayi bulma)
            const lookbackStart = Math.max(14, sweepIdx - 30);
            const lookbackEnd = sweepIdx - 5;
            
            if (direction === 'LONG') {
                let prevLowest = Infinity;
                let prevLowestRSI = 50;
                let foundBase = false;
                
                for (let k = lookbackStart; k <= lookbackEnd; k++) {
                    if (lows[k] < prevLowest) {
                        prevLowest = lows[k];
                        prevLowestRSI = getRSI(k);
                        foundBase = true;
                    }
                }
                // Gizli Boğa: Fiyat Higher Low, RSI Lower Low yapiyorsa
                if (foundBase && currentSweepPrice > prevLowest && currentSweepRSI < prevLowestRSI) {
                    hasHiddenDivergence = true;
                }
            } else {
                let prevHighest = -Infinity;
                let prevHighestRSI = 50;
                let foundBase = false;
                
                for (let k = lookbackStart; k <= lookbackEnd; k++) {
                    if (highs[k] > prevHighest) {
                        prevHighest = highs[k];
                        prevHighestRSI = getRSI(k);
                        foundBase = true;
                    }
                }
                // Gizli A: Fiyat Lower High, RSI Higher High yapiyorsa
                if (foundBase && currentSweepPrice < prevHighest && currentSweepRSI > prevHighestRSI) {
                    hasHiddenDivergence = true;
                }
            }
        }
        
        if (hasHiddenDivergence) {
            qualityScore += 5;
            warnings.push('Hidden Divergence (+5)');
        }

        // 1. ORDER BLOCK (OB) - SADELEŞTİRİLMİŞ 20 MUM KONTROLÜ
        const obZone = direction === 'LONG' ? [rangeLow - (currentATR * 1.5), rangeLow + (currentATR * 1.5)] : [rangeHigh - (currentATR * 1.5), rangeHigh + (currentATR * 1.5)];
        const obCandlesStart = closes.length - CONFIG.obLookback - 6; // exclude the sweep recent 6
        let hasOB = false;
        for (let i = obCandlesStart; i <= closes.length - 6; i++) {
            if (i < 0) continue;
            if (direction === 'LONG' && closes[i] < opens[i] && closes[i] <= obZone[1] && closes[i] >= obZone[0]) {
                if (highs[i+1] > highs[i]) { hasOB = true; break; }
            } else if (direction === 'SHORT' && closes[i] > opens[i] && closes[i] >= obZone[0] && closes[i] <= obZone[1]) {
                if (lows[i+1] < lows[i]) { hasOB = true; break; }
            }
        }
        if (hasOB) {
            qualityScore += 25;
            breakdown.ob = true;
        }

        // 2. FVG (FAIR VALUE GAP) - OPSİYONEL
        let hasFVG = false;
        const lastIdx = closes.length - 1;
        for (let i = lastIdx - 2; i <= lastIdx; i++) {
            if (i >= 2) {
                if (direction === 'LONG' && highs[i-2] < lows[i]) hasFVG = true; 
                if (direction === 'SHORT' && lows[i-2] > highs[i]) hasFVG = true; 
            }
        }
        if (hasFVG) {
            qualityScore += 15;
            breakdown.fvg = true;
        } else if (CONFIG.fvgRequired) {
            return null; // Eğer mutlaka FVG istersen
        }

        // 3. HACİM (RVOL)
        const vol20 = volumes.slice(-21, -1); 
        const avgVol = vol20.reduce((a, b) => a + b, 0) / 20;
        const recentVol = Math.max(...volumes.slice(-3));
        const rvolRatio = recentVol / (avgVol || 1);
        breakdown.rvol = parseFloat(rvolRatio.toFixed(2));
        if (rvolRatio >= 1.2) {
            qualityScore += 15;
        }

        // 4. ADX REJİMİ
        const adxResult = ADX.calculate({high: highs, low: lows, close: closes, period: 14});
        const currentADX = adxResult.length > 0 ? adxResult[adxResult.length - 1].adx : 0;
        breakdown.adx = Math.round(currentADX);
        if (currentADX < CONFIG.adxThreshold) { // Range
            qualityScore += 15;
        }

        // 4.5 VWAP KONTROLÜ (SADECE HİSSELER)
        if (sym === 'AAPL' || sym === 'TSLA' || sym === 'NASDAQ') {
            const vPeriod = 20;
            if (closes.length >= vPeriod) {
                let sumPv = 0;
                let sumV = 0;
                for (let i = closes.length - vPeriod; i < closes.length; i++) {
                    const typPrice = (highs[i] + lows[i] + closes[i]) / 3;
                    sumPv += typPrice * volumes[i];
                    sumV += volumes[i];
                }
                const vwap = sumPv / (sumV || 1);
                if (direction === 'LONG' && currentPrice > vwap) { qualityScore += 8; warnings.push('VWAP Uyum (+8)'); }
                else if (direction === 'SHORT' && currentPrice < vwap) { qualityScore += 8; warnings.push('VWAP Uyum (+8)'); }
            }
        }

        // 5. 4H MTF TREND UYUMU
        let trend4h = "neutral";
        try {
            // Fetch 4H proxy or true 4H
            const klines4h = await fetchCandles(symbolInfo, 240, 50);
            const closes4h = klines4h.map(k => k.close);
            const sma4h = SMA.calculate({values: closes4h, period: 50});
            const currentPrice4H = closes4h[closes4h.length - 1];
            const sma50_4H = sma4h[sma4h.length - 1];
            
            if (currentPrice4H > sma50_4H) trend4h = "bullish";
            else if (currentPrice4H < sma50_4H) trend4h = "bearish";
            breakdown.trend4h = trend4h;

            if (direction === 'LONG') {
                if (trend4h === 'bullish') {
                    qualityScore += 15;
                } else {
                    warnings.push('Counter-trend 4H');
                    qualityScore -= 5;
                    if (CONFIG.sma50Filter === 'hard') return null;
                }
            } else if (direction === 'SHORT') {
                if (trend4h === 'bearish') {
                    qualityScore += 15;
                } else {
                    warnings.push('Counter-trend 4H');
                    qualityScore -= 5;
                    if (CONFIG.sma50Filter === 'hard') return null;
                }
            }
        } catch(e) {}

        // 5.5 BAYRAK/FLAMA (FLAG/PENNANT) FORMASYONU
        let poleSize = 0;
        let hasFlagPennant = false;
        const scanIdx = closes.length - 1;

        if (scanIdx >= 10) {
            for (let fLen = 3; fLen <= 7; fLen++) {
                const poleEndIdx = scanIdx - fLen;
                const poleStartIdx = Math.max(0, poleEndIdx - 5);
                
                if (poleEndIdx <= poleStartIdx) continue;
                
                const movePct = (closes[poleEndIdx] - opens[poleStartIdx]) / opens[poleStartIdx];
                
                if (direction === 'LONG' && movePct >= 0.05) {
                    poleSize = closes[poleEndIdx] - opens[poleStartIdx];
                    let flagLowest = Math.min(...lows.slice(poleEndIdx + 1, scanIdx + 1));
                    const flagRetracement = (closes[poleEndIdx] - flagLowest) / poleSize;
                    
                    if (flagRetracement > 0 && flagRetracement < 0.6) {
                        hasFlagPennant = true;
                        break;
                    }
                } else if (direction === 'SHORT' && movePct <= -0.05) {
                    poleSize = opens[poleStartIdx] - closes[poleEndIdx];
                    let flagHighest = Math.max(...highs.slice(poleEndIdx + 1, scanIdx + 1));
                    const flagRetracement = (flagHighest - closes[poleEndIdx]) / poleSize;
                    
                    if (flagRetracement > 0 && flagRetracement < 0.6) {
                        hasFlagPennant = true;
                        break;
                    }
                }
            }
        }

        if (hasFlagPennant) {
            qualityScore += 10;
            breakdown.flagPattern = true;
            warnings.push('Flag/Pennant (+10)');
            if (breakdown.rvol >= 1.2) {
                qualityScore += 5; // Ekstra RVOL uyum bonusu
                warnings.push('Flag RVOL Bonus (+5)');
            }
        }

        // --- YENİ İNDİKATÖR PAKETİ (WIN RATE BOOST +48) ---
        // 1. KAMA (Kaufman Adaptive Moving Average) (+5 Puan)
        const kama = calculateKAMA(closes, 10, 2, 30);
        if (kama && kama[kama.length - 1] !== null) {
            const currentKAMA = kama[kama.length - 1];
            if (direction === 'LONG' && currentPrice > currentKAMA) {
                qualityScore += 5; warnings.push('KAMA Support (+5)');
            } else if (direction === 'SHORT' && currentPrice < currentKAMA) {
                qualityScore += 5; warnings.push('KAMA Resistance (+5)');
            }
        }

        // 2. Stochastic RSI (Altın/Ölüm Kesişimi ±10)
        const stochRSIRes = StochasticRSI.calculate({ values: closes, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 });
        if (stochRSIRes && stochRSIRes.length > 1) {
            const lastStoch = stochRSIRes[stochRSIRes.length - 1];
            const prevStoch = stochRSIRes[stochRSIRes.length - 2];
            
            if (direction === 'LONG' && prevStoch.k <= prevStoch.d && lastStoch.k > lastStoch.d && lastStoch.k >= 20) {
                qualityScore += 10; warnings.push('StochRSI Altın Kesişim (+10)');
            } else if (direction === 'SHORT' && prevStoch.k >= prevStoch.d && lastStoch.k < lastStoch.d && lastStoch.k <= 80) {
                qualityScore += 10; warnings.push('StochRSI Ölüm Kesişimi (+10)');
            }
        }

        // 3. Ichimoku Cloud (Bulut Onayı ve Testere)
        const ichiRes = IchimokuCloud.calculate({ high: highs, low: lows, conversionPeriod: 9, basePeriod: 26, spanPeriod: 52, displacement: 26 });
        if (ichiRes && ichiRes.length > 0) {
            const currentIchi = ichiRes[ichiRes.length - 1];
            const maxSpan = Math.max(currentIchi.spanA, currentIchi.spanB);
            const minSpan = Math.min(currentIchi.spanA, currentIchi.spanB);
            
            if (currentPrice < maxSpan && currentPrice > minSpan) {
                warnings.push('Kumo Bulutu İçi (Testere Piyasası)');
            } else {
                if (direction === 'LONG') {
                    if (currentPrice > maxSpan && currentIchi.conversion > currentIchi.base) {
                        qualityScore += 15; warnings.push('Ichimoku Bull Trend (+15)');
                    }
                } else if (direction === 'SHORT') {
                    if (currentPrice < minSpan && currentIchi.conversion < currentIchi.base) {
                        qualityScore += 15; warnings.push('Ichimoku Bear Trend (+15)');
                    }
                }
            }
        }

        // 4. Order Flow Delta (Hacim Dağılımı Yaklaşımı ±15 Puan)
        const currentOpen = opens[opens.length - 1];
        const currentHigh = highs[highs.length - 1];
        const currentLow = lows[lows.length - 1];
        const currentClose = closes[closes.length - 1];
        const currentVol = volumes[volumes.length - 1];
        if (currentHigh > currentLow && currentVol > 0) {
            const buyVol = currentVol * ((currentClose - currentLow) / (currentHigh - currentLow));
            const sellVol = currentVol * ((currentHigh - currentClose) / (currentHigh - currentLow));
            const buyRatio = buyVol / (currentVol || 1);
            const sellRatio = sellVol / (currentVol || 1);

            if (direction === 'LONG') {
                if (buyRatio > 0.60) {
                    qualityScore += 15; warnings.push('Order Flow Aggressive Bull (+15)');
                } else if (sellRatio > 0.60) {
                    qualityScore -= 15; warnings.push('Order Flow Aggressive Bear Res (-15)');
                }
            } else if (direction === 'SHORT') {
                if (sellRatio > 0.60) {
                    qualityScore += 15; warnings.push('Order Flow Aggressive Bear (+15)');
                } else if (buyRatio > 0.60) {
                    qualityScore -= 15; warnings.push('Order Flow Aggressive Bull Sup (-15)');
                }
            }
        }

        // 5. Günlük MA Golden Cross (+10 Puan) (Sadece kalite skoru yüksek olanlara API tasarrufu için sorulur)
        if (qualityScore >= 25) {
            try {
                const dailyKlines = await fetchCandles(symbolInfo, 1440, 200);
                if (dailyKlines && dailyKlines.length >= 200) {
                    const dailyCloses = dailyKlines.map(k => k.close);
                    const sma50_1dArr = SMA.calculate({period: 50, values: dailyCloses});
                    const sma200_1dArr = SMA.calculate({period: 200, values: dailyCloses});
                    
                    if (sma50_1dArr.length > 0 && sma200_1dArr.length > 0) {
                        const sma50_1d = sma50_1dArr[sma50_1dArr.length - 1];
                        const sma200_1d = sma200_1dArr[sma200_1dArr.length - 1];
                        const dPrice = dailyCloses[dailyCloses.length - 1];
                        
                        if (direction === 'LONG') {
                            if (sma50_1d > sma200_1d && dPrice > sma200_1d) {
                                qualityScore += 10; warnings.push('1D Golden Cross (+10)');
                            } else if (sma50_1d < sma200_1d) {
                                qualityScore -= 10; warnings.push('1D Death Cross (-10)');
                            }
                        } else if (direction === 'SHORT') {
                            if (sma50_1d < sma200_1d && dPrice < sma200_1d) {
                                qualityScore += 10; warnings.push('1D Bear Cross (+10)');
                            } else if (sma50_1d > sma200_1d) {
                                qualityScore -= 10; warnings.push('1D Golden Reject (-10)');
                            }
                        }
                    }
                }
            } catch(e) { } // Hata olursa es geç
        }

        // --- YENİ V2.6: PORTFOLIO CORRELATION FILTER (-12 Puan Cezası) ---
        try {
            const activeTrades = await db.all("SELECT symbol, type FROM user_trades WHERE status = 'ACTIVE'");
            const cryptoMajors = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];
            
            if (cryptoMajors.includes(sym)) {
                let sameGrpCount = activeTrades.filter(t => cryptoMajors.includes(t.symbol) && t.type === direction).length;
                if (sameGrpCount >= 2) {
                    qualityScore -= 12;
                    warnings.push(`Diversity Penalty (Too many active ${direction} in Majors) (-12)`);
                }
            }
        } catch(e) { }

        // 6. RISK / REWARD (R:R) HESAPLAMASI & 1:3 CAP
        let targetP = eq;
        let dynamicStop = 0;
        let risk = 0, reward = 0;
        let slMultiplier = (sym === 'XAUUSD' || sym === 'XAGUSD' || sym === 'USOIL') ? 2.5 : 1.5;

        // Gap Fill Analysis for Stocks & Commodities
        let hasGap = false;
        let gapTarget = 0;
        if (sym === 'AAPL' || sym === 'TSLA' || sym === 'NASDAQ' || sym === 'XAUUSD' || sym === 'XAGUSD' || sym === 'USOIL') {
            for (let g = 1; g < 15; g++) {
               const gapSize = opens[closes.length - g] - closes[closes.length - g - 1];
               if (direction === 'LONG' && gapSize < -(currentPrice * 0.005)) { // Gap down
                    hasGap = true; gapTarget = closes[closes.length - g - 1]; break;
               } else if (direction === 'SHORT' && gapSize > (currentPrice * 0.005)) { // Gap up
                    hasGap = true; gapTarget = closes[closes.length - g - 1]; break;
               }
            }
            
            // DXY Gap Confluence Bonus (Sadece Emtialar için)
            if (hasGap && (sym === 'XAUUSD' || sym === 'USOIL' || sym === 'XAGUSD')) {
                if (direction === 'LONG' && globalMarketState.dxyTrend === 'BEAR') { qualityScore += 5; warnings.push('Gap+DXY Bonus (+5)'); }
                else if (direction === 'SHORT' && globalMarketState.dxyTrend === 'BULL') { qualityScore += 5; warnings.push('Gap+DXY Bonus (+5)'); }
            }
        }
        
        if (direction === 'LONG') {
            dynamicStop = currentPrice - (currentATR * slMultiplier);
            risk = currentPrice - dynamicStop;
            
            // Hedef: Bayrak varsa Kırılım + Direk Boyu, yoksa EQ Likidite Noktası
            targetP = hasFlagPennant ? (currentPrice + poleSize) : eq;
            
            // Hisselerde Gap Fill Hedefi
            if (hasGap && gapTarget > currentPrice) {
                targetP = gapTarget;
                warnings.push('Gap Fill TP Target Set');
            }
            
            // FVG varsa hedefi daraltma
            if (hasFVG && targetP > currentPrice + (currentPrice * 0.02)) {
                 targetP = currentPrice + (currentPrice * 0.02); // Minimum FVG safe zone
            }
            
            reward = targetP - currentPrice;

            // 1:3 R:R Cap Uyumlu Kesinti (Tıraşlama)
            let maxReward = risk * 3.0; // Max 3x SL Limits
            if (reward > maxReward) {
                reward = maxReward;
                targetP = currentPrice + reward;
                warnings.push('TP Capped (1:3 Max)');
            }
        } else {
            dynamicStop = currentPrice + (currentATR * slMultiplier);
            risk = dynamicStop - currentPrice;
            
            targetP = hasFlagPennant ? (currentPrice - poleSize) : eq;
            
            if (hasGap && gapTarget < currentPrice) {
                targetP = gapTarget;
                warnings.push('Gap Fill TP Target Set');
            }
            
            if (hasFVG && targetP < currentPrice - (currentPrice * 0.02)) {
                 targetP = currentPrice - (currentPrice * 0.02);
            }
            
            reward = currentPrice - targetP;

            // 1:3 R:R Cap
            let maxReward = risk * 3.0;
            if (reward > maxReward) {
                reward = maxReward;
                targetP = currentPrice - reward;
                warnings.push('TP Capped (1:3 Max)');
            }
        }
        
        // Elliot filter output parsing mapping
        const ewResult = analyzeElliottWaves(klines, symbol);
        
        let rr = risk > 0 ? (reward / risk) : 0;
        breakdown.rr = parseFloat(rr.toFixed(2));

        if (rr >= 2.0) {
            qualityScore += 25; // Base 15 + R:R Bonus 10
            warnings.push('High R:R Bonus (+10)');
        }
        else if (rr >= 1.2) qualityScore += 5;
        
        if (rr < CONFIG.minRR) return null; // Sert RR süzgeci (örneğin 1.2 altı ise kesin çöpe)
        if (rr >= 1.0 && rr < 1.5) warnings.push(`Low RR (${breakdown.rr})`);

        // SONUÇ: TETİKLENME (TRIGGER)
        if (qualityScore < CONFIG.minScore) {
            // Puan barajını geçemedi (Sessiz reddet)
            return null;
        }

        // Log the detailed summary to console exactly as requested for Backtesting
        console.log(JSON.stringify({
            symbol,
            direction,
            qualityScore,
            breakdown,
            warnings
        }, null, 2));

        return {
            symbol: sym,
            type: direction,
            entryPrice: currentPrice,
            targetPrice: targetP,
            stopPrice: dynamicStop,
            qualityScore: qualityScore,
            warnings: JSON.stringify(warnings),
            macroState: globalMarketState,
            isAsset: symbolInfo.isAsset || false
        };
    } catch(e) {
        // console.error(e);
    }
    return null;
}
let isScanning = false;

async function runScan() {
    if (isScanning) {
        console.log('[SCANNER] Tarama zaten devam ediyor, atlanıyor...');
        return;
    }
    isScanning = true;

    try {
        console.log('[SCANNER] Starting Binance pairs scan for new signals...');

    // 2. Yeni pariteleri tara
    const cryptoPairs = await getUsdtPairs();
    const isWeekend = new Date().getDay() === 0 || new Date().getDay() === 6;
    const assetsToScan = isWeekend ? [] : ASSET_SYMBOLS; // Hafta sonu varlıklara istek atma
    
    const allPairs = [...cryptoPairs, ...assetsToScan];
    console.log(`[SCANNER] Found ${cryptoPairs.length} USDT pairs and ${assetsToScan.length} assets to scan.`);

    let signalCount = 0;
    
    for (let i = 0; i < allPairs.length; i++) {
        const symbolInfo = allPairs[i];
        const symbol = typeof symbolInfo === 'string' ? symbolInfo : symbolInfo.symbol;
        
        // Aktif sinyali olan coini tekrar tarayıp yeni sinyal üretmeye gerek yok (Spam önleme)
        const existingActive = await db.get("SELECT id FROM signals WHERE symbol = ? AND status = 'ACTIVE'", [symbol]);
        if (existingActive) continue;

        const signal = await analyzeCoin(symbolInfo);
        if (signal) {
            const insertResult = await db.run(
                "INSERT INTO signals (symbol, type, entryPrice, targetPrice, stopPrice, qualityScore, warnings) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [signal.symbol, signal.type, signal.entryPrice, signal.targetPrice, signal.stopPrice, signal.qualityScore, signal.warnings]
            );
            const signalId = insertResult.id;
            console.log(`[SCANNER] New ${signal.type} signal for ${signal.symbol}! ID: ${signalId}`);
            
            // Google Sheets'e Yaz
            try {
                const dateStr = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
                const tpPercent = signal.type === 'LONG' ? ((signal.targetPrice - signal.entryPrice) / signal.entryPrice) * 100 : ((signal.entryPrice - signal.targetPrice) / signal.entryPrice) * 100;
                const slPercent = signal.type === 'LONG' ? ((signal.entryPrice - signal.stopPrice) / signal.entryPrice) * 100 : ((signal.stopPrice - signal.entryPrice) / signal.entryPrice) * 100;
                
                let macroPrefix = "";
                if (signal.macroState) {
                    macroPrefix = `[BTC: ${signal.macroState.btcTrend}, ETH: ${signal.macroState.ethTrend}] - `;
                }
                const combinedWarnings = macroPrefix + (signal.warnings || "");

                await appendToSheet([
                    dateStr,
                    signal.symbol,
                    signal.qualityScore || 0,
                    signal.type,
                    `%${tpPercent.toFixed(2)}`,
                    `%${slPercent.toFixed(2)}`,
                    'ACTIVE',
                    combinedWarnings,
                    signalId
                ]);
            } catch (err) {
                console.error("[SHEETS] Sinyal tabloya yazılamadı:", err);
            }
            
            // --- AUTO TRADING BLOCK START ---
            if (process.env.BYBIT_API_KEY && process.env.PERISKOP_TELEGRAM_ID) {
                try {
                    const activeCountRes = await db.get("SELECT COUNT(*) as count FROM user_trades WHERE status = 'ACTIVE'");
                    const activeCount = activeCountRes ? activeCountRes.count : 0;
                    
                    if (activeCount >= CONFIG.maxActiveTrades) {
                        console.log(`[AUTO-TRADE] Limit (${CONFIG.maxActiveTrades}) dolu! Sinyal ${signal.symbol} havuza eklendi.`);
                    } else {
                        // Aynı gün içinde aynı coine girildi mi?
                        const todayStr = new Date().toISOString().split('T')[0];
                        const existingTrade = await db.all(
                            "SELECT id FROM user_trades WHERE symbol = ? AND date(createdAt) = ?", 
                            [signal.symbol, todayStr]
                        );

                        if (existingTrade.length === 0) {
                            console.log(`[AUTO-TRADE] Borsaya Emir Gönderiliyor: ${signal.symbol}`);
                            try {
                                const orderId = await placeOrder(signal.symbol, signal.type, signal.entryPrice, signal.targetPrice, signal.stopPrice);
                                if (orderId) {
                                    await db.run(
                                        "INSERT INTO user_trades (telegramId, signalId, symbol, type, entryPrice, targetPrice, stopPrice, status, bybitOrderId) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)",
                                        [process.env.PERISKOP_TELEGRAM_ID, signalId, signal.symbol, signal.type, signal.entryPrice, signal.targetPrice, signal.stopPrice, orderId]
                                    );
                                    
                                    // Ekranda favori yıldızı yanması için standart tabloya da yaz
                                    const checkFav = await db.get("SELECT id FROM favorites WHERE telegramId = ? AND signalId = ?", [process.env.PERISKOP_TELEGRAM_ID, signalId]);
                                    if(!checkFav) {
                                        await db.run("INSERT INTO favorites (telegramId, signalId) VALUES (?, ?)", [process.env.PERISKOP_TELEGRAM_ID, signalId]);
                                    }
                                    console.log(`[AUTO-TRADE] Başarılı! Favorilere kayıt edildi.`);
                                }
                            } catch(e) {
                                console.error(`[AUTO-TRADE] Borsa Emir İletim Hatası:`, e.message);
                            }
                        } else {
                            console.log(`[AUTO-TRADE] Atlandı: ${signal.symbol} için bugün önceden girilmiş bir emir var.`);
                        }
                    }
                } catch(e) {
                    console.error("[AUTO-TRADE] Hata:", e.message);
                }
            }
            // --- AUTO TRADING BLOCK END ---
            
            if (telegramBot && process.env.TELEGRAM_VIP_GROUP_ID) {
                try {
                    const hasFlag = Array.isArray(signal.warnings) ? signal.warnings.some(w => w.includes('Flag')) : (signal.warnings && signal.warnings.includes('Flag'));
                    const flagPart = hasFlag ? `🔥 Formasyon: Bayrak/Flama Modeli Tespit Edildi, +10 Kalite Puanı eklendi.\n\n` : `\n`;
                    const categoryTag = signal.isAsset ? '[VARLIKLAR (FX/Emtia)]' : '[KRİPTO]';
                    const msg = `🚨 *Elyte Sinyal Uygulaması Üzerinde '${categoryTag}' Kategorisinde Yeni Bir Sinyal Düştü!*\n\n` +
                                `⭐ Kalite Skoru: *${signal.qualityScore}*\n` +
                                `🎯 Yön: *${signal.type}*\n` + flagPart +
                                `_Detaylar ve seviyeler için Elyte aplikasyonuna girebilirsiniz..._ 🔭\n\n` +
                                `🔗 Web Platformu:\nhttps://www.elytesignals.com/dashboard`;
                    telegramBot.sendMessage(process.env.TELEGRAM_VIP_GROUP_ID, msg, { parse_mode: 'Markdown' });
                } catch (e) {
                    console.error("Telegram send signal failed:", e.message);
                }
            }
            
            signalCount++;
        }
        
        // Rate limit'i aşmamak için her istek arası 100ms bekle (1 saniyede 10 istek, limite çok uzak)
        await delay(100); 
    }

    console.log(`[SCANNER] Scan complete. Found ${signalCount} new signals.`);
    } finally {
        isScanning = false;
    }
}
async function sendNightlyReport() {
    console.log('[SCANNER] Generating Nightly Quality Score Report...');
    try {
        let yesterdaysDate = new Date();
        // UTC'de olduğumuz varsayımı ile: dünü almak için
        yesterdaysDate.setDate(yesterdaysDate.getDate() - 1);
        const dayString = yesterdaysDate.toISOString().split('T')[0];

        const allSignals = await db.all("SELECT qualityScore, status, symbol FROM signals WHERE date(createdAt) = ?", [dayString]);
        
        const detailedData = {};
        let totalWins = 0; let totalLosses = 0; let totalActive = 0;

        allSignals.forEach(s => {
            if(!detailedData[s.qualityScore]) detailedData[s.qualityScore] = { WIN:0, LOSS:0, ACTIVE:0 };
            detailedData[s.qualityScore][s.status]++;
            if(s.status === 'WIN') totalWins++;
            if(s.status === 'LOSS') totalLosses++;
            if(s.status === 'ACTIVE') totalActive++;
        });

        let totalClosed = totalWins + totalLosses;
        let winRate = totalClosed > 0 ? ((totalWins / totalClosed) * 100).toFixed(1) : 0;

        // Sabit her sinyale 30$ kasa attıysak PnL hesabı
        // Basitçe: her Win %3 kar (yaklaşık), her Loss %1.5 zarar = spotta. vs..
        // Tam rakamlar için Price hesabı eklemedik ama kaba Karşılaştırma verebiliriz.
        let totalSignalsOfDayLog = totalWins + totalLosses + totalActive;

        let reportText = `🤖 *Periskop AI - Gün Sonu Özeti*\n`;
        reportText += `📅 *Tarih:* ${dayString}\n\n`;
        reportText += `📈 *Günlük İstatistikler:*\n`;
        reportText += `📊 Toplam İşlem: ${totalSignalsOfDayLog}\n`;
        reportText += `✅ Başarılı: ${totalWins} İşlem\n`;
        reportText += `⛔ Stop: ${totalLosses} İşlem\n`;
        reportText += `⏳ Açık: ${totalActive} İşlem\n`;
        reportText += `🎯 *Başarı Oranı: %${winRate}*\n\n`;

        let scores = Object.keys(detailedData).sort((a,b) => b - a);
        if(scores.length === 0) {
            reportText += `Dün piyasada pozisyon açılmadı.\n\n`;
        }

        reportText += `_Elyte Signals Otomasyonu ile 03:00'te üretilmiştir._`;

        if (telegramBot && process.env.TELEGRAM_VIP_GROUP_ID) {
            await telegramBot.sendMessage(process.env.TELEGRAM_VIP_GROUP_ID, reportText, { parse_mode: 'Markdown' });
            console.log('[SCANNER] Nightly report successfully sent to Telegram.');
        }

        // --- GOOGLE SHEETS YEDEKLEME (Yeni Yapı) ---
        try {
            const rowsToInsert = [];
            let totalSignalsOfDay = totalWins + totalLosses + totalActive;
            let dayClosed = totalWins + totalLosses;
            let dayWrStr = dayClosed > 0 ? ((totalWins / dayClosed) * 100).toFixed(1) + '%' : '-';

            const ALL_SCORES = [40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];

            for(let i=0; i < ALL_SCORES.length; i++) {
                let score = ALL_SCORES[i];
                let data = detailedData[score] || { WIN: 0, LOSS: 0, ACTIVE: 0 };
                let scoreTotal = data.WIN + data.LOSS + data.ACTIVE;
                let closed = data.WIN + data.LOSS;
                let wr = closed > 0 ? ((data.WIN / closed) * 100).toFixed(1) + '%' : '-';
                
                if (i === 0) {
                    rowsToInsert.push([
                        score,                 // Skor Puanı
                        scoreTotal,            // Sinyal Sayısı
                        data.WIN,              // TP
                        data.LOSS,             // SL
                        wr,                    // WR
                        totalSignalsOfDay,     // Toplam Sinyal Sayısı
                        dayString,             // Tarih
                        dayWrStr               // Günlük Toplam WR
                    ]);
                } else {
                    rowsToInsert.push([
                        score,                 // Skor Puanı
                        scoreTotal,            // Sinyal Sayısı
                        data.WIN,              // TP
                        data.LOSS,             // SL
                        wr,                    // WR
                        "",                    // Toplam Sinyal Sayısı (Boş)
                        "",                    // Tarih (Boş)
                        ""                     // Günlük Toplam WR (Boş)
                    ]);
                }
            }

            if(rowsToInsert.length > 0) {
                const googleApi = require('./google-api');
                await googleApi.appendToSheet(rowsToInsert, 'REPORT');
            }
        } catch (e) {
            console.error('[SCANNER] Google Sheets entegrasyon hatası:', e.message);
        }

    } catch (error) {
         console.error('[SCANNER] Send Nightly Report Error: ', error);
    }
}

function backupSystem() {
    console.log('[SCANNER] Starting nightly system backup to Desktop...');
    try {
        const dateStr = new Date().toISOString().split('T')[0];
        const backupFolder = `/Users/periskop/Desktop/ElyteSignal_Backup_${dateStr}`;
        const sourceFolder = `/Users/periskop/.gemini/antigravity/scratch/crypto-signal-app/`;
        
        // node_modules ve git geçmişi hariç klasör kopyalama (rsync)
        const cmd = `rsync -av --exclude="node_modules" --exclude=".git" --exclude=".expo" "${sourceFolder}" "${backupFolder}/"`;
        
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                console.error('[SCANNER] Backup Failed:', error.message);
                if (telegramBot && process.env.TELEGRAM_VIP_GROUP_ID) {
                    telegramBot.sendMessage(process.env.TELEGRAM_VIP_GROUP_ID, `⚠️ *Elyte Sistem Yedekleme Hatası!*\n\`${error.message}\``, { parse_mode: 'Markdown' });
                }
                return;
            }
            console.log(`[SCANNER] Backup successfully created at: ${backupFolder}`);
            if (telegramBot && process.env.TELEGRAM_VIP_GROUP_ID) {
                telegramBot.sendMessage(process.env.TELEGRAM_VIP_GROUP_ID, `📦 *Sistem Yedeği Başarıyla Alındı!*\n\nKlasör: \`${backupFolder}\`\n\nDostum, kodların ve sistemin her gece olduğu gibi masaüstüne yedeklendi! 🫡`, { parse_mode: 'Markdown' });
            }
        });
    } catch(e) {
        console.error('[SCANNER] Backup Exception:', e);
    }
}

function startScanner() {
    // 1. Aktif pozisyonların Stop/TP durumlarını HER DAKİKA kontrol et
    cron.schedule('* * * * *', () => {
        checkActiveSignals();
    });

    // 2. Yeni sinyal yakalama algoritmasını 15 DAKİKADA BİR çalıştır
    cron.schedule('*/15 * * * *', () => {
        runScan();
    });

    // 2.5 Global Market Sensörünü 15 DAKİKADA BİR (Farklı dakikada) çalıştır
    cron.schedule('5,20,35,50 * * * *', () => {
        analyzeGlobalMarket();
    });

    // 3. Gece 03:00'da (Türkiye Saati ile Gün Kapanışı) gecelik rapor yolla ve yedekle
    cron.schedule('0 3 * * *', () => {
        sendNightlyReport();
        backupSystem();
    }, {
        scheduled: true,
        timezone: "Europe/Istanbul"
    });
    
    // Uygulama ilk açıldığında da 1 kez çalışsın
    // Çakışmayı ve birden fazla instancesi engellemek için timeout
    setTimeout(() => {
        analyzeGlobalMarket().then(() => {
            checkActiveSignals();
            runScan();
        });
    }, 2000);
}

module.exports = {
    startScanner,
    sendNightlyReport,
    backfillTrades
};
module.exports.analyzeCoin = analyzeCoin;
