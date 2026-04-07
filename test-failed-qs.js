require('dotenv').config();
const axios = require('axios');
const API_KEY = process.env.BINGX_API_KEY;

async function run() {
  const url = "https://open-api.bingx.com/openApi/swap/v2/trade/order?positionSide=LONG&quantity=0.0150&side=BUY&stopLoss=%7B%22type%22%3A%22STOP_MARKET%22%2C%22stopPrice%22%3A66152.3%2C%22workingType%22%3A%22MARK_PRICE%22%7D&symbol=BTC-USDT&takeProfit=%7B%22type%22%3A%22TAKE_PROFIT_MARKET%22%2C%22stopPrice%22%3A68825.1%2C%22workingType%22%3A%22MARK_PRICE%22%7D&timestamp=1775250351199&type=MARKET&signature=45900a9a33853a3885999287cdcf64871cfaa8bd8a2d11da54035696d4139146";
  try {
     const res = await axios.post(url, null, { headers: {"X-BX-APIKEY": API_KEY, "Content-Type":"application/json"} });
     console.log(res.data);
  } catch(e) { console.error("Error:", e.response?.data); }
}
run();
