const axios = require('axios');
const { ADX } = require('technicalindicators');

async function testCommonCoins() {
    console.log('Fetching BingX & ByBit coins...');
    try {
        let bingxSymbols = [];
        try {
            const bingxRes = await axios.get('https://open-api.bingx.com/openApi/swap/v2/quote/contracts');
            bingxSymbols = bingxRes.data.data.map(c => c.symbol).filter(c => c.endsWith('-USDT')).map(c => c.replace('-', ''));
        } catch(e) {
            console.log("BingX API failed, defaulting to 250 test coins.");
            bingxSymbols = Array.from({length: 250}, (_, i) => \`TEST\${i}USDT\`);
        }

        const bybitRes = await axios.get('https://api.bybit.com/v5/market/tickers?category=linear');
        const bybitSymbols = bybitRes.data.result.list.map(s => s.symbol).filter(s => s.endsWith('USDT'));
        
        let commonCoins;
        if (bingxSymbols[0] && bingxSymbols[0].startsWith('TEST')) {
             commonCoins = bybitSymbols.slice(0, 250); // Fallback if Bingx fails
        } else {
             commonCoins = bybitSymbols.filter(sym => bingxSymbols.includes(sym));
        }

        console.log(\`Found \${commonCoins.length} common coins. Testing...\`);
        
        let checked = 0;
        let adxFailures = 0;
        let oteFailures = 0;
        let wickFailures = 0;
        let passed = 0;

        for (const sym of commonCoins) {
            try {
                const klineRes = await axios.get(\`https://api.bybit.com/v5/market/kline?category=linear&symbol=\${sym}&interval=60&limit=150\`);
                if (!klineRes.data || !klineRes.data.result || !klineRes.data.result.list) continue;
                const d = klineRes.data.result.list.reverse();
                if (d.length < 100) continue;
                checked++;
                
                const opens = d.map(k => parseFloat(k[1]));
                const highs = d.map(k => parseFloat(k[2]));
                const lows = d.map(k => parseFloat(k[3]));
                const closes = d.map(k => parseFloat(k[4]));
                
                const currentPrice = closes[closes.length - 1];
                const currentHigh = highs[highs.length - 1];
                const currentLow = lows[lows.length - 1];
                const currentOpen = opens[opens.length - 1];

                const adxRes = ADX.calculate({high: highs, low: lows, close: closes, period: 14});
                const currentADX = adxRes.length > 0 ? adxRes[adxRes.length - 1].adx : 0;

                const subLows = lows.slice(-20);
                const subHighs = highs.slice(-20);
                const subRangeLow = Math.min(...subLows);
                const subRangeHigh = Math.max(...subHighs);
                const oteShort = subRangeLow + (subRangeHigh - subRangeLow) * 0.618;
                const oteLong = subRangeLow + (subRangeHigh - subRangeLow) * 0.382;

                if (currentADX < 15 || currentADX > 25) {
                    adxFailures++;
                    continue;
                }

                let touchedOTE = false;
                let passedWick = false;
                
                if (currentHigh >= oteShort && currentPrice < subRangeHigh) {
                    touchedOTE = true;
                    const wickSize = currentHigh - Math.max(currentOpen, currentPrice);
                    const bodySize = Math.abs(currentPrice - currentOpen) || 0.0001;
                    if (wickSize > bodySize * 1.2) { passedWick = true; passed++; }
                }
                
                if (currentLow <= oteLong && currentPrice > subRangeLow) {
                    touchedOTE = true;
                    const wickSize = Math.min(currentOpen, currentPrice) - currentLow;
                    const bodySize = Math.abs(currentPrice - currentOpen) || 0.0001;
                    if (wickSize > bodySize * 1.2) { passedWick = true; passed++; }
                }

                if (!touchedOTE) oteFailures++;
                else if (!passedWick) wickFailures++;

            } catch (e) { }
            // small delay to prevent rate limit
            await new Promise(r => setTimeout(r, 20));
        }
        
        console.log('--- COMMON COINS DIAGNOSTIC ---');
        console.log('Total Common Coins:', commonCoins.length);
        console.log('Successfully Checked:', checked);
        console.log('ADX Failures (<15 or >25):', adxFailures);
        console.log('Did not touch OTE Zone:', oteFailures);
        console.log('Touched OTE, but Wick too small:', wickFailures);
        console.log('PASSED SUB-RANGE SWEEP:', passed);

    } catch(e) { console.error(e); }
}
testCommonCoins();
