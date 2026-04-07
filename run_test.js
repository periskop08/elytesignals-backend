const { analyzeCoin } = require('./scanner_test');
async function run() {
   const c = await analyzeCoin('BTCUSDT');
   console.log("BTC Analyze result:", c);
}
run();
