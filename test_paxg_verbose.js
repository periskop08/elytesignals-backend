const axios = require('axios');
const fs = require('fs');
const scanner = require('./scanner');

async function testVerbose() {
    console.log("Fetching BingX Ticker for PAXG-USDT...");
    const symInfo = { symbol: 'PAXG-USDT', volume: 9600000 };
    
    // We will bypass `analyzeCoin` and just fetch candles and do the raw math locally to print it!
    // Since scanner.fetchCandles is not exported, we copy its implementation or just do axios get:
    try {
        const res = await axios.get(`https://open-api.bingx.com/openApi/swap/v3/quote/klines?symbol=PAXG-USDT&interval=1h&limit=100`);
        let list = res.data.data;
        if (!list || list.length < 100) {
            console.log("Not enough klines. Length:", list ? list.length : 'null');
            return;
        }
        list.sort((a,b) => a.time - b.time);
        const klines = list.map(k => ({
            open: parseFloat(k.open), 
            high: parseFloat(k.high), 
            low: parseFloat(k.low), 
            close: parseFloat(k.close), 
            volume: parseFloat(k.volume), 
            date: parseInt(k.time)
        }));
        
        const opens = klines.map(k => k.open);
        const highs = klines.map(k => k.high);
        const lows = klines.map(k => k.low);
        const closes = klines.map(k => k.close);
        const volumes = klines.map(k => k.volume);
        
        const currentPrice = closes[closes.length - 1];
        console.log("Current Price:", currentPrice);
        
        const recentLows = lows.slice(-6);
        const recentHighs = highs.slice(-6);
        let recentMin = Math.min(...recentLows);
        let recentMax = Math.max(...recentHighs);
        const rangeHigh = Math.max(...highs);
        const rangeLow = Math.min(...lows);
        
        console.log("Range Low:", rangeLow, "Range High:", rangeHigh);
        console.log("Recent Min (last 6):", recentMin, "Recent Max:", recentMax);
        console.log("Target for LONG dipDeviation (recentMin <= rangeLow * 1.005):", rangeLow * 1.005);
        
        if (recentMin <= rangeLow * 1.005) {
            let sweepIdx = lows.lastIndexOf(recentMin);
            console.log("sweepIdx for LONG:", sweepIdx, "High of sweep candle:", highs[sweepIdx]);
            console.log("Is currentPrice > high of sweep candle?", currentPrice > highs[sweepIdx]);
        }
        
    } catch(e) {
        console.error(e);
    }
}
testVerbose();
