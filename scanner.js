const axios = require('axios');
const cron = require('node-cron');
const db = require('./database');
const { ATR, SMA, ADX, EMA, IchimokuCloud, StochasticRSI } = require('technicalindicators');
const TelegramBot = require('node-telegram-bot-api');
const { exec } = require('child_process');
const { appendToSheet } = require('./google-api');
const { placeOrder, getPosition, updateStopLoss } = require('./bingx-trade');
const YahooFinanceClass = require('yahoo-finance2').default;
const yahooFinance = new YahooFinanceClass();
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const aiModel = genAI.getGenerativeModel({ model: "gemini-3.1-pro-preview" });

// Otopilot İçin Canlı Tercüman Haritası
global.BINGX_SYMBOL_MAP = {};

const ASSET_MAPPING = {
    // Commodities
    'NCCOGOLD': { fetchId: 'GC=F' },
    'NCCOXAG': { fetchId: 'SI=F' },
    'NCCO724OILBRENT': { fetchId: 'BZ=F' },
    'NCCO724OILWTI': { fetchId: 'CL=F' },
    'NCCOXPT': { fetchId: 'PL=F' },
    
    // Indices
    'NCSINASDAQ100': { fetchId: '^IXIC' },
    'NCSI724NASDAQ100': { fetchId: '^IXIC' },
    'NCSISP500': { fetchId: '^GSPC' },
    'NCSIDOWJONES': { fetchId: '^DJI' },
    'NCSIEWJ': { fetchId: 'EWJ' },
    'NCSIEWY': { fetchId: 'EWY' }
};

// KAMA kaldirildi (Perplexity optimizasyonu, Ichimoku ile cakistigi icin silindi)

// YENİ: Varlık Pariteleri İçin Opsiyon Gamma & Max Pain Tarayıcı
async function analyzeOptionsFlow(fetchId, currentPrice) {
    try {
        const YF = require('yahoo-finance2').default;
        const result = await YF.options(fetchId);
        if (!result || !result.options || result.options.length === 0) return null;

        const nearestChain = result.options[0];
        const calls = nearestChain.calls || [];
        const puts = nearestChain.puts || [];

        let totalCallOI = 0, totalPutOI = 0;
        let maxCallOI = 0, maxPutOI = 0;
        let callWallStrike = 0, putWallStrike = 0;
        let allStrikes = new Set();

        calls.forEach(c => {
            const oi = c.openInterest || 0;
            totalCallOI += oi;
            if (oi > maxCallOI) { maxCallOI = oi; callWallStrike = c.strike; }
            allStrikes.add(c.strike);
        });

        puts.forEach(p => {
            const oi = p.openInterest || 0;
            totalPutOI += oi;
            if (oi > maxPutOI) { maxPutOI = oi; putWallStrike = p.strike; }
            allStrikes.add(p.strike);
        });

        const pcr = totalCallOI > 0 ? totalPutOI / totalCallOI : 1;

        let minPainValue = Infinity;
        let maxPainStrike = 0;
        const strikeArray = Array.from(allStrikes).sort((a, b) => a - b);

        strikeArray.forEach(strike => {
            let totalPain = 0;
            calls.forEach(c => { if (strike > c.strike) totalPain += (strike - c.strike) * (c.openInterest || 0); });
            puts.forEach(p => { if (strike < p.strike) totalPain += (p.strike - strike) * (p.openInterest || 0); });
            if (totalPain <= minPainValue && totalPain > 0) { minPainValue = totalPain; maxPainStrike = strike; }
        });

        return { pcr, callWall: callWallStrike, putWall: putWallStrike, maxPain: maxPainStrike };
    } catch (e) { return null; }
}

async function fetchCandles(symbolInfo, intervalMinutes, limit) {
    try {
        const interval = intervalMinutes === 60 ? '1h' : (intervalMinutes + 'm');
        let fetchSym = '';

        if (typeof symbolInfo === 'string') {
            // Crypto
            fetchSym = symbolInfo.endsWith('USDT') ? symbolInfo.replace('USDT', '-USDT') : symbolInfo;
        } else if (symbolInfo.isAsset) {
            // Traditional Asset mapping (e.g. AAPL -> NCSKAAPL2USD-USDT)
            fetchSym = symbolInfo.bingxSymbol;
        } else {
            fetchSym = symbolInfo.symbol.replace('USDT', '-USDT');
        }

        const res = await axios.get(`https://open-api.bingx.com/openApi/swap/v3/quote/klines?symbol=${fetchSym}&interval=${interval}&limit=${limit}`);
        let list = res.data.data || [];

        // BingX returns array of objects {open, high, low, close, volume, time}
        // We sort oldest to newest to match technical indicators logic
        list.sort((a, b) => a.time - b.time);

        return list.map(k => ({
            open: parseFloat(k.open),
            high: parseFloat(k.high),
            low: parseFloat(k.low),
            close: parseFloat(k.close),
            volume: parseFloat(k.volume),
            closeTime: parseInt(k.time)
        }));
    } catch (e) {
        return null;
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
    minRR: 1.5,           // 1.5-2.0 arası (Eski katı kural)
    obLookback: 30,       // 14-50 arası  
    minScore: 55,         // Short sinyalleri için kalite barajı (13 stop'un 10'unu elediği için 55)
    fvgRequired: false,   // true/false
    sma50Filter: 'soft',  // 'hard'/'soft'
    adxThreshold: 25,     // 15-35 arası
    maxActiveTrades: 10,  // Aynı anda maksimum açık BOT işlemi
    priceTolerancePct: 0.3, // İşleme girmek için tolerans %
    isMacroNewsDay: false, // FOMC, NFP gibi ekstrem günlerde EURUSD filtresi
    useMacroFilter: false, // Gecici bir sure makro bloklama ve puanlamalar donduruldu (saf teknik analiz)
    maxSlPct: 3.5,         // Maksimum stop loss % (bunu aşanlar reddedilir)
    premiumSlThreshold: 2.5, // Stop oranı %2.5'i aşan riskli işlemlerde premium RR zorunluluğu
    premiumRR: 2.0         // Riskli işlemler için en az 1:2 R:R zorunluluğu
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
    } catch (e) { return null; }
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
    } catch (e) { return null; }
}

async function fetchCoinGeckoDominance() {
    try {
        const res = await axios.get("https://api.coingecko.com/api/v3/global");
        const mcp = res.data.data.market_cap_percentage;
        return {
            btc: mcp.btc || 50,
            usdt: mcp.usdt || 5,
            alt: Math.max(0, 100 - (mcp.btc || 50) - (mcp.usdt || 5) - (mcp.eth || 10) - (mcp.bnb || 3) - (mcp.sol || 2))
        };
    } catch (e) {
        return { btc: 50, usdt: 5, alt: 15 };
    }
}

function calculateTrendFromKlines(klines) {
    const defaultRes = { trend: 'NEUTRAL', rsi: 50, ema: 0, sma: 0, close: 0 };
    if (!klines || klines.length < 50) return defaultRes;
    const closes = klines.map(k => k.close);
    const ema20 = EMA.calculate({ period: 20, values: closes });
    const sma50 = SMA.calculate({ period: 50, values: closes });
    const { RSI } = require('technicalindicators');
    const rsi = RSI.calculate({ period: 14, values: closes });

    if (!ema20.length || !sma50.length || !rsi.length) return defaultRes;

    const lastClose = closes[closes.length - 1];
    const lastEma = ema20[ema20.length - 1];
    const lastSma = sma50[sma50.length - 1];
    const lastRsi = rsi[rsi.length - 1];

    let trend = 'NEUTRAL';
    if (lastClose > lastEma && lastEma > lastSma && lastRsi >= 55) trend = 'STRONG_BULL';
    else if (lastClose > lastSma && lastRsi >= 50) trend = 'BULL';
    else if (lastClose < lastEma && lastEma < lastSma && lastRsi <= 45) trend = 'STRONG_BEAR';
    else if (lastClose < lastSma && lastRsi <= 50) trend = 'BEAR';

    return { trend, rsi: lastRsi, ema: lastEma, sma: lastSma, close: lastClose };
}

async function analyzeGlobalMarket() {
    try {
        console.log('[GLOBAL SENSOR] Fetching macro market and dominance data...');
        const [btc1h, btc4h, btc1d, eth4h, eth1d, dom4h, cgDom] = await Promise.all([
            fetchBybitKlinesGlobal('BTCUSDT', '60'),
            fetchBybitKlinesGlobal('BTCUSDT', '240'),
            fetchBybitKlinesGlobal('BTCUSDT', 'D'),
            fetchBybitKlinesGlobal('ETHUSDT', '240'),
            fetchBybitKlinesGlobal('ETHUSDT', 'D'),
            fetchBinanceKlines('BTCDOMUSDT', '4h'),
            fetchCoinGeckoDominance()
        ]);

        const btc1hObj = calculateTrendFromKlines(btc1h);
        const btc4hObj = calculateTrendFromKlines(btc4h);
        const btc1dObj = calculateTrendFromKlines(btc1d);
        const eth4hObj = calculateTrendFromKlines(eth4h);
        const eth1dObj = calculateTrendFromKlines(eth1d);
        const dom4hObj = calculateTrendFromKlines(dom4h);

        let finalBtc = btc4hObj.trend;
        if ((btc4hObj.trend === 'BULL' || btc4hObj.trend === 'STRONG_BULL') && (btc1dObj.trend === 'BULL' || btc1dObj.trend === 'STRONG_BULL')) {
            finalBtc = 'STRONG_BULL';
        } else if ((btc4hObj.trend === 'BEAR' || btc4hObj.trend === 'STRONG_BEAR') && (btc1dObj.trend === 'BEAR' || btc1dObj.trend === 'STRONG_BEAR')) {
            finalBtc = 'STRONG_BEAR';
        }

        globalMarketState = {
            btcTrend: finalBtc,
            btc1h: btc1hObj.trend,
            btc4h: btc4hObj.trend,
            btc1d: btc1dObj.trend,
            btc1dObj: btc1dObj,
            ethTrend: eth4hObj.trend,
            eth1dObj: eth1dObj,
            btcDomTrend: dom4hObj.trend,
            cgDom: cgDom,
            timestamp: Date.now()
        };
        console.log(`[GLOBAL SENSOR] BTC: ${globalMarketState.btcTrend} | USDT.D: %${globalMarketState.cgDom.usdt.toFixed(1)} | ETH: ${globalMarketState.ethTrend}`);
    } catch (e) {
        console.error('[GLOBAL SENSOR] Error:', e.message);
    }
}
// --- GLOBAL MARKET SENSOR END ---

