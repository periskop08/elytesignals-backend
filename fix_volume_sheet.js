const { google } = require('googleapis');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const dbPath = path.join(__dirname, 'ElyteSignalsDB.sqlite');
const db = new sqlite3.Database(dbPath);

async function main() {
    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: path.join(__dirname, 'google-credentials.json'),
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });
        const c = await auth.getClient();
        const s = google.sheets({version: 'v4', auth: c});
        const spreadsheetId = process.env.GOOGLE_SHEETS_INSTANT_ID;

        // Fetch sheet
        const sheetRes = await s.spreadsheets.values.get({
            spreadsheetId,
            range: 'Sayfa1!A:J'
        });
        const rows = sheetRes.data.values;
        if (!rows || rows.length === 0) { console.log("Empty sheet"); return; }

        console.log("Found rows:", rows.length);

        // Fetch db
        db.all("SELECT id, signalData FROM saved_signals", [], async (err, dbRows) => {
            if (err) { console.error("DB error", err); return; }
            
            const dbMap = {};
            for (const r of dbRows) {
                if (r.signalData) {
                    try {
                        const parsed = JSON.parse(r.signalData);
                        if (parsed.breakdown && parsed.breakdown.rvol) {
                            dbMap[r.id] = parsed.breakdown.rvol;
                        }
                    } catch(e) {}
                }
            }

            const updates = [];
            for (let i = 1; i < rows.length; i++) { // skip header
                const rowId = rows[i][8]; // Column I (index 8) is ID
                const rvolValue = rows[i][9]; // Column J (index 9) is Sinyal Hacimi
                if (rowId && dbMap[rowId] && !rvolValue) { // update only if empty
                    const val = dbMap[rowId] + 'x';
                    updates.push({
                        range: `Sayfa1!J${i + 1}`,
                        values: [[val]]
                    });
                }
            }

            if (updates.length > 0) {
                console.log(`Updating ${updates.length} rows...`);
                await s.spreadsheets.values.batchUpdate({
                    spreadsheetId,
                    resource: {
                        valueInputOption: 'USER_ENTERED',
                        data: updates
                    }
                });
                console.log("Batch update successful.");
            } else {
                console.log("No rows needed update.");
            }
        });

    } catch (e) { console.error("Error:", e); }
}

main();
