require('dotenv').config();
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

async function readSheet() {
    const credentialsPath = path.join(__dirname, 'google-credentials.json');
    if (!fs.existsSync(credentialsPath)) {
        throw new Error('google-credentials.json dosyası bulunamadı.');
    }
    const auth = new google.auth.GoogleAuth({
        keyFile: credentialsPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const spreadsheetId = process.env.GOOGLE_SHEETS_INSTANT_ID;

    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Sayfa1' });
    const rows = response.data.values;
    if (!rows) return console.log('No data found.');

    const stats = {
        '11': { win: 0, loss: 0, active: 0, total: 0 },
        '12': { win: 0, loss: 0, active: 0, total: 0 },
        '13': { win: 0, loss: 0, active: 0, total: 0 }
    };

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 7) continue;
        const dateStr = row[0] || '';
        const status = row[6] || ''; // G column (Index 6) is Durum

        let day = null;
        if (dateStr.includes('11.04') || dateStr.includes('11/04') || dateStr.includes('04-11')) day = '11';
        else if (dateStr.includes('12.04') || dateStr.includes('12/04') || dateStr.includes('04-12')) day = '12';
        else if (dateStr.includes('13.04') || dateStr.includes('13/04') || dateStr.includes('04-13')) day = '13';

        if (day) {
            stats[day].total++;
            if (status.toUpperCase() === 'WIN') stats[day].win++;
            else if (status.toUpperCase() === 'LOSS') stats[day].loss++;
            else if (status.toUpperCase() === 'ACTIVE') stats[day].active++;
        }
    }

    for (const [day, data] of Object.entries(stats)) {
        const closed = data.win + data.loss;
        const wr = closed > 0 ? (data.win / closed) * 100 : 0;
        console.log(`--- DATE: 2026-04-${day} (Google Sheets) ---`);
        console.log(`Total Signals (Including Active): ${data.total}`);
        console.log(`TP (WIN): ${data.win}`);
        console.log(`SL (LOSS): ${data.loss}`);
        console.log(`Win Rate (From Closed): %${wr.toFixed(2)}`);
        console.log('-------------------\n');
    }
}

readSheet().catch(console.error);
