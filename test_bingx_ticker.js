const axios = require('axios');
async function test() {
    try {
        const res = await axios.get('https://open-api.bingx.com/openApi/swap/v2/quote/ticker');
        console.log("Status:", res.status);
        console.log("Data keys:", Object.keys(res.data));
        console.log("Is array?", Array.isArray(res.data.data));
        if (!Array.isArray(res.data.data)) {
            console.log("Data payload:", res.data);
        }
    } catch(e) {
        console.log("Err:", e.message);
        if (e.response) {
            console.log("Err data:", e.response.data);
        }
    }
}
test();
