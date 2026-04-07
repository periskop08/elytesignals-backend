const yf = require("yahoo-finance2").default;
(async () => {
    try {
        const result = await yf.quoteSummary('AAPL', { modules: ['price', 'defaultKeyStatistics', 'financialData'] });
        console.log("Success", result?.price?.regularMarketPrice);
    } catch(err) {
        console.error(err.message);
    }
})();