async function getUsdtPairsAndAssets() {
    try {
        const response = await axios.get('https://open-api.bingx.com/openApi/swap/v2/quote/ticker');
        const symbols = response.data.data;
        const ignoredStables = ['USDC-USDT', 'USD1-USDT', 'USDE-USDT', 'BUSD-USDT', 'TUSD-USDT', 'FDUSD-USDT', 'EUR-USDT', 'DAI-USDT', 'USTC-USDT', 'PYUSD-USDT', 'CRCLX-USDT', 'NXPC-USDT'];
        
        let cryptoPairs = [];
        let tradFiAssets = [];
        let freshMap = {};

        symbols.forEach(s => {
            if (!s.symbol.endsWith('-USDT') || ignoredStables.includes(s.symbol)) return;

            const vol = parseFloat(s.quoteVolume);
            
            if (s.symbol.startsWith('NC')) {
                // TradFi (Sentetikler) İçin Hacim Barajı (500k USD)
                if (vol > 500000) {
                    const bingxSymbol = s.symbol;
                    let cleanSymbol = bingxSymbol.replace('2USD-USDT', '').replace('-USDT', '');
                    let fetchId = cleanSymbol;

                    if (bingxSymbol.startsWith('NCSK')) {
                         fetchId = cleanSymbol.replace('NCSK', ''); // AAPL, NVDA
                         cleanSymbol = fetchId;
                    } else if (bingxSymbol.startsWith('NCFX')) {
                         let fx = cleanSymbol.replace('NCFX', ''); // EUR2CHF
                         cleanSymbol = fx.replace('2', ''); // EURCHF
                         fetchId = cleanSymbol + '=X'; // EURCHF=X
                    } else {
                         // NCCO veya NCSI Endeksler ve Emtialar
                         let baseCode = cleanSymbol.replace('NCCO', '').replace('NCSI', '').replace('724', '');
                         if (baseCode === 'OILBRENT') baseCode = 'BRENT';
                         if (baseCode === 'OILWTI') baseCode = 'WTI';
                         
                         if (ASSET_MAPPING[cleanSymbol]) {
                             fetchId = ASSET_MAPPING[cleanSymbol].fetchId;
                         } else {
                             fetchId = baseCode; // Fallback
                         }
                         cleanSymbol = baseCode;
                    }

                    const finalSymbol = cleanSymbol === 'GOLD' ? 'XAUUSD' : (cleanSymbol === 'XAG' ? 'XAGUSD' : cleanSymbol);
                    
                    freshMap[finalSymbol] = bingxSymbol;

                    tradFiAssets.push({
                        symbol: finalSymbol,
                        isAsset: true,
                        fetchId: fetchId,
                        bingxSymbol: bingxSymbol,
                        volume: vol
                    });
                }
            } else {
                // Kripto Pariteler (3 Milyon USD Barajı)
                if (vol > 3000000) {
                   const cleanCrypto = s.symbol.replace('-', '');
                   freshMap[cleanCrypto] = s.symbol; // BTCUSDT -> BTC-USDT
                   cryptoPairs.push({
                       symbol: cleanCrypto,
                       volume: vol
                   });
                }
            }
        });

        global.BINGX_SYMBOL_MAP = freshMap; // Tercümanı hafızaya kaydet
        return { cryptoPairs, tradFiAssets };
    } catch (error) {
        console.error('BingX Ticker Error:', error.message);
        return { cryptoPairs: [], tradFiAssets: [] };
    }
}

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Aktif sinyalleri kontrol et, duruma göre Win veya Loss yap
async function checkActiveSignals() {
    try {
        const activeSignals = await db.all("SELECT * FROM signals WHERE status = 'ACTIVE'");
        if (!activeSignals || activeSignals.length === 0) return;

        console.log(`[SCANNER] Checking ${activeSignals.length} active signals...`);

        // Batch fetch all prices at once (BingX API)
        const res = await axios.get('https://open-api.bingx.com/openApi/swap/v2/quote/ticker');
        const priceMap = {};
        
        // TradFi Tercuman (Reverse Map) 
        const reverseMap = {};
        if (global.BINGX_SYMBOL_MAP) {
             Object.keys(global.BINGX_SYMBOL_MAP).forEach(k => {
                 reverseMap[global.BINGX_SYMBOL_MAP[k]] = k;
             });
        }

        if (!res || !res.data || !Array.isArray(res.data.data)) {
             console.error("BingX Ticker Error: res.data.data is not an array or missing.");
             return;
        }

        res.data.data.forEach(t => {
             let mappedKey = t.symbol.replace('-', '');
             if (reverseMap[t.symbol]) mappedKey = reverseMap[t.symbol];
             priceMap[mappedKey] = parseFloat(t.lastPrice);
        });

        // --- AUTO TRADING CHECK START ---
        if (process.env.BINGX_API_KEY) {
            try {
                // Sadece veritabanında tablomuz varsa çalışır (database.js db error atmaması için tablonun olduğunu varsayıyoruz)
                const activeTrades = await db.all("SELECT * FROM user_trades WHERE status = 'ACTIVE'");
                for (const trade of activeTrades) {
                    try {
                        const position = await getPosition(trade.symbol);
                        if (!position || parseFloat(position.size) === 0) {
                            // Pozisyon Borsada Kapanmış (TP/SL)
                            console.log(`[AUTO-TRADE-CHECK] Pozisyon Borsada Kapalı Tespit Edildi: ${trade.symbol}`);
                            const currentP = priceMap[trade.symbol] || trade.entryPrice;
                            
                            // NATIVE TP/SL MESAFE TESPİTİ: Anlık fiyat (currentP) fitilden dönmüş bile olsa
                            // fiyatın o an SL'ye mi yoksa TP'ye mi daha yakın olduğuna bakarak kesin durumu tayin et.
                            const distToTP = Math.abs(currentP - trade.targetPrice);
                            const distToSL = Math.abs(currentP - trade.stopPrice);
                            let reason = distToTP < distToSL ? 'NATIVE_TP' : 'NATIVE_SL';
                            let customFavStatus = distToTP < distToSL ? 'WIN' : 'LOSS';
                            
                            let pnl = 0;
                            if (trade.type === 'LONG') pnl = ((currentP - trade.entryPrice) / trade.entryPrice) * 100 * 10;
                            else pnl = ((trade.entryPrice - currentP) / trade.entryPrice) * 100 * 10;

                            await db.run(
                                "UPDATE user_trades SET status = 'CLOSED', pnl = ?, closeReason = ?, closedAt = CURRENT_TIMESTAMP WHERE id = ?",
                                [pnl, reason, trade.id]
                            );

                            // UI FAVORILER SENKRONIZASYONU
                            await db.run(
                                "UPDATE favorites SET customStatus = ?, customPnl = ?, closedAt = CURRENT_TIMESTAMP WHERE telegramId = ? AND signalId = ? AND customStatus IS NULL",
                                [customFavStatus, pnl, trade.telegramId, trade.signalId]
                            );

                            // GLOBAL SİNYALİ BORSADAN GELEN KESİN BİLGİYLE ZORLA KAPAT (RACE CONDITION FIX)
                            // Borsada pozisyon SL olduysa ama global api anlık fitili kaçırdıysa, sinyal dashboard'da asılı kalır. Bunu engellemek için Global'i de eziyoruz.
                            await db.run(
                                "UPDATE signals SET status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND status = 'ACTIVE'",
                                [customFavStatus, trade.signalId]
                            );
                        } else {
                            // --- BREAKEVEN TRAILING STOP LOGIC ---
                            const isBreakeven = trade.isBreakeven || 0;
                            if (isBreakeven === 0) {
                                const currentP = priceMap[trade.symbol];
                                if (currentP) {
                                    const risk = Math.abs(trade.entryPrice - trade.stopPrice);
                                    let reachedTP1 = false;
                                    let newStopLoss = trade.entryPrice;

                                    if (trade.type === 'LONG') {
                                        const tp1 = trade.entryPrice + risk;
                                        if (currentP >= tp1) reachedTP1 = true;
                                        newStopLoss = trade.entryPrice * 1.0015; // Komisyonu kurtarmak için %0.15 üstü
                                    } else {
                                        const tp1 = trade.entryPrice - risk;
                                        if (currentP <= tp1) reachedTP1 = true;
                                        newStopLoss = trade.entryPrice * 0.9985; // Komisyonu kurtarmak için %0.15 altı
                                    }

                                    if (reachedTP1) {
                                        try {
                                            await updateStopLoss(trade.symbol, newStopLoss, trade.targetPrice);
                                            await db.run("UPDATE user_trades SET isBreakeven = 1 WHERE id = ?", [trade.id]);
                                            console.log(`[TRAILING-STOP] ${trade.symbol} 1R hedefine ulaştı. StopLoss girişe çekildi: ${newStopLoss}`);

                                            // Send Telegram Message
                                            if (telegramBot && process.env.TELEGRAM_VIP_GROUP_ID) {
                                                const msg = `🛡️ *KORUMA DEVREDE!* [${trade.symbol}]\nİşlem İlk Kâr Hedefine (1R) ulaştı. Zarar Etme Riski Sıfırlandı, Stop Loss maliyetin hemen önüne (${newStopLoss.toFixed(4)}) çekildi!`;
                                                telegramBot.sendMessage(process.env.TELEGRAM_VIP_GROUP_ID, msg, { parse_mode: 'Markdown' });
                                            }
                                        } catch (err) {
                                            console.error("[TRAILING-STOP] Güncelleme Hatası:", err.message);
                                        }
                                    }
                                }
                            }
                        }
                    } catch (e) { }
                }
            } catch (e) { }
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
                let isBreakevenCandid = signal.reachedTwoPercent;
                if (pnl >= 2.0 && !signal.reachedTwoPercent) {
                    await db.run("UPDATE signals SET reachedTwoPercent = 1 WHERE id = ?", [signal.id]);
                    isBreakevenCandid = 1;
                }

                if (newStatus === 'LOSS' && isBreakevenCandid) {
                    newStatus = 'BREAKEVEN';
                }

                if (newStatus) {
                    (async () => {
                        try {
                            let netUsd = null;
                            const { getNetIncome } = require('./bingx-trade');
                            // Bekle ki borsa income geçmişini tam işlesin
                            await new Promise(res => setTimeout(res, 2000));
                            netUsd = await getNetIncome(signal.symbol, signal.createdAt);

                            if (netUsd !== null && netUsd !== undefined) {
                                await db.run("UPDATE signals SET status = ?, netPnlUsd = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?", [newStatus, netUsd, signal.id]);
                                console.log(`[SCANNER] Signal ${signal.symbol} closed as ${newStatus} (Net PnL: $${netUsd.toFixed(4)})`);
                            } else {
                                await db.run("UPDATE signals SET status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?", [newStatus, signal.id]);
                                console.log(`[SCANNER] Signal ${signal.symbol} closed as ${newStatus} (Net PnL: YAKALANAMADI)`);
                            }

                            // Telegram Bildirimi (TP veya SL)
                            if (typeof telegramBot !== 'undefined' && telegramBot && process.env.TELEGRAM_VIP_GROUP_ID) {
                                try {
                                    const isTP = (newStatus === 'WIN');
                                    let pnlText = (netUsd !== null && netUsd !== undefined) ? `💸 *Net PnL:* $${netUsd.toFixed(2)}` : `📊 *Kapanış Durumu:* Piyasa Emriyle Kapatıldı.`;

                                    let msg = "";
                                    if (isTP) {
                                        msg = `🎯 *TAKE PROFIT (HEDEF VURULDU)!* [${signal.symbol}]\nElyte Sinyali başarıyla kâr hedefine ulaştı ve kapatıldı.\n\n${pnlText}\n\nPeriskop AI hedefini vurdu! 🔭`;
                                    } else {
                                        if (signal.reachedTwoPercent) {
                                            msg = `🛑 *STOP LOSS ÇALIŞTI (BAŞABAŞ)* [${signal.symbol}]\nİşlem 1R sonrası kârı korumak için giriş seviyesinden kapatıldı.\n\nZarar Koruma (Breakeven) Devrede! 🛡️`;
                                        } else {
                                            msg = `🛑 *STOP LOSS!* [${signal.symbol}]\nİşlem maalesef zarardurdur seviyesine temas etti ve kapatıldı.\n\nRisk yönetimi daima hayat kurtarır. 🛡️`;
                                        }
                                    }
                                    
                                    // TELEGRAM MESAJI GONDER
                                    telegramBot.sendMessage(process.env.TELEGRAM_VIP_GROUP_ID, msg, { parse_mode: 'Markdown' });
                                    
                                } catch (tgErr) {
                                    console.error("TG Send Error on Close:", tgErr.message);
                                }
                            }

                            // Google Sheets'te Güncelle
                            const googleApi = require('./google-api');
                            if (googleApi.updateSheetSignalStatus) {
                                await googleApi.updateSheetSignalStatus(signal.id, newStatus);
                            }
                        } catch (err) {
                            console.error("[SCANNER ASYNC CLOSE ERROR]:", err);
                        }
                    })();
                }
            } catch (e) {
                // Ignore single coin error
            }
        }
    } catch (e) {
        console.error("Error checking active signals:", e);
    }

    // Pozisyonlar kapanmış olabilir, boşalan yerleri doldur
    // await backfillTrades(); // KULLANICI TALEBI: Otomatik "Eski Sinyalleri Doldurma" iptal edildi. Slotlar yeni sinyallere saklanacak.
}

