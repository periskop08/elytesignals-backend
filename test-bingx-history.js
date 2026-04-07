const { makePrivateRequest } = require('./bingx-trade');
require('dotenv').config();

async function run() {
    console.log("Fetching order history...");
    try {
        // Query /openApi/swap/v2/trade/allOrders
        const axios = require('axios');
        const crypto = require('crypto');
        
        const API_KEY = process.env.BINGX_API_KEY;
        const API_SECRET = process.env.BINGX_API_SECRET;
        const BASE_URL = 'https://open-api.bingx.com';

        function getSignature(queryString, secret) {
            return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
        }

        async function fetchPrivate(endpoint, params = {}) {
            params.timestamp = Date.now();
            const sortedKeys = Object.keys(params).sort();
            let queryString = '';
            for (const key of sortedKeys) {
                if (params[key] !== undefined && params[key] !== null) {
                    queryString += `${key}=${params[key]}&`;
                }
            }
            queryString = queryString.substring(0, queryString.length - 1);
            const signature = getSignature(queryString, API_SECRET);
            let reqQueryString = '';
            for (const key of sortedKeys) {
                if (params[key] !== undefined && params[key] !== null) {
                    reqQueryString += `${key}=${encodeURIComponent(params[key])}&`;
                }
            }
            reqQueryString = reqQueryString.substring(0, reqQueryString.length - 1);
            try {
                const res = await axios({
                    method: 'GET',
                    url: `${BASE_URL}${endpoint}?${reqQueryString}&signature=${signature}`,
                    headers: { 'X-BX-APIKEY': API_KEY }
                });
                return res.data;
            } catch(e){
                console.error(e.response ? e.response.data : e.message);
                return null;
            }
        }

        // Test past orders
        const orders = await fetchPrivate('/openApi/swap/v2/trade/allOrders', { symbol: 'BTC-USDT', limit: 10 });
        console.log("All Orders Sample: ", JSON.stringify(orders?.data?.orders?.slice(0, 1), null, 2));

        // Test income (fee/funding/pnl)
        const income = await fetchPrivate('/openApi/swap/v2/user/income', { symbol: 'BTC-USDT', limit: 10 });
        console.log("Income Sample: ", JSON.stringify(income?.data?.slice(0, 3), null, 2));

    } catch (e) {
        console.error(e);
    }
}
run();
