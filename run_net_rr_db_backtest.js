const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');

const db = new sqlite3.Database('./signals.db');

async function fetchForwardCandles(symbol, startTime) {
    try {
        let sym = symbol;
        if(sym.endsWith('-USDT')) sym = sym.replace('-USDT', 'USDT');
        
        const res = await axios.get(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=5m&startTime=${startTime}&limit=1000`);
        let list = res.data;
        return list.map(k => ({
            time: k[0],
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4])
        }));
    } catch(e) {
        return null;
    }
}

db.all(`SELECT symbol, type, entryPrice, stopPrice, targetPrice, status, createdAt FROM signals WHERE status IN ('WIN','LOSS') ORDER BY createdAt ASC`, [], async (err, rows) => {
    if (err) throw err;
    let stats = { total: rows.length, rejected: 0, tested: 0, win: 0, loss: 0, 
                  oldWin: 0, oldLoss: 0, oldTotal: 0 };
    let netPNL = 0;
    const FEE_RATE = 0.002;

    for(let row of rows) {
        let entry = row.entryPrice;
        let stop = row.stopPrice;
        let diff = Math.abs(entry - stop);
        let riskPct = (diff / entry) * 100;
        
        let oldOutcome = row.status;
        if (oldOutcome === 'WIN') stats.oldWin++;
        if (oldOutcome === 'LOSS') stats.oldLoss++;
        stats.oldTotal++;

        if (riskPct < 1.0) {
            stats.rejected++;
            continue;
        }

        stats.tested++;
        let targetReward = diff * 2.0;
        let newTarget = row.type === 'LONG' ? entry + targetReward : entry - targetReward;
        
        let startMs = new Date(row.createdAt + 'Z').getTime();
        let candles = await fetchForwardCandles(row.symbol, startMs);
        
        let outcome = 'PENDING';
        if(candles && candles.length > 0) {
            for(let c of candles) {
                if(row.type === 'LONG') {
                    if(c.low <= stop) { outcome = 'LOSS'; break; }
                    else if(c.high >= newTarget) { outcome = 'WIN'; break; }
                } else {
                    if(c.high >= stop) { outcome = 'LOSS'; break; }
                    else if(c.low <= newTarget) { outcome = 'WIN'; break; }
                }
            }
        }
        
        if (outcome === 'PENDING') {
           // If we couldn't fetch candles or it didn't hit yet within 1000 candles (5m * 1000 = ~3.5 days), 
           // we assume it failed to hit our big 2.0R target and eventually stopped out.
           outcome = 'LOSS'; 
        }

        let posSizeUSD = 10 / (riskPct / 100);
        let feeUSD = posSizeUSD * FEE_RATE;
        let netWinAmount = 20.0 - feeUSD; 
        let netLossAmount = 10.0 + feeUSD;

        if (outcome === 'WIN') { 
            stats.win++; 
            netPNL += netWinAmount;
        } else { 
            stats.loss++; 
            netPNL -= netLossAmount;
        }
        
        await new Promise(r => setTimeout(r, 200)); // anti-spam
    }

    let wR = stats.tested > 0 ? ((stats.win / stats.tested) * 100).toFixed(1) : 0;
    
    const output = {
        DB_Analiz_Edilen_Toplam_Sinyal: stats.total,
        Reddedilenler_Dar_Stoplu_1_Yuzdenin_Alti: stats.rejected,
        Test_Edilen_Kurallara_Uygun_Sinyaller: stats.tested,
        Sistemin_O_Islemlerdeki_Mevcut_Gercek_Hali: `WIN: ${stats.oldWin} | LOSS: ${stats.oldLoss} | WinRate: %${((stats.oldWin/stats.oldTotal)*100).toFixed(1)}`,
        YENI_DINAMIK_IKIKATI_SIMULASYON: {
            "Kurala Uyup Giris Yapilan Islem": stats.tested,
            "WIN (Yeni 2.0R Hedefe Ulasan)": stats.win,
            "LOSS (Stop Olan)": stats.loss,
            "Yeni Kazanma Orani": `%${wR}`,
            "NET KASA ETKISI (Mantiklica $10 Riske Edip Beklenen Durum)": `${netPNL > 0 ? '+' : ''}$${netPNL.toFixed(2)}`
        }
    };
    
    console.log("=== YEREL VERITABANI SINYALLERI RE-SIMULASYONU ===");
    console.log(JSON.stringify(output, null, 2));
});