async function backfillTrades() {
    if (!process.env.BINGX_API_KEY || !process.env.PERISKOP_TELEGRAM_ID) return;

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

        if (candidateSignals.length === 0) return;

        console.log(`[BACKFILL] Bos slot: ${slotsAvailable}. Bekleyen ${candidateSignals.length} adet havuz sinyali degerlendiriliyor...`);

        // BingX Fiyatları
        const res = await axios.get('https://open-api.bingx.com/openApi/swap/v2/quote/ticker');
        const priceMap = {};
        res.data.data.forEach(t => priceMap[t.symbol.replace('-', '')] = parseFloat(t.lastPrice));

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
                        if (!checkFav) {
                            await db.run("INSERT INTO favorites (telegramId, signalId) VALUES (?, ?)", [process.env.PERISKOP_TELEGRAM_ID, signal.id]);
                        }
                        slotsAvailable--;
                    }
                } catch (e) {
                    console.error(`[BACKFILL] Hata:`, e.message);
                }
            } else {
                const dir = currentPrice > signal.entryPrice ? 'Yukarı' : 'Aşağı';
                console.log(`[BACKFILL] Atlanıyor: ${signal.symbol} (Fiyat %${diffPct.toFixed(2)} ${dir} kaçmış. Tolerans: %${CONFIG.priceTolerancePct})`);
            }
        }
    } catch (e) {
        console.error("Backfill Error:", e);
    }
}

