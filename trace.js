const axios = require('axios');
const path = require('path');

// MOCK CONSTANTS
const sym = "ORDIUSDT";
const CONFIG = { obLookback: 30 };

async function fetchCandles(symbol, interval, limit) {
    try {
        const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`;
        const { data } = await axios.get(url);
        if (!data || !data.result || !data.result.list) return null;
        return data.result.list.reverse().map(k => ({
            time: parseInt(k[0]),
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5]),
            turnover: parseFloat(k[6])
        }));
    } catch(e) {
        console.error("fetchCandles Error:", e.message);
        return null;
    }
}

async function runDiag() {
    console.log(`Starting diag for ${sym}...`);
    try {
        const url = `https://api.bybit.com/v5/market/tickers?category=linear`;
        const { data } = await axios.get(url);
        const ticker = data.result.list.find(x => x.symbol === sym);
        if (!ticker) {
            console.log("Ticker not found for", sym);
            return;
        }

        const globalVol = parseFloat(ticker.volume24h);
        const turnover = parseFloat(ticker.turnover24h);
        console.log(`Global volume24h: ${globalVol}, Turnover: ${turnover}`);

        // Checking volume filter
        let direction = 'LONG'; // Assume long
        if (globalVol < 4000000) {
            console.log(`Bailed on globalVol filter for LONG: ${globalVol} < 4,000,000`);
            // IT WILL FAIL HERE IF VOLUME24H IS MEASURED IN COINS
        }

        const klinesFull = await fetchCandles(sym, 60, 250);
        if (!klinesFull || klinesFull.length < 200) {
            console.log("Bailed: Not enough candles");
            return;
        }
        
        console.log("Diag completed to the end.");
    } catch(e) {
        console.error(e);
    }
}
runDiag();
