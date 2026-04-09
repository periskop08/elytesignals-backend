const { google } = require('googleapis');
const path = require('path');
require('dotenv').config();

async function readSheet() {
    const auth = new google.auth.GoogleAuth({
        keyFile: path.join(__dirname, 'google-credentials.json'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.GOOGLE_SHEETS_INSTANT_ID,
        range: 'Sayfa1!A1:J200'
    });

    const rows = response.data.values;
    if (rows) {
        // Son 5 satiri goster
        console.log(rows.slice(-5));
    }
}
readSheet();
