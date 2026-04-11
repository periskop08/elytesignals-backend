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
            
            const insertSignal = db.prepare(`
                INSERT INTO signals (id, symbol, type, entryPrice, targetPrice, stopPrice, status, warnings, createdAt, reachedTwoPercent, qualityScore, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            let activeCount = 0;
            let closedCount = 0;

            rows.forEach((row, index) => {
                const dateStr = row[0];
                const symbol = row[1];
                const type = row[3];
                const status = row[6] || 'ACTIVE';
                const id = row[8] ? parseInt(row[8], 10) : (index + 1);
                
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

                const entryPrice = 100;
                const tpVal = row[4] ? parseFloat(row[4].replace('%', '')) : 2.0;
                const slVal = row[5] ? parseFloat(row[5].replace('%', '')) : 0.88;
                const targetPrice = type === 'LONG' ? entryPrice * (1 + tpVal/100) : entryPrice * (1 - tpVal/100);
                const stopPrice = type === 'LONG' ? entryPrice * (1 - slVal/100) : entryPrice * (1 + slVal/100);
                const qualityScore = row[2] ? parseInt(row[2], 10) : 50;
                const reachedTwoPercent = status === 'WIN' ? 1 : 0; // Guess that winning ones reached it

                insertSignal.run(id, symbol, type, entryPrice, targetPrice, stopPrice, status, row[7] || "[]", createdAt, reachedTwoPercent, qualityScore, closeTime);

                if (status === 'ACTIVE') {
                    activeCount++;
                } else {
                    closedCount++;
                }
            });

            insertSignal.finalize();

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
