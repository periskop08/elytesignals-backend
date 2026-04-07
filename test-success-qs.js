require('dotenv').config();
const crypto = require('crypto');
const API_SECRET = process.env.BINGX_API_SECRET;

const params = {
    symbol: 'BTC-USDT', side: 'BUY', positionSide: 'LONG', type: 'MARKET',
    quantity: '0.0150', timestamp: 1775250351199,
    takeProfit: JSON.stringify({type: 'TAKE_PROFIT_MARKET', stopPrice: 68825.1, workingType: 'MARK_PRICE'})
};
  
const sortedKeys = Object.keys(params).sort();
let rawQs = '';
let encQs = '';
for(const k of sortedKeys) {
   rawQs += k + '=' + params[k] + '&';
   encQs += k + '=' + encodeURIComponent(params[k]) + '&';
}
rawQs = rawQs.slice(0, -1);
encQs = encQs.slice(0, -1);
console.log("TEST_WITH_TP RAW:", rawQs);
console.log("TEST_WITH_TP ENC:", encQs);
