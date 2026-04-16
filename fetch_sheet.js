require('dotenv').config();
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

async function getAuthClient() {
    const credentialsPath = path.join(__dirname, 'google-credentials.json');
    if (!fs.existsSync(credentialsPath)) {
        throw new Error('google-credentials.json dosyası bulunamadı.');
    }
    const auth = new google.auth.GoogleAuth({
        keyFile: credentialsPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return await auth.getClient();
}

async function readSheet() {
    const authClient = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const spreadsheetId = process.env.GOOGLE_SHEETS_INSTANT_ID;

    // A: Tarih, B: Coin, vs. J: Uyarilar/Cezalar (We will read entire rows to find out)
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Sayfa1'
    });

    const rows = response.data.values;
    if (!rows) return console.log('No data found.');

    const headers = rows[0];
    const events = [];

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.length === 0) continue;
        
        const dateStr = row[0] || '';
        // Look for 12/04/2026 or 13/04/2026 or something like that
        if (dateStr.includes('12/04') || dateStr.includes('04-12') || dateStr.includes('12.04') ||
            dateStr.includes('13/04') || dateStr.includes('04-13') || dateStr.includes('13.04')) {
            events.push({
                date: row[0],
                coin: row[1],
                type: row[2],
                warnings: row[8] // Assuming I or J is explanations/warnings (index 8/9/10), we will print the last few columns
            });
            console.log(row.join(' | '));
        }
    }
}

readSheet().catch(console.error);