async function analyzeCoin(symbolInfo) {
    try {
        const sym = typeof symbolInfo === 'string' ? symbolInfo : symbolInfo.symbol;
        const klinesFull = await fetchCandles(symbolInfo, 60, 250);
        if (!klinesFull || klinesFull.length < 200) return null;

        const closesFull = klinesFull.map(k => k.close);
        const sma200Values = SMA.calculate({ period: 200, values: closesFull });
        const curSma200 = sma200Values[sma200Values.length - 1];

        // Orijinal indikatör uyumu için son 100 işlem mumunu kesiyoruz
        const klines = klinesFull.slice(-100);

        const opens = klines.map(k => k.open);
        const highs = klines.map(k => k.high);
        const lows = klines.map(k => k.low);
        const closes = klines.map(k => k.close);
        const volumes = klines.map(k => k.volume);

        const currentPrice = closes[closes.length - 1];
        const rangeHigh = Math.max(...highs);
        const rangeLow = Math.min(...lows);
        const eq = (rangeHigh + rangeLow) / 2;

        const atrRes = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
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
        let trapWickSize = 0;
        const trapCurrentLow = lows[lows.length - 1];
        const trapCurrentHigh = highs[highs.length - 1];
        const trapCurrentOpen = opens[opens.length - 1];

        // LOKAL TREND ANALİZİ (Boğa Rallisinde Dibi Bulabilmek için 24 Mumluk Lokal Pencere)
        const localLows = lows.slice(-24);
        const localHighs = highs.slice(-24);
        const localRangeLow = Math.min(...localLows);
        const localRangeHigh = Math.max(...localHighs);

        if (recentMin <= localRangeLow * 1.005 && currentPrice > localRangeLow) {
            let sweepIdx = lows.lastIndexOf(recentMin);
            if (sweepIdx !== -1) {
                // CHOCH Onayı Kaldırıldı (Fon Büyütme Agresif Modu) - Sadece dönmesi yeterli
                dipDeviation = true;
                sweepIdxLong = sweepIdx;
                trapWickSize = Math.min(trapCurrentOpen, currentPrice) - trapCurrentLow;
            }
        }

        let sweepIdxShort = -1;
        if (recentMax >= localRangeHigh * 0.995 && currentPrice < localRangeHigh) {
            let sweepIdx = highs.lastIndexOf(recentMax);
            if (sweepIdx !== -1) {
                // CHOCH Onayı Kaldırıldı (Fon Büyütme Agresif Modu) - Sadece dönmesi yeterli
                tepeDeviation = true;
                sweepIdxShort = sweepIdx;
                trapWickSize = trapCurrentHigh - Math.max(trapCurrentOpen, currentPrice);
            }
        }

        // 🚀 RANGE BREAKOUT (Trend Kırılımı) KONTROLÜ (Özel İstek) 🚀
        // Sadece Makro Piyasa destekliyorsa kırılımlara bypass izni ver (Fakeout/Fake Kırılım Koruması)
        const prevRangeHigh = Math.max(...highs.slice(0, -1));
        const prevRangeLow = Math.min(...lows.slice(0, -1));

        const isMacroBull = globalMarketState.btcTrend && globalMarketState.btcTrend.includes('BULL') && 
                            globalMarketState.ethTrend && globalMarketState.ethTrend.includes('BULL');
                            
        const isMacroBear = globalMarketState.btcTrend && globalMarketState.btcTrend.includes('BEAR') && 
                            globalMarketState.ethTrend && globalMarketState.ethTrend.includes('BEAR');

        if (currentPrice > prevRangeHigh && isMacroBull) {
            dipDeviation = true; // BTC ve ETH Boğa iken yukarı kırılıma (LONG) sonsuz güven!
        } else if (currentPrice < prevRangeLow && isMacroBear) {
            tepeDeviation = true; // BTC ve ETH Ayı iken aşağı çöküşe (SHORT) sonsuz güven!
        }

        // --- ADX ve RVOL (Hacim) Çekimi ---
        const trapAdxRes = ADX.calculate({high: highs, low: lows, close: closes, period: 14});
        const trapCurrentADX = trapAdxRes.length > 0 ? trapAdxRes[trapAdxRes.length - 1].adx : 25;
        const trapIsRangingLimit = trapCurrentADX < 20;

        const currentVol = volumes[volumes.length - 1] || 0;
        const avgVol = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
        const rvol = currentVol / (avgVol || 1);

        // 🚀 RANGE ORTASI (Sub-Range OTE Bouncing) v6.1 KONTROLÜ 🚀
        // Gemini & Perplexity Modeli: Sıkışan piyasada %61.8 Fib seviyesinden sekip, hacimli reddedilme yakalaması.
        let internalDeviation = false;
        let internalDirection = '';
        let internalTarget = 0;
        let internalStop = 0;

        const subLows = lows.slice(-20);
        const subHighs = highs.slice(-20);
        const subRangeLow = Math.min(...subLows);
        const subRangeHigh = Math.max(...subHighs);
        const subRangeMiddle = (subRangeHigh + subRangeLow) / 2;
        const eqDistance = Math.abs(currentPrice - subRangeMiddle) / currentPrice;

        if (eqDistance < 0.015 && trapCurrentADX < 25) {
            // SHORT OTE (Range'in üst %61.8 bölgesi)
            const oteShort = subRangeLow + (subRangeHigh - subRangeLow) * 0.618;
            if (currentPrice >= oteShort && currentPrice < subRangeHigh && rvol > 1.2) {
                const wickSize = highs[highs.length - 1] - Math.max(opens[opens.length - 1], currentPrice);
                const bodySize = Math.abs(currentPrice - opens[opens.length - 1]) || 0.0001;
                if (wickSize > bodySize * 1.5) {
                    internalDeviation = true;
                    internalDirection = 'SHORT';
                    internalTarget = subRangeLow; // Karşı uca vur kaç
                    internalStop = subRangeHigh * 1.005; // Zirveyi kırarsa kaç (Max 8h time limit simulation)
                }
            }
            
            // LONG OTE (Range'in alt %38.2 bölgesi)
            const oteLong = subRangeLow + (subRangeHigh - subRangeLow) * 0.382;
            if (currentPrice <= oteLong && currentPrice > subRangeLow && rvol > 1.2) {
                const wickSize = Math.min(opens[opens.length - 1], currentPrice) - lows[lows.length - 1];
                const bodySize = Math.abs(currentPrice - opens[opens.length - 1]) || 0.0001;
                if (wickSize > bodySize * 1.5) {
                    internalDeviation = true;
                    internalDirection = 'LONG';
                    internalTarget = subRangeHigh; // Karşı uca vur kaç
                    internalStop = subRangeLow * 0.995; // Dibi kırarsa kaç (Max 8h time limit simulation)
                }
            }
        }

        // SWEEP VEYA BREAKOUT YOKSA IŞLEM YOK (Ne makro, ne mikro menzil varsa yoksay)
        if (!dipDeviation && !tepeDeviation && !internalDeviation) {
             console.log(`[VETO] ${sym} -> Ne Sweep var ne de Breakout (Zirve/Dip sessizliği)`);
             return null;
        }

        const direction = dipDeviation ? 'LONG' : (tepeDeviation ? 'SHORT' : internalDirection);

        // 🔥 ASİMETRİK LİKİDİTE (DUAL LIQUIDITY) FİLTRESİ
        const globalVol = typeof symbolInfo === 'object' && symbolInfo.volume ? symbolInfo.volume : 999999999;


        // Ranging Makro Çatışması Hard-Block İptal Edildi (Kullanıcı İsteği: Skor Cezası Olarak Hesaplanacak)
        // Eğer piyasa ADX<20 altında ve trende tersse, Zodyak Puanlamasında Toplam -25 Puan ceza yiyecek.
        // Ama +25 (OB), +15 (FVG), +20 (Wick) gibi kusursuz kurallar bir araya gelip 55 barajını aşarsa işleme girebilecek.

        // 🚨 MERCAN BEY (ANOMALİ DEDEKTÖRÜ & İSTİHBARAT) 🚨
        const diff = (currentPrice - trapCurrentOpen) / trapCurrentOpen;
        if (Math.abs(diff) >= 0.10 && globalVol >= 5000000) {
            try {
                const { fireMercanBey } = require('./mercan_bey');
                fireMercanBey(sym, diff > 0 ? 'PUMP' : 'DUMP', diff);
            } catch(e) {}
        }

        // HACİM & LİKİDİTE KORUMASI (Demir Bey'in Mirası)
        if (direction === 'LONG' && globalVol < 2000000) {
            console.log(`[VETO-VOL] ${sym} -> Hacim çok düşük (LONG: ${globalVol})`);
            return null;
        }
        if (direction === 'SHORT' && globalVol < 1000000) {
            console.log(`[VETO-VOL] ${sym} -> Hacim çok düşük (SHORT: ${globalVol})`);
            return null;
        }

        // --- SKORLAMA (SCORING) ALTYAPISI (ZODYAK V2.9.0) ---
        let qualityScore = 0;
        let warnings = [];
        let breakdown = { ob: false, fvg: false, rvol: rvol, adx: trapCurrentADX, rr: 0, trend4h: "neutral", globalVol: globalVol };

        // Sub-Range OTE Bouncing Puan Ödülü Tarafından
        if (internalDeviation) {
            qualityScore += 22;
            warnings.push("Sub-Range OTE Bouncing (+22)");
        }

        // 1. ZEMIN / BÖLGE SLOTU (Max +40)
        const trapObZone = direction === 'LONG' ? [rangeLow - (avgATR * 1.5), rangeLow + (avgATR * 1.5)] : [rangeHigh - (avgATR * 1.5), rangeHigh + (avgATR * 1.5)];
        const trapObCandlesStart = closes.length - CONFIG.obLookback - 6;
        let hasOB = false;
        for (let i = trapObCandlesStart; i <= closes.length - 6; i++) {
            if (i < 0) continue;
            if (direction === 'LONG' && closes[i] < opens[i] && closes[i] <= trapObZone[1] && closes[i] >= trapObZone[0]) {
                if (highs[i+1] > highs[i]) { hasOB = true; break; }
            } else if (direction === 'SHORT' && closes[i] > opens[i] && closes[i] >= trapObZone[0] && closes[i] <= trapObZone[1]) {
                if (lows[i+1] < lows[i]) { hasOB = true; break; }
            }
        }
        if (hasOB) {
            qualityScore += 25;
            warnings.push("Zemin: Order Block Desteği (+25)");
            breakdown.ob = true;
        }

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
            warnings.push("Zemin: FVG Boşluğu (+15)");
            breakdown.fvg = true;
        }

        // 2. TETİKLEME / KURŞUN SLOTU (Max +20 Puan Sınırı)
        let triggerScore = 0;
        let isKillerWick = false;
        let isEngulfing = false;

        if (direction === 'LONG' && dipDeviation && trapWickSize > avgATR * 1.2) isKillerWick = true;
        if (direction === 'SHORT' && peakDeviation && trapWickSize > avgATR * 1.2) isKillerWick = true;
        if (isKillerWick) { triggerScore = Math.max(triggerScore, 20); warnings.push("Tetik: Katil Fitil (+20)"); }

        const currentOpen = opens[opens.length - 1];
        const currentClose = closes[closes.length - 1];
        const prevOpen = opens[opens.length - 2];
        const prevClose = closes[closes.length - 2];
        if (direction === 'LONG' && currentClose > currentOpen && prevClose < prevOpen && currentClose > prevOpen && currentOpen < prevClose) isEngulfing = true;
        if (direction === 'SHORT' && currentClose < currentOpen && prevClose > prevOpen && currentClose < prevOpen && currentOpen > prevClose) isEngulfing = true;
        if (isEngulfing) { triggerScore = Math.max(triggerScore, 20); warnings.push("Tetik: Yutan Mum (Engulfing) (+20)"); }

        qualityScore += triggerScore;

        // 3. TUZAK / CONTEXT SLOTU
        let isSweep = false;
        const sweepLookback = Math.max(0, closes.length - 11);
        if (direction === 'LONG') {
            const minLow = Math.min(...lows.slice(sweepLookback, closes.length - 1));
            if (currentLow < minLow && currentClose > minLow) isSweep = true;
        } else {
            const maxHigh = Math.max(...highs.slice(sweepLookback, closes.length - 1));
            if (currentHigh > maxHigh && currentClose < maxHigh) isSweep = true;
        }
        if (isSweep) { qualityScore += 15; warnings.push("Tuzak: Likidite Süpürmesi (Sweep) (+15)"); }

        const currentVol = volumes[volumes.length - 1];
        const vol20 = volumes.slice(-21, -1);
        const avgVol = vol20.reduce((a, b) => a + b, 0) / 20;
        if ((direction === 'LONG' && currentClose < currentOpen && currentVol < avgVol * 0.5) || 
            (direction === 'SHORT' && currentClose > currentOpen && currentVol < avgVol * 0.5)) {
            qualityScore += 12; warnings.push("Tuzak: Volume Shelter (Hacim Kuruması) (+12)");
        }

        // 4. MAKRO / TREND SLOTU
        if (!symbolInfo.isAsset) {
            const btc1d = globalMarketState.btc1dObj;
            if (btc1d) {
                if (direction === 'LONG') {
                    if (btc1d.trend === 'BULL' || btc1d.trend === 'STRONG_BULL') { qualityScore += 15; warnings.push("Makro: BTC Uyumlu Trend (+15)"); }
                    else if (btc1d.trend === 'BEAR' || btc1d.trend === 'STRONG_BEAR') { qualityScore -= 15; warnings.push("Makro: BTC Zıt Yön Ceza (-15)"); }
                } else {
                    if (btc1d.trend === 'BEAR' || btc1d.trend === 'STRONG_BEAR') { qualityScore += 15; warnings.push("Makro: BTC Uyumlu Trend (+15)"); }
                    else if (btc1d.trend === 'BULL' || btc1d.trend === 'STRONG_BULL') { qualityScore -= 15; warnings.push("Makro: BTC Zıt Yön Ceza (-15)"); }
                }
            }
        }

        let trend4h = "neutral";
        try {
            const klines4h = await fetchCandles(symbolInfo, 240, 50);
            if (klines4h && klines4h.length >= 50) {
                const closes4h = klines4h.map(k => k.close);
                const sma4h = SMA.calculate({ values: closes4h, period: 50 });
                const currentPrice4H = closes4h[closes4h.length - 1];
                const sma50_4H = sma4h[sma4h.length - 1];
                if (currentPrice4H > sma50_4H) trend4h = "bullish";
                else if (currentPrice4H < sma50_4H) trend4h = "bearish";
                
                if (direction === 'LONG' && trend4h === 'bullish') { qualityScore += 15; warnings.push("Makro: 4H Zaman Dilimi Uyumu (+15)"); }
                else if (direction === 'LONG' && trend4h === 'bearish') { qualityScore -= 5; warnings.push("Makro: 4H Zaman Dilimi Çatışması (-5)"); }
                else if (direction === 'SHORT' && trend4h === 'bearish') { qualityScore += 15; warnings.push("Makro: 4H Zaman Dilimi Uyumu (+15)"); }
                else if (direction === 'SHORT' && trend4h === 'bullish') { qualityScore -= 5; warnings.push("Makro: 4H Zaman Dilimi Çatışması (-5)"); }
            }
        } catch(e) {}

        const adxResult = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });
        const currentADX = adxResult.length > 0 ? adxResult[adxResult.length - 1].adx : 0;
        if (currentADX >= 25) { qualityScore += 10; warnings.push("Makro: Sağlıklı ADX İvmesi (+10)"); }
        else if (currentADX < 20) { qualityScore -= 10; warnings.push("Makro: ADX Testere (Ranging) Ceza (-10)"); }

        // 5. İNDİKATÖR MANTIĞI & CEZA HUKUKU
        const ichiRes = IchimokuCloud.calculate({ high: highs, low: lows, conversionPeriod: 9, basePeriod: 26, spanPeriod: 52, displacement: 26 });
        if (ichiRes && ichiRes.length > 0) {
            const currentIchi = ichiRes[ichiRes.length - 1];
            if (direction === 'LONG' && currentPrice > currentIchi.spanA && currentPrice > currentIchi.spanB && currentIchi.conversion > currentIchi.base) {
                qualityScore += 15; warnings.push("İndikatör: Ichimoku Bull Onayı (+15)");
            } else if (direction === 'SHORT' && currentPrice < currentIchi.spanA && currentPrice < currentIchi.spanB && currentIchi.conversion < currentIchi.base) {
                qualityScore += 15; warnings.push("İndikatör: Ichimoku Bear Onayı (+15)");
            }
        }

        const stochRSIRes = StochasticRSI.calculate({ values: closes, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 });
        if (stochRSIRes && stochRSIRes.length > 0) {
            const lastStoch = stochRSIRes[stochRSIRes.length - 1];
            if (direction === 'LONG') {
                if (lastStoch.k > 80) { qualityScore -= 10; warnings.push("İndikatör: StochRSI Aşırı Alım FOMO Cezası (-10)"); }
                else if (lastStoch.k < 20) { qualityScore += 5; warnings.push("İndikatör: StochRSI Dip Kalkışı Teşvik (+5)"); }
            } else if (direction === 'SHORT') {
                if (lastStoch.k < 20) { qualityScore -= 10; warnings.push("İndikatör: StochRSI Aşırı Satım FOMO Cezası (-10)"); }
                else if (lastStoch.k > 80) { qualityScore += 5; warnings.push("İndikatör: StochRSI Zirve Dönüşü Teşvik (+5)"); }
            }
        }

        try {
            const dailyKlines = await fetchCandles(symbolInfo, 1440, 200);
            if (dailyKlines && dailyKlines.length >= 200) {
                const dailyCloses = dailyKlines.map(k => k.close);
                const sma50_1dArr = SMA.calculate({ period: 50, values: dailyCloses });
                const sma200_1dArr = SMA.calculate({ period: 200, values: dailyCloses });
                if (sma50_1dArr.length > 0 && sma200_1dArr.length > 0) {
                    const sma50_1d = sma50_1dArr[sma50_1dArr.length - 1];
                    const sma200_1d = sma200_1dArr[sma200_1dArr.length - 1];
                    if (direction === 'LONG' && sma50_1d > sma200_1d && currentPrice > sma200_1d) { qualityScore += 10; warnings.push("İndikatör: 1D Golden Cross (+10)"); }
                    else if (direction === 'SHORT' && sma50_1d < sma200_1d && currentPrice < sma200_1d) { qualityScore += 10; warnings.push("İndikatör: 1D Bear Cross (+10)"); }
                }
            }
        } catch(e) {}

        // 7. ORDER FLOW BÖLÜMÜ (MİKRO-ANATOMİ)
        const currentHigh = highs[highs.length - 1];
        const currentLow = lows[lows.length - 1];
        if (currentHigh > currentLow && currentVol > 0) {
            const buyVol = currentVol * ((currentClose - currentLow) / (currentHigh - currentLow));
            const sellVol = currentVol * ((currentHigh - currentClose) / (currentHigh - currentLow));
            const buyRatio = buyVol / (currentVol || 1);
            const sellRatio = sellVol / (currentVol || 1);

            if (direction === 'LONG') {
                if (buyRatio > 0.60) { qualityScore += 15; warnings.push("Order Flow: Aggressive Bull (+15)"); }
                else if (sellRatio > 0.60) { qualityScore -= 15; warnings.push("Order Flow: Aggressive Bear Reject Cezası (-15)"); }
            } else if (direction === 'SHORT') {
                if (sellRatio > 0.60) { qualityScore += 15; warnings.push("Order Flow: Aggressive Bear (+15)"); }
                else if (buyRatio > 0.60) { qualityScore -= 15; warnings.push("Order Flow: Aggressive Bull Reject Cezası (-15)"); }
            }
        }

        // 8. FİNANSAL ÇEŞİTLİLİK (PORTFÖY YIĞILMA CEZASI)
        try {
            const activeTrades = await db.all("SELECT type FROM user_trades WHERE status = 'ACTIVE'");
            let sameDirCount = 0;
            for(let t of activeTrades) {
                if (t.type === direction) sameDirCount++;
            }
            if (sameDirCount >= 2) {
                qualityScore -= 12;
                warnings.push(`Portföy: Aynı Yönde ${sameDirCount} İşlem Yığılma Cezası (-12)`);
            }
        } catch(e) {}

        // Daima logla ki neden takıldığını görelim
        console.log(`[DEBUG] ${sym} | Yön: ${direction} | Puan: ${qualityScore} | Uyarılar: ${warnings.join(', ')}`);
        
        // Zodyak Altın Kesişim Limiti (Kullanıcı & Backtest Onaylı: 45 - 60 Puan Arası)
        if (qualityScore < 45 || qualityScore > 60) {
            return null; // FOMO tuzağına (>60) veya kalitesiz formasyona (<45) girme!
        }

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
        }

        if (internalDeviation) {
            // Range Ortası Özel Dinamik Hedefleme (Hızlı Kapama Modeli)
            targetP = internalTarget;
            dynamicStop = internalStop;
            risk = Math.abs(currentPrice - dynamicStop);
            reward = Math.abs(targetP - currentPrice);
        } else if (direction === 'LONG') {
            dynamicStop = currentPrice - (currentATR * slMultiplier);
            risk = currentPrice - dynamicStop;

            // Varsayılan Hedef: 1:1.5 Risk Ödül Oranı
            targetP = hasFlagPennant ? (currentPrice + poleSize) : (currentPrice + (risk * 1.5));

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

            // 1:3 R:R Cap Uyumlu Kesinti (Tıraşlama) veya Ranging Limit 1.0R
            let maxReward = trapIsRangingLimit ? (risk * 1.0) : (risk * 3.0);
            if (reward > maxReward) {
                reward = maxReward;
                targetP = currentPrice + reward;
                warnings.push(trapIsRangingLimit ? 'TP Capped (1.0R Ranging)' : 'TP Capped (1:3 Max)');
            }
        } else {
            dynamicStop = currentPrice + (currentATR * slMultiplier);
            risk = dynamicStop - currentPrice;

            // Varsayılan Hedef: 1:1.5 Risk Ödül Oranı
            targetP = hasFlagPennant ? (currentPrice - poleSize) : (currentPrice - (risk * 1.5));

            if (hasGap && gapTarget < currentPrice) {
                targetP = gapTarget;
                warnings.push('Gap Fill TP Target Set');
            }

            if (hasFVG && targetP < currentPrice - (currentPrice * 0.02)) {
                targetP = currentPrice - (currentPrice * 0.02);
            }

            reward = currentPrice - targetP;

            // 1:3 R:R Cap veya Ranging Limit 1.0R
            let maxReward = trapIsRangingLimit ? (risk * 1.0) : (risk * 3.0);
            if (reward > maxReward) {
                reward = maxReward;
                targetP = currentPrice - reward;
                warnings.push(trapIsRangingLimit ? 'TP Capped (1.0R Ranging)' : 'TP Capped (1:3 Max)');
            }
        }


        let riskPct = (risk / currentPrice) * 100;
        let minSlPct = (currentATR / currentPrice) * 100 * 0.8; 
        
        // PERISKOP RISK MATRIX: Kademeli Filtreleme
        // 1. Minimum (Noise) ve Maksimum SL % Kesicisi
        if (riskPct > CONFIG.maxSlPct || riskPct < minSlPct) {
            return null; 
        }
        // 2. Dinamik R:R Talebi
        let requiredRR = CONFIG.minRR;
        if (riskPct > CONFIG.premiumSlThreshold) {
            requiredRR = CONFIG.premiumRR;
            warnings.push(`Premium RR Required (>%${CONFIG.premiumSlThreshold} Risk)`);
        }

        let requiredReward = risk * requiredRR;
        let organicRR = risk > 0 ? (reward / risk) : 0; // Doğal hedef R:R'si
        let finalRR = organicRR;
        
        breakdown.rr = parseFloat(finalRR.toFixed(2));

        // --- PERPLEXITY ELITE FILTER (v2.0) + CHATGPT SWEEP/ENGULFING ---
        let currentJ = closes.length - 1;

        // BÖLÜM A: TETİKLEME (Kurşun) Slotu -> Maksimum +20 Puan (Wick veya Engulfing)
        // 1. Killer Wick (Katil Fitil) Kontrolü
        let hasKillerWick = false;
        for (let j = closes.length - 3; j <= closes.length - 1; j++) {
            if (j >= 0) {
                let candleSize = highs[j] - lows[j] || 1;
                if (direction === 'LONG') {
                    let minCloseOpen = Math.min(opens[j], closes[j]);
                    let lowerWick = minCloseOpen - lows[j];
                    let wickRatio = lowerWick / candleSize;
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

        // 2. Engulfing (Yutan Mum) Kontrolü
        let hasEngulfing = false;
        if (currentJ >= 1) {
            let pOpen = opens[currentJ-1]; let pClose = closes[currentJ-1];
            let cOpen = opens[currentJ]; let cClose = closes[currentJ];
            if (direction === 'LONG') {
                if (pClose < pOpen && cClose > cOpen && cClose >= pOpen && cOpen <= pClose) {
                    hasEngulfing = true;
                }
            } else {
                if (pClose > pOpen && cClose < cOpen && cClose <= pOpen && cOpen >= pClose) {
                    hasEngulfing = true;
                }
            }
        }

        // Tetik Slotu Kararı (İkisi de 20 puandır, toplanmaz)
        if (hasKillerWick || hasEngulfing) {
            qualityScore += 20;
            if (hasKillerWick && hasEngulfing) {
                warnings.push('Tetikleyici: Wick + Engulfing Confluence (+20)');
            } else if (hasKillerWick) {
                warnings.push('Tetikleyici: Killer Wick (+20)');
            } else {
                warnings.push('Tetikleyici: Kurumsal Engulfing (+20)');
            }
        }

        // BÖLÜM B: TUZAK (Context) Slotu -> Hacim ve Likidite
        // 3. Liquidity Sweep (Stop Patlatma Mıknatısı) -> +15 Puan
        let hasSweep = false;
        if (currentJ >= 10) {
            let past10Lows = lows.slice(currentJ-10, currentJ);
            let past10Highs = highs.slice(currentJ-10, currentJ);
            let min10Low = Math.min(...past10Lows);
            let max10High = Math.max(...past10Highs);
            
            if (direction === 'LONG') {
                if (lows[currentJ] < min10Low && closes[currentJ] > opens[currentJ] && closes[currentJ] > ((highs[currentJ]+lows[currentJ])/2)) {
                    hasSweep = true;
                }
            } else {
                if (highs[currentJ] > max10High && closes[currentJ] < opens[currentJ] && closes[currentJ] < ((highs[currentJ]+lows[currentJ])/2)) {
                    hasSweep = true;
                }
            }
        }
        if (hasSweep) {
            qualityScore += 15;
            warnings.push('Tuzak: Liquidity Sweep (Stop Temizliği) (+15)');
        }

        // 4. Volume Shelter (Hacim Sığınağı) -> +12 Puan
        let shortTermVolAvg = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
        let lastVol = volumes[currentJ];
        if (direction === 'LONG' && lastVol < shortTermVolAvg * 0.9 && closes[currentJ] < opens[currentJ]) {
            qualityScore += 12;
            warnings.push('Tuzak: Volume Shelter (Zayıf Satış) (+12)');
        } else if (direction === 'SHORT' && lastVol < shortTermVolAvg * 0.9 && closes[currentJ] > opens[currentJ]) {
            qualityScore += 12;
            warnings.push('Tuzak: Volume Shelter (Zayıf Alış) (+12)');
        }
        // --- YENİ CRO STRATEJİ RAPORU KONTROLLERİ ---
        
        // 1. Ekstra Trend Karşıtı Ceza (Teyitsizlik Cezası)
        let isCounterTrend = false;
        if (warnings.some(w => w.includes('200 SMA (-25)') || w.includes('Counter-trend 4H'))) isCounterTrend = true;
        
        let checkKillerWick = warnings.some(w => w.includes('Killer Wick'));
        let checkFVG = warnings.some(w => w.includes('FVG'));
        let hasVolSpike = warnings.some(w => w.includes('Order Flow Aggressive'));
        
        if (isCounterTrend && !checkKillerWick && !checkFVG && !hasVolSpike) {
            qualityScore -= 15;
            warnings.push('Trend Karşıtı Teyitsizlik Cezası (-15)');
        }

        // 2. Altın Üçgen Bonusu (Sinerji)
        let hasOrderBlock = warnings.some(w => w.includes('Order Block'));
        let isStrongTrend = currentADX >= 25;
        if (hasOrderBlock && checkFVG && isStrongTrend) {
            qualityScore += 10;
            warnings.push('Sinerji: Altın Üçgen Bonusu (+10)');
        }
        
        let hasSweepSynergy = warnings.some(w => w.includes('Liquidity Sweep'));
        if (hasOrderBlock && hasSweepSynergy) {
            qualityScore += 10;
            warnings.push('Sinerji: Keskin Nişancı Bonusu (+10)');
        }

        // 3. Çatışma Cezası (İptal Edildi - VETO Kuralları Yeterli)
        // V3.3: ADX < 20 veya StochRSI extreme durumları üst satırlarda doğrudan reddedildiği için redundant ceza kaldırıldı.
        
        // --- END CRO STRATEJİ RAPORU KONTROLLERİ ---
        // --- END PERPLEXITY & CHATGPT FILTER ---

        // SONUÇ: TETİKLENME (TRIGGER) - MIXED SCORE SİSTEMİ
        // Eski Sınırlar: LONG 55 | SHORT CONFIG.minScore (55)
        // if (direction === 'LONG' && qualityScore < 55) return null;
        // if (direction === 'SHORT' && qualityScore < CONFIG.minScore) return null;

        // V3.3 (Hacim ve Ağ Optimizasyonu) Yeni Baraj 55 (Ticari Hacmi Koruma Refleksi)
        if (direction === 'LONG' && qualityScore < 55) {
            return null;
        }
        if (direction === 'SHORT' && qualityScore < 55) {
            return null;
        }

        // 🚨 DEMİR BEY (LİKİDİTE VE KAYMA KALKANI - SOFT-FAIL) 🚨
        if (qualityScore >= 55) {
            const demirRes = { scoreMod: 0, msg: "Demir Bey Uyku Modunda (Onaylı)" };
            qualityScore += demirRes.scoreMod;
            if (demirRes.msg) {
                warnings.push(`[Demir Bey: ${demirRes.msg}]`);
            }

            // Demir Bey cezayı kesip baraj altına çekerse iptal et (FOK Koruması)
            if (qualityScore < 55) {
                console.log(`[VETO] ${sym} işlemi Demir Bey'in (Sığ Tahta / Yüksek Spread) cezasıyla sisteme sokulmadı.`);
                return null;
            }
        }

        // Log the detailed summary to console exactly as requested for Backtesting
        console.log(JSON.stringify({
            symbol: sym,
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
            breakdown: breakdown,
            isAsset: symbolInfo.isAsset || false
        };
    } catch (e) {
        // console.error(e);
    }
    return null;
}

let globalBtcPrice = null;
let globalEthPrice = null;
let isScanning = false;

async function runScan() {
    if (isScanning) {
        console.log('[SCANNER] Tarama zaten devam ediyor, atlanıyor...');
        return;
    }
    isScanning = true;

    try {
        console.log('[SCANNER] Starting BingX pairs scan for new signals...');

        // 1. Hedging (Delta-Neutral) için Global Lider Fiyatlarını Önbelleğe Al
        try {
            const [btcRes, ethRes] = await Promise.all([
                axios.get(`https://open-api.bingx.com/openApi/swap/v2/quote/ticker?symbol=BTC-USDT`),
                axios.get(`https://open-api.bingx.com/openApi/swap/v2/quote/ticker?symbol=ETH-USDT`)
            ]);
            if (btcRes.data && btcRes.data.data && btcRes.data.data.lastPrice) globalBtcPrice = parseFloat(btcRes.data.data.lastPrice);
            if (ethRes.data && ethRes.data.data && ethRes.data.data.lastPrice) globalEthPrice = parseFloat(ethRes.data.data.lastPrice);
        } catch (err) {
            console.error("[SCANNER] Sessiz Hata (Hedge API): BTC/ETH anlık fiyat çekimi başarısız.", err.message);
        }

        // 2. Yeni pariteleri tara (Kripto + TradFi Dynamic Engine)
        const { cryptoPairs, tradFiAssets } = await getUsdtPairsAndAssets();
        
        // Akıllı Mesai Kalkanı (Istanbul Timezone: 15:30 - 23:00)
        const istanbulTimeStr = new Date().toLocaleString("en-US", { timeZone: "Europe/Istanbul" });
        const istDate = new Date(istanbulTimeStr);
        const day = istDate.getDay();
        const hour = istDate.getHours();
        const minute = istDate.getMinutes();
        
        const isWeekend = day === 0 || day === 6;
        const timeInMinutes = hour * 60 + minute;
        // 15:30 -> 15*60 + 30 = 930
        // 23:00 -> 23*60 = 1380
        const isInstitutionalHours = timeInMinutes >= 930 && timeInMinutes <= 1380;
        
        const isActiveTradFiSession = false; // KULLANICI TALEBİYLE 3 GÜN UYUTULDU (!isWeekend && isInstitutionalHours)
        const assetsToScan = isActiveTradFiSession ? tradFiAssets : [];

        const allPairs = [...cryptoPairs, ...assetsToScan];
        console.log(`[SCANNER] Found ${cryptoPairs.length} USDT pairs and ${assetsToScan.length} assets to scan${!isActiveTradFiSession ? ' (TradFi Sleep Mode)' : ''}.`);

        let signalCount = 0;

        for (let i = 0; i < allPairs.length; i++) {
            const symbolInfo = allPairs[i];
            const symbol = typeof symbolInfo === 'string' ? symbolInfo : symbolInfo.symbol;

            // Aktif sinyali olan coini tekrar tarayıp yeni sinyal üretmeye gerek yok (Spam önleme)
            const existingActive = await db.get("SELECT id FROM signals WHERE symbol = ? AND status = 'ACTIVE'", [symbol]);
            if (existingActive) continue;

            const signal = await analyzeCoin(symbolInfo);
            if (signal) {
                let formattedVol = '-';
                if (signal.breakdown && signal.breakdown.globalVol) {
                    formattedVol = (signal.breakdown.globalVol / 1000000).toFixed(1) + 'M';
                }
                const volumeTextForDb = signal.breakdown && signal.breakdown.rvol ? `${formattedVol} (${signal.breakdown.rvol}x)` : formattedVol;
                
                // +--- SHADOW BLOCK CHECK (AI MEMORY) ---+
                let isBlocked = false;
                let blockReason = "";
                let blockLessonId = null;
                let telegramLimitWarning = "";

                try {
                    const activeLessons = await db.all("SELECT * FROM ai_lessons WHERE status = 'ACTIVE' ORDER BY id DESC LIMIT 15");
                    
                    if (false && activeLessons && activeLessons.length > 0) { // 3 GÜNLÜK UYKU MODU İÇİN FALSE YAPILDI
                        const lessonsText = activeLessons.map(l => `[Ders ID: ${l.id}] - ${l.lessonText}`).join('\n');
                        const prompt = `Sen PeriskopAI Otonom Fon Yöneticisisin. Sana geçmişteki zararlarımızdan çıkardığımız "KARA LİSTE" dersleri ve şu an girmeyi planladığımız GÜNCEL BİR SİNYAL gönderiyorum.
                        
AKTİF DERSLER (Hafıza):
${lessonsText}

GÜNCEL SİNYAL GİRİŞ HARİTASI:
Varlık: ${signal.symbol}
Yön: ${signal.type}
Toplam Kalite Skoru: ${signal.qualityScore}
Grafik Bileşenleri (Uyarılar): ${signal.warnings}

Soru: Yeni oluşan bu sinyal, Aktif Derslerdeki bir hataya/tuzağa çok benziyor mu?
Eğer bu işlemi RİSKLİ/HATALI buluyorsan ve engellemek istiyorsan sadece "ENGEL: [Hangi Ders ID'si nedeniyle engellediğini ve 1 kısa Cümle Sebebini Yaz]" formatında cevap ver.
Eğer derslerden biriyle doğrudan çelişmiyorsa sadece "ONAY" yaz.`;

                        const blockRes = await aiModel.generateContent(prompt);
                        const blockText = blockRes.response.text();
                        
                        if (blockText.includes("ENGEL:")) {
                            isBlocked = true;
                            blockReason = blockText.split("ENGEL:")[1].trim();
                            const match = blockText.match(/Ders ID:?\s*(\d+)/i) || blockText.match(/Ders.(\d+)/i);
                            if (match) blockLessonId = parseInt(match[1]);
                        }
                    }
                } catch (err) {
                    console.error("[SHADOW] Error checking AI memory:", err.message);
                }

                if (isBlocked) {
                    console.log(`[SHADOW BLOCK] Sinyal Engellendi: ${signal.symbol} -> ${blockReason}`);
                    await db.run(
                        "INSERT INTO shadow_trades (symbol, type, entryPrice, targetPrice, stopPrice, lessonId, qualityScore) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        [signal.symbol, signal.type, signal.entryPrice, signal.targetPrice, signal.stopPrice, blockLessonId, signal.qualityScore]
                    );

                    // Telegram Admin'e Uyarı Gönder
                    if (telegramBot && CONFIG.telegramAdminId) {
                        try {
                            telegramBot.sendMessage(CONFIG.telegramAdminId, `🤖 *Otonom Ajan Sinyali Reddetti (Shadow Mode)* 🤖\n\n🎯 *Parite:* #${signal.symbol} (${signal.type})\n⛔ *Sebep:* ${blockReason}\n\nBu sinyal veritabanına ve gruba düşmedi. Sadece gölge modunda arka planda PnL takibine alındı.`, { parse_mode: 'Markdown' });
                        } catch(e) {}
                    }
                    continue; // Skip DB insertion and everything else
                }
                // +--- END SHADOW BLOCK ---+

                const insertResult = await db.run(
                    "INSERT INTO signals (symbol, type, entryPrice, targetPrice, stopPrice, qualityScore, warnings, rvol) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    [signal.symbol, signal.type, signal.entryPrice, signal.targetPrice, signal.stopPrice, signal.qualityScore, signal.warnings, volumeTextForDb]
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

                    let formattedVolSheet = '-';
                    if (signal.breakdown && signal.breakdown.globalVol) {
                        formattedVolSheet = (signal.breakdown.globalVol / 1000000).toFixed(1) + 'M';
                    }
                    const volumeTextSheet = signal.breakdown && signal.breakdown.rvol ? `${formattedVolSheet} (${signal.breakdown.rvol}x)` : formattedVolSheet;

                    await appendToSheet([
                        dateStr,
                        signal.symbol,
                        signal.qualityScore || 0,
                        signal.type,
                        `%${tpPercent.toFixed(2)}`,
                        `%${slPercent.toFixed(2)}`,
                        'ACTIVE',
                        combinedWarnings,
                        signalId,
                        volumeTextSheet
                    ]);
                } catch (err) {
                    console.error("[SHEETS] Sinyal tabloya yazılamadı:", err);
                }

                // --- AUTO TRADING BLOCK START ---
                if (process.env.BINGX_API_KEY && process.env.PERISKOP_TELEGRAM_ID && !symbolInfo.isAsset) {
                    try {
                        // +--- PORTFOLIO HEDGING & EXPOSURE LIMITS ---+
                        let activeTradesList = await db.all("SELECT * FROM user_trades WHERE status = 'ACTIVE'");
                        let activeCount = activeTradesList.length;
                        
                        let dominantDirection = null; // 'LONG' or 'SHORT'
                        let maxAllowedInThisDirection = 2; // Default if choppy/no leaders

                        let btcEthProfitableLong = false;
                        let btcEthProfitableShort = false;

                        for (const trade of activeTradesList) {
                            if (trade.symbol === 'BTCUSDT' || trade.symbol === 'ETHUSDT') {
                                try {
                                    let cp = null;
                                    if (trade.symbol === 'BTCUSDT') cp = globalBtcPrice;
                                    if (trade.symbol === 'ETHUSDT') cp = globalEthPrice;
                                    
                                    if (cp) {
                                        if (trade.type === 'LONG' && cp > trade.entryPrice) btcEthProfitableLong = true;
                                        if (trade.type === 'SHORT' && cp < trade.entryPrice) btcEthProfitableShort = true;
                                    }
                                } catch(e) {
                                    console.error("[SCANNER] Sessiz Hata (Portfolio):", e.message);
                                }
                            }
                        }

                        if (btcEthProfitableLong) dominantDirection = 'LONG';
                        else if (btcEthProfitableShort) dominantDirection = 'SHORT';

                        let currentDirectionCount = activeTradesList.filter(t => t.type === signal.type).length;
                        
                        if (dominantDirection) {
                            if (signal.type === dominantDirection) {
                                maxAllowedInThisDirection = 5; // Trend Riding
                            } else {
                                maxAllowedInThisDirection = 3; // Hedging (Sigorta)
                            }
                        }

                        if (currentDirectionCount >= maxAllowedInThisDirection) {
                            telegramLimitWarning = `🛡 *Portföy Koruma Kalkanı Devrede*\nOtopilotumuzda hâlihazırda maksimum limite ulaştığımız için (${currentDirectionCount} adet aktif ${signal.type} işlem), bu elit sinyal borsa hesabınızda otomatik olarak AÇILMADI. Riski yönetmek kaydıyla isterseniz işlemi kendiniz manuel olarak açabilirsiniz.`;
                            console.log(`[AUTO-TRADE] Limit (${currentDirectionCount}/${maxAllowedInThisDirection}) dolu! Sinyal Yönü: ${signal.type}. Sinyal havuza eklendi (Macro limit kısıtlaması).`);
                            if (bot && CONFIG.telegramAdminId) {
                                bot.sendMessage(CONFIG.telegramAdminId, `⚠️ *Portföy Riski Koruması*\n\n🎯 #${signal.symbol} elit bir sinyal oluşturdu ancak otopilotta aktif işlem limiti (${currentDirectionCount}/${maxAllowedInThisDirection}) dolduğu için borsa emri AÇILMADI.`);
                            }
                        } else if (activeCount >= CONFIG.maxActiveTrades) {
                            // Genel borsa API patlaması olmasın diye global üst limit de 15 vs olarak korunabilir, ama şimdilik limitleri biz ayarladık.
                            console.log(`[AUTO-TRADE] Global Limit (${CONFIG.maxActiveTrades}) dolu! Sinyal havuza eklendi.`);
                        } else {
                            // Aynı gün içinde aynı coine girildi mi? (Sinyal 2. veya 3. kez mi düşüyor?)
                            const todayStr = new Date().toISOString().split('T')[0];
                            const existingSignalsToday = await db.all(
                                "SELECT id FROM signals WHERE symbol = ? AND date(createdAt) = ?",
                                [signal.symbol, todayStr]
                            );

                            if (existingSignalsToday.length <= 1) {
                                
                                // +--- OTONOM GECİKME (SLIPPAGE/KAYMA) KONTROLÜ ---+
                                let currentLivePrice = signal.entryPrice;
                                let slippageExceeded = false;
                                try {
                                    const res = await axios.get(`https://open-api.bingx.com/openApi/swap/v2/quote/ticker?symbol=${signal.symbol}`);
                                    if (res.data && res.data.data && res.data.data.lastPrice) {
                                        currentLivePrice = parseFloat(res.data.data.lastPrice);
                                        const slippage = Math.abs(currentLivePrice - signal.entryPrice) / signal.entryPrice;
                                        if (slippage > 0.003) {
                                            slippageExceeded = true;
                                        }
                                    }
                                } catch (err) {}

                                if (slippageExceeded) {
                                    console.log(`[AUTO-TRADE] İPTAL! Fiyat Kayması (Slippage) Tespit Edildi: Hedef=${signal.entryPrice}, Güncel=${currentLivePrice}`);
                                    if (bot && CONFIG.telegramAdminId) {
                                        bot.sendMessage(CONFIG.telegramAdminId, `⚠️ *Otonom Karar Gecikmesi Koruma Kalkanı Devrede*\n\n🎯 İşlem: #${signal.symbol} (${signal.type})\nLLM analizi sürerken piyasa %0.3'ten fazla kaydığı (Slippage) için borsa emri otomatik OLARAK AÇILMADI!\n\nSenaryo İptali. Manuel Giriş yapabilirsiniz.`, { parse_mode: 'Markdown' });
                                    }
                                } else {
                                    // +--- DYNAMIC POSITION SIZING (RİSK ÇARPANI VE KALİTE) ---+
                                    let riskMultiplier = 1.0;
                                    try {
                                        if (signal.qualityScore >= 85) riskMultiplier = 1.3;
                                        else if (signal.qualityScore >= 75) riskMultiplier = 1.0;
                                        else if (signal.qualityScore >= 65) riskMultiplier = 0.75;
                                        else riskMultiplier = 0.5;

                                        const history = await db.all("SELECT status FROM user_trades WHERE status IN ('CLOSED_WIN', 'CLOSED_LOSS') ORDER BY closedAt DESC LIMIT 20");
                                        if (history && history.length >= 10) {
                                            const wins = history.filter(h => h.status === 'CLOSED_WIN').length;
                                            const winRate = wins / history.length;
                                            
                                            if (winRate < 0.35) {
                                                riskMultiplier *= 0.5;
                                                console.log(`[DYNAMIC SIZING] Son 20 işlem WR %${Math.round(winRate*100)}! Portföy Defansa Çekildi.`);
                                            } else if (winRate > 0.60) {
                                                riskMultiplier *= 1.5;
                                                console.log(`[DYNAMIC SIZING] Son 20 işlem WR %${Math.round(winRate*100)}! Momentum Sürülüyor.`);
                                            }
                                        }
                                    } catch(e) {}

                                    console.log(`[AUTO-TRADE] Borsaya Emir Gönderiliyor: ${signal.symbol} (Risk x${riskMultiplier})`);
                                    try {
                                        // KULLANICI TALEBİ: Borsaya otopilot emir gönderimi geçici olarak durduruldu.
                                        // Analiz motoru %55 WR seviyesine getirilene kadar sadece sinyal üretmeye devam edecek.
                                        // const orderId = await placeOrder(signal.symbol, signal.type, signal.entryPrice, signal.targetPrice, signal.stopPrice, riskMultiplier);
                                        const orderId = null;
                                        if (orderId) {
                                                await db.run(
                                                    "INSERT INTO user_trades (telegramId, signalId, symbol, type, entryPrice, targetPrice, stopPrice, status, bybitOrderId) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)",
                                                    [process.env.PERISKOP_TELEGRAM_ID, signalId, signal.symbol, signal.type, signal.entryPrice, signal.targetPrice, signal.stopPrice, orderId]
                                                );

                                                // Ekranda favori yıldızı yanması için standart tabloya da yaz
                                                const checkFav = await db.get("SELECT id FROM favorites WHERE telegramId = ? AND signalId = ?", [process.env.PERISKOP_TELEGRAM_ID, signalId]);
                                                if (!checkFav) {
                                                    await db.run("INSERT INTO favorites (telegramId, signalId) VALUES (?, ?)", [process.env.PERISKOP_TELEGRAM_ID, signalId]);
                                                }
                                                console.log(`[AUTO-TRADE] Başarılı! Favorilere kayıt edildi.`);
                                            }
                                        } catch (e) {
                                            console.error(`[AUTO-TRADE] Borsa Emir İletim Hatası:`, e.message);
                                        }
                                    }
                                } else {
                                    console.log(`[AUTO-TRADE] Atlandı: ${signal.symbol} için bugün önceden sinyal üretilmiş (${existingSignalsToday.length}. kez geliyor). Sadece panele yansıtıldı.`);
                                }
                        }
                    } catch (e) {
                        console.error("[AUTO-TRADE] Hata:", e.message);
                    }
                }
                // --- AUTO TRADING BLOCK END ---

                if (telegramBot && process.env.TELEGRAM_VIP_GROUP_ID) {
                    try {
                        const hasFlag = Array.isArray(signal.warnings) ? signal.warnings.some(w => w.includes('Flag')) : (signal.warnings && signal.warnings.includes('Flag'));
                        const flagPart = hasFlag ? `🔥 Formasyon: Bayrak/Flama Modeli Tespit Edildi, +10 Kalite Puanı eklendi.\n\n` : `\n`;
                        const categoryTag = signal.isAsset ? '[VARLIKLAR (FX/Emtia)]' : '[KRİPTO]';
                        
                        let tierTag = signal.qualityScore >= 65 ? '💎 Elit Kurumsal Sinyal' : '⚠️ Standart PA Sinyali';
                        
                        const msg = `🚨 *Elyte Sinyal Uygulaması Üzerinde '${categoryTag}' Kategorisinde Yeni Bir Sinyal Düştü!*\n\n` +
                            `⭐ Kalite Derecesi: *${tierTag}* (Skor: ${signal.qualityScore})\n` +
                            `🎯 Yön: *${signal.type}*\n\n` + flagPart +
                            (telegramLimitWarning ? telegramLimitWarning + `\n\n` : ``) +
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
            if (!detailedData[s.qualityScore]) detailedData[s.qualityScore] = { WIN: 0, LOSS: 0, ACTIVE: 0 };
            detailedData[s.qualityScore][s.status]++;
            if (s.status === 'WIN') totalWins++;
            if (s.status === 'LOSS') totalLosses++;
            if (s.status === 'ACTIVE') totalActive++;
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

        if (telegramBot && process.env.TELEGRAM_VIP_GROUP_ID) {
            await telegramBot.sendMessage(process.env.TELEGRAM_VIP_GROUP_ID, reportText, { parse_mode: 'Markdown' });
            console.log('[SCANNER] Nightly report & Backup status successfully sent to Telegram.');
        }

        let scores = Object.keys(detailedData).sort((a, b) => b - a);
        if (scores.length === 0) {
            reportText += `Dün piyasada pozisyon açılmadı.\n\n`;
        }

        reportText += `_Elyte Signals Otomasyonu ile 03:00'te üretilmiştir._\n\n`;

        // YEDEKLEME İŞLEMİ (Mesajı Gece Raporuna Göm)
        try {
            const backupMessage = await backupSystem();
            reportText += backupMessage;
        } catch (backupErrorStr) {
            reportText += backupErrorStr;
        }



        // --- GOOGLE SHEETS YEDEKLEME (Yeni Yapı) ---
        try {
            const rowsToInsert = [];
            let totalSignalsOfDay = totalWins + totalLosses + totalActive;
            let dayClosed = totalWins + totalLosses;
            let dayWrStr = dayClosed > 0 ? ((totalWins / dayClosed) * 100).toFixed(1) + '%' : '-';

            const ALL_SCORES = [40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];

            for (let i = 0; i < ALL_SCORES.length; i++) {
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

            if (rowsToInsert.length > 0) {
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
    return new Promise((resolve, reject) => {
        console.log('[SCANNER] Starting nightly system backup to Server...');
        try {
            const dateStr = new Date().toISOString().split('T')[0];
            const path = require('path');

            // AWS veya lokal fark etmeksizin root dizinini bul
            const sourceFolder = __dirname;
            const backupDir = path.join(__dirname, '..', 'backups');
            const backupFolder = path.join(backupDir, `ElyteSignal_Backup_${dateStr}`);

            // Klasörü yarat ve yedekle
            const cmd = `mkdir -p "${backupFolder}" && rsync -av --exclude="node_modules" --exclude=".git" --exclude=".expo" "${sourceFolder}/" "${backupFolder}/"`;
            exec(cmd, (error, stdout, stderr) => {
                if (error) {
                    console.error('[SCANNER] Backup Failed:', error.message);
                    reject(`⚠️ *Elyte Sistem Yedekleme Hatası!*\n\`${error.message}\``);
                    return;
                }
                console.log(`[SCANNER] Backup successfully created at: ${backupFolder}`);
                resolve(`📦 *Sistem Yedeği Başarıyla Alındı!*\nKlasör: \`${backupFolder}\`\nDostum, kodların ve sistemin her gece olduğu gibi güvenli sunucu dizinine yedeklendi! 🫡`);
            });
        } catch (e) {
            console.error('[SCANNER] Backup Exception:', e);
            reject(`⚠️ *Elyte Sistem Yedekleme Hatası!*\n\`${e.message}\``);
        }
    });
}

function startScanner() {
    // 1. Aktif pozisyonların Stop/TP durumlarını HER DAKİKA kontrol et
    cron.schedule('* * * * *', () => {
        checkActiveSignals();
    });

    // 2. Yeni sinyal yakalama algoritmasını 5 DAKİKADA BİR çalıştır (Agresif Mid-Hour CHoCH Tespiti)
    cron.schedule('*/5 * * * *', () => {
        runScan();
    });

    // 2.5 Global Market Sensörünü 15 DAKİKADA BİR (Farklı dakikada) çalıştır
    cron.schedule('5,20,35,50 * * * *', () => {
        analyzeGlobalMarket();
    });

    // 3. Gece 03:00'da (Türkiye Saati ile Gün Kapanışı) gecelik rapor yolla ve yedekle (Birleşik Mesaj)
    cron.schedule('0 3 * * *', () => {
        sendNightlyReport();
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
    backfillTrades,
    setBot: (b) => telegramBot = b,
    getGlobalMarketState: () => globalMarketState
};
