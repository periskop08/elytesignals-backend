const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const path = require('path');

const dbPath = path.join(__dirname, 'signals.db');
const db = new sqlite3.Database(dbPath);

async function closeActiveSignals() {
    console.log("Fetching active signals...");
    db.all("SELECT id, symbol, type, entryPrice, targetPrice, stopPrice FROM signals WHERE status = 'ACTIVE'", [], async (err, activeSignals) => {
        if (err) { console.error(err); return; }
        if (activeSignals.length === 0) { console.log("No active signals found."); return; }

        console.log(`Found ${activeSignals.length} active signals. Fetching Bybit prices...`);
        try {
            const bybitRes = await axios.get('https://api.bybit.com/v5/market/tickers?category=linear');
            const priceMap = {};
            bybitRes.data.result.list.forEach(t => priceMap[t.symbol] = parseFloat(t.lastPrice));

            try {
                const bingxRes = await axios.get('https://open-api.bingx.com/openApi/swap/v2/quote/ticker');
                if (bingxRes.data && bingxRes.data.data) {
                    bingxRes.data.data.forEach(t => {
                        const sym = t.symbol.replace('-', '');
                        if (!priceMap[sym]) {
                            priceMap[sym] = parseFloat(t.lastPrice);
                        }
                    });
                }
            } catch (err) {
                console.error("BingX price fetch error:", err.message);
            }

            let processed = 0;
            console.log("Processing trades...");

            db.serialize(() => {
                const stmt1 = db.prepare("UPDATE signals SET status = ? WHERE id = ?");
                const stmt2 = db.prepare("UPDATE user_trades SET status = 'CLOSED' WHERE signalId = ?");

                for (let s of activeSignals) {
                    const currentPrice = priceMap[s.symbol];
                    if (!currentPrice) continue;

                    let finalStatus = 'BREAKEVEN';
                    const pnl = s.type === 'LONG' 
                        ? ((currentPrice - s.entryPrice) / s.entryPrice) * 100 
                        : ((s.entryPrice - currentPrice) / s.entryPrice) * 100;
                    
                    if (pnl > 0.5) finalStatus = 'WIN';
                    else if (pnl < -0.5) finalStatus = 'LOSS';

                    stmt1.run([finalStatus, s.id]);
                    stmt2.run([s.id]);
                    processed++;
                    console.log(`Closed ${s.symbol} [${s.type}] at ${currentPrice} | PnL: ${pnl.toFixed(2)}% -> ${finalStatus}`);
                }

                stmt1.finalize();
                stmt2.finalize();
                console.log(`\nSuccessfully closed ${processed} active signals and injected their stats to the Database!`);
            });

        } catch(e) {
            console.error("Error fetching prices:", e.message);
        }
    });
}
closeActiveSignals();
