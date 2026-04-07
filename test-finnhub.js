const axios = require('axios');
const API_KEY = 'd77hh61r01qp6aflll80d77hh61r01qp6aflll8g';

async function testFinnhub() {
    try {
        // Test AAPL (Stock)
        const to = Math.floor(Date.now() / 1000);
        const from = to - (30 * 24 * 60 * 60);
        const resAAPL = await axios.get(`https://finnhub.io/api/v1/stock/candle?symbol=AAPL&resolution=60&from=${from}&to=${to}&token=${API_KEY}`);
        console.log('AAPL Status:', resAAPL.data.s === 'ok' ? 'OK (Found)' : resAAPL.data.s);
        
        // Test Forex / Commodity format mapping usually OANDA or ICE
        // EUR/USD is usually OANDA:EUR_USD or BINANCE:EURUSDT
        const resForex = await axios.get(`https://finnhub.io/api/v1/forex/candle?symbol=OANDA:EUR_USD&resolution=60&from=${from}&to=${to}&token=${API_KEY}`);
        console.log('EUR_USD Status:', resForex.data.s === 'ok' ? 'OK (Found)' : resForex.data.s);

        const resGold = await axios.get(`https://finnhub.io/api/v1/forex/candle?symbol=OANDA:XAU_USD&resolution=60&from=${from}&to=${to}&token=${API_KEY}`);
        console.log('XAU_USD Status:', resGold.data.s === 'ok' ? 'OK (Found)' : resGold.data.s);
        
        const resOil = await axios.get(`https://finnhub.io/api/v1/forex/candle?symbol=OANDA:WTICO_USD&resolution=60&from=${from}&to=${to}&token=${API_KEY}`);
        console.log('Oil Status:', resOil.data.s === 'ok' ? 'OK (Found)' : resOil.data.s);

    } catch(e) {
        console.error('API Error:', e.response ? e.response.data : e.message);
    }
}
testFinnhub();
