const { RestClientV5 } = require('bybit-api');
const bybitClient = new RestClientV5({ enable_time_sync: true });

async function check() {
    try {
        console.log("Fetching live Bybit data for BTCUSDT...");
        const result = await bybitClient.getKline({
            category: 'linear',
            symbol: 'BTCUSDT',
            interval: '60',
            limit: 2
        });
        const list = result.result.list;
        console.log("Son Mum:", list[0]);
        console.log("Önceki Mum:", list[1]);
        if (list[0][4] === list[1][4]) {
            console.log("UYARI: Fiyatlar donmuş olabilir!");
        } else {
            console.log("Veri akışı SAĞLIKLI.");
        }
    } catch (e) {
        console.log("HATA:", e);
    }
}
check();
