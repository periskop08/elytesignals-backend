require('dotenv').config();
const crypto = require('crypto');
const axios = require('axios');
const API_KEY = process.env.BINGX_API_KEY;
const API_SECRET = process.env.BINGX_API_SECRET;

async function test() {
  const params = {
    symbol: 'BTC-USDT', side: 'BUY', positionSide: 'LONG', type: 'MARKET',
    quantity: '0.0150', timestamp: Date.now()
  };
  const qs = Object.keys(params).sort().map(k => k + '=' + params[k]).join('&');
  const sign = crypto.createHmac('sha256', API_SECRET).update(qs).digest('hex'); 
  const url = 'https://open-api.bingx.com/openApi/swap/v2/trade/order?' + qs + '&signature=' + sign;
  
  try {
    const res = await axios.post(url, null, { headers: { 'X-BX-APIKEY': API_KEY } });
    console.log('SUCCESS:', res.data);
  } catch(e) { console.error('FAIL:', e.response?.data); }
}
test();
