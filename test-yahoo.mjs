import yahooFinance from 'yahoo-finance2';
async function test() {
    try {
        const queryOptions = { period1: '2024-03-01', interval: '1h' };
        const result = await yahooFinance.chart('AAPL', queryOptions);
        console.log('Success! AAPL Points:', result.quotes.length);
        console.log('Sample Quote:', result.quotes[result.quotes.length-1]);
    } catch(e) {
        console.log('Error:', e.message);
    }
}
test();
