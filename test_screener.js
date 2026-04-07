const yf = require("yahoo-finance2").default;
(async () => {
    try {
        const queryOptions = { scrIds: 'day_gainers', count: 3 }; 
        const result = await yf.screener(queryOptions);
        console.log(result.quotes.map(q => q.symbol));
    } catch(err) {
        console.error(err.message);
    }
})();
