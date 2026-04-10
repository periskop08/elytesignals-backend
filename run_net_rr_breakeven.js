const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');

const db = new sqlite3.Database('./signals.db');

async function fetchForwardCandles(symbol, startTime) {
    try {
        let sym = symbol;
        if(sym.endsWith('-USDT')) sym = sym.replace('-USDT', 'USDT');
        
        // 5 dakikaliK dar mumlarla keskinlik sagla
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
    let stats = { total: rows.length, win: 0, loss: 0, breakeven: 0 };
    let netPNL = 0;
    const FEE_RATE = 0.002;

    for(let row of rows) {
        let entry = row.entryPrice;
        let stop = row.stopPrice;
        let diff = Math.abs(entry - stop);
        let riskPct = (diff / entry) * 100;
        
        // Kural 1: TP mesafesi tam 2 kati (Gross 2.0R)
        let targetDistance = diff * 2.0;
        let newTarget = row.type === 'LONG' ? entry + targetDistance : entry - targetDistance;
        
        // Kural 2: 1R Mesafesinde (Maliyete Stop Cekme Noktasi)
        let oneR_Distance = diff * 1.0;
        let oneR_Price = row.type === 'LONG' ? entry + oneR_Distance : entry - oneR_Distance;
        
        let startMs = new Date(row.createdAt + 'Z').getTime();
        let candles = await fetchForwardCandles(row.symbol, startMs);
        
        let outcome = 'PENDING';
        let stopMovedToEntry = false;
        let currentStop = stop;

        if(candles && candles.length > 0) {
            for(let c of candles) {
                if(row.type === 'LONG') {
                    // Konservatif hesaplama: Ayni mum icinde hem low hem high var
                    if(c.low <= currentStop) { 
                        if(stopMovedToEntry) outcome = 'BREAKEVEN'; else outcome = 'LOSS'; 
                        break; 
                    }
                    if(c.high >= newTarget) { 
                        outcome = 'WIN'; 
                        break; 
                    }
                    if(!stopMovedToEntry && c.high >= oneR_Price) {
                        stopMovedToEntry = true;
                        currentStop = entry; // Maliyete Stop!
                    }
                } else {
                    if(c.high >= currentStop) { 
                        if(stopMovedToEntry) outcome = 'BREAKEVEN'; else outcome = 'LOSS'; 
                        break; 
                    }
                    if(c.low <= newTarget) { 
                        outcome = 'WIN'; 
                        break; 
                    }
                    if(!stopMovedToEntry && c.low <= oneR_Price) {
                        stopMovedToEntry = true;
                        currentStop = entry;
                    }
                }
            }
        }
        
        if (outcome === 'PENDING') outcome = 'LOSS';

        // DINAMIK POZISYON VE ODEME HESAPLARI
        let posSizeUSD = 10 / (riskPct / 100);
        let feeUSD = posSizeUSD * FEE_RATE; // 1R gerceklesmesi icin odedigimiz zorunlu borsa komisyonu!
        
        let netWinAmount = 20.0 - feeUSD; // +20$ Hedef - Komisyon
        let netLossAmount = 10.0 + feeUSD; // -10$ Stop + Komisyon
        let netBreakevenAmount = 0 - feeUSD; // 0$ Kar ama borsa kesintisi yine de var eksi!

        if (outcome === 'WIN') { 
            stats.win++; 
            netPNL += netWinAmount;
        } else if (outcome === 'BREAKEVEN') {
            stats.breakeven++;
            netPNL += netBreakevenAmount; // Sadece komisyon zarari
        } else { 
            stats.loss++; 
            netPNL -= netLossAmount;
        }
        
        await new Promise(r => setTimeout(r, 200)); 
    }

    let grossWinRate = stats.total > 0 ? ((stats.win / stats.total) * 100).toFixed(1) : 0;
    let beRate = stats.total > 0 ? ((stats.breakeven / stats.total) * 100).toFixed(1) : 0;
    
    const output = {
        YONTEM: "Dar Stoplar Dahil, Kâr 2R (Net 1.5R) ve 1R'da Stop to Entry (Başa Baş Maliyet Cekimi)",
        Veritabani_Tum_Sinyaller: stats.total,
        ISLEM_SONUCLARI: {
            "WIN Hedefe Ulasan (20$ Kazanan)": stats.win,
            "BREAKEVEN (Maliyetine Kapanan)": stats.breakeven,
            "LOSS (Hemen Stop Olan)": stats.loss
        },
        ORANLAR: {
            "Kazanc Orani (Saf Win)": `%${grossWinRate}`,
            "Kasanin Korundugu Oran (Win + Breakeven)": `%${(parseFloat(grossWinRate) + parseFloat(beRate)).toFixed(1)}`
        },
        NET_SONUC_KASA_ETKISI: {
            "Guncel PnL Durumu": `${netPNL > 0 ? '+' : ''}$${netPNL.toFixed(2)}`,
            "Not": "Not: Maliyetine kapanan işlemlerde Kâr/Zarar sıfırdır ancak borsa $2-$10 arası komisyon kestiği için kasa eksi yazar."
        }
    };
    
    console.log("=== DB YONETIMI 1R BREAKEVEN SIMULASYONU ===");
    console.log(JSON.stringify(output, null, 2));
});
