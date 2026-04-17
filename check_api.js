const axios = require('axios');
axios.get('https://open-api.bingx.com/openApi/swap/v3/quote/klines?symbol=BTC-USDT&interval=1h&limit=5')
.then(x => console.log(x.data.data))
.catch(e => console.log(e));
