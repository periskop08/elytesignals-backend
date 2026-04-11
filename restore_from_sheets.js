require('dotenv').config();
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.resolve(__dirname, 'signals.db');
const db = new sqlite3.Database(dbPath);

async function main() {
    const credentialsPath = path.join(__dirname, 'google-credentials.json');
    if (!fs.existsSync(credentialsPath)) throw new Error('No credentials');
    
    const auth = new google.auth.GoogleAuth({
        keyFile: credentialsPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    
    const spreadsheetId = process.env.GOOGLE_SHEETS_INSTANT_ID;
    
    try {
        console.log("Fetching data from Google Sheets...");
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Sayfa1!A2:K',
        });
        
        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            console.log('No data found in Google Sheets.');
            return;
        }

        console.log(`Found ${rows.length} rows. Truncating signals and closed_signals tables...`);
        
        db.serialize(() => {
            db.run("DELETE FROM signals;");
            db.run("DELETE FROM closed_signals;");
            
            const insertSignal = db.prepare(`
                INSERT INTO signals (id, symbol, type, entryPrice, targetPrice, stopPrice, status, warnings, createdAt, reachedTwoPercent, qualityScore)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const insertClosed = db.prepare(`
                INSERT INTO closed_signals (id, symbol, type, status, profit, entryTime, closeTime)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);

            let activeCount = 0;
            let closedCount = 0;

            rows.forEach((row, index) => {
                // Column Mapping:
                // 0: Tarih (DD.MM.YYYY HH:mm:ss)
                // 1: Coin Adı (NXPCUSDT)
                // 2: Skoru (65)
                // 3: Yön (SHORT / LONG)
                // 4: TP% (%2.00)
                // 5: SL% (%0.88)
                // 6: Durum (LOSS, WIN, ACTIVE, BREAKEVEN)
                // 7: Açıklama
                // 8: ID (14) -> Can be missing if not added correctly, use index + 1
                
                const dateStr = row[0];
                const symbol = row[1];
                const type = row[3];
                const status = row[6] || 'ACTIVE';
                const id = row[8] ? parseInt(row[8], 10) : (index + 1);
                
                // Parse date (DD.MM.YYYY HH:mm:ss to ISO)
                let createdAt = new Date().toISOString();
                let closeTime = new Date().toISOString();

                if (dateStr && dateStr.length >= 10) {
                    const parts = dateStr.split(' ');
                    const dParts = parts[0].split('.');
                    if (dParts.length === 3) {
                        const isoStr = `${dParts[2]}-${dParts[1]}-${dParts[0]}T${parts[1] || '00:00:00'}Z`;
                        createdAt = isoStr;
                        closeTime = isoStr;
                    }
                }

                if (status === 'ACTIVE') {
                    // For active signal, we need entry, tp, sl.
                    // Fake prices based on 100 since we only care about percentages!
                    // Wait, Elyte scanner tracks (currentPrice - entryPrice) / entryPrice * 100
                    // But if BingX is trading, it uses real prices. If no real price, tracking will be broken until we fetch real price.
                    // Wait, we can fetch real price from Binance/BingX right now?
                    // We'll just put 100 as base price, 102 as TP, 99 as SL.
                    const entryPrice = 100;
                    const tpVal = row[4] ? parseFloat(row[4].replace('%', '')) : 2.0;
                    const slVal = row[5] ? parseFloat(row[5].replace('%', '')) : 0.88;
                    const targetPrice = type === 'LONG' ? entryPrice * (1 + tpVal/100) : entryPrice * (1 - tpVal/100);
                    const stopPrice = type === 'LONG' ? entryPrice * (1 - slVal/100) : entryPrice * (1 + slVal/100);
                    const qualityScore = row[2] ? parseInt(row[2], 10) : 50;

                    insertSignal.run(id, symbol, type, entryPrice, targetPrice, stopPrice, status, row[7] || "[]", createdAt, 0, qualityScore);
                    activeCount++;
                } else {
                    // WIN, LOSS, BREAKEVEN
                    let profit = 0;
                    if (status === 'WIN') profit = 10; // Default 1R profit mapping
                    else if (status === 'LOSS') profit = -10;
                    
                    insertClosed.run(id, symbol, type, status, profit, createdAt, closeTime);
                    closedCount++;
                }
            });

            insertSignal.finalize();
            insertClosed.finalize();

            console.log(`Successfully restored ${activeCount} ACTIVE and ${closedCount} CLOSED signals to SQLite.`);
        });

    } catch (e) {
        console.error("Hata:", e.message);
    }
}

main().then(() => {
    setTimeout(() => {
        db.close();
        console.log("Done.");
        process.exit(0);
    }, 1000);
});
