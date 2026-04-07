const axios = require('axios');
const path = require('path');
const YahooFinanceClass = require('yahoo-finance2').default;
const yahooFinance = new YahooFinanceClass();

async function start() {
    try {
        let quotes = await yahooFinance.chart('GC=F', { period1: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), interval: '1h' });
        console.log("Quotes size:", quotes.quotes.length);
    } catch(e) {
        console.error("ERROR running yahooFinance.chart!");
        console.error(e);
    }
}
start();
