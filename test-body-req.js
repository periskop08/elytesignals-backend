require('dotenv').config();
const crypto = require('crypto');
const axios = require('axios');
const API_SECRET = process.env.BINGX_API_SECRET;
const API_KEY = process.env.BINGX_API_KEY;

async function run() {
  const params = {
      symbol: 'BTC-USDT', side: 'BUY', positionSide: 'LONG', type: 'MARKET',
      quantity: '0.0150', timestamp: Date.now(),
      takeProfit: JSON.stringify({type: 'TAKE_PROFIT_MARKET', stopPrice: 68825.1, workingType: 'MARK_PRICE'}),
      stopLoss: JSON.stringify({type: 'STOP_MARKET', stopPrice: 66152.3, workingType: 'MARK_PRICE'})
  };
    
  const sortedKeys = Object.keys(params).sort();
  let rawQs = '';
  for(const k of sortedKeys) {
     rawQs += k + '=' + params[k] + '&';
  }
  rawQs = rawQs.slice(0, -1);
  const sign1 = crypto.createHmac('sha256', API_SECRET).update(rawQs).digest('hex'); 
  
  // SEND IN BODY, NOT IN URL (only signature and timestamp maybe?)
  // Actually, usually in Binance, you can send query string entirely in body for POST:
  const url = "https://open-api.bingx.com/openApi/swap/v2/trade/order?signature=" + sign1;
  const url2 = "https://open-api.bingx.com/openApi/swap/v2/trade/order?" + rawQs + "&signature=" + sign1; // body empty

  try {
     const res = await axios.post(url, params, { headers: {"X-BX-APIKEY": API_KEY, "Content-Type":"application/json"} });
     console.log("Body JSON:", res.data);
  } catch(e) { console.error("Error Body:", e.response?.data); }
}
run();
