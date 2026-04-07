const yahooFinance = require('yahoo-finance2').default;
async function test() {
   const quote = await yahooFinance.quoteSummary('NVDA', { modules: ['financialData', 'price'] });
   console.log(quote);
}
test();
