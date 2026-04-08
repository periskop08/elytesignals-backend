require('dotenv').config();
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

async function getAuthClient() {
    const credentialsPath = path.join(__dirname, 'google-credentials.json');
    const auth = new google.auth.GoogleAuth({
        keyFile: credentialsPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return await auth.getClient();
}

async function fixStblWarnings() {
    try {
        const authClient = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth: authClient });
        const spreadsheetId = process.env.GOOGLE_SHEETS_INSTANT_ID;

        // I Sütununu oku (Signal ID'ler)
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Sayfa1!I:I'
        });

        const rows = response.data.values;
        let targetRowIndex = -1;
        for (let i = 0; i < rows.length; i++) {
            if (rows[i][0] && rows[i][0].toString() === '5') {
                targetRowIndex = i + 1; 
                break;
            }
        }

        if (targetRowIndex !== -1) {
            const updateRange = `Sayfa1!H${targetRowIndex}`;
            const newValue = "Order Block (+25), FVG Confirmed (+15), Ichimoku Bull Trend (+15), Order Flow Aggressive Bull (+15), Good R:R Bonus (+5), StochRSI Overbought (-10)";
            
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: updateRange,
                valueInputOption: 'USER_ENTERED',
                resource: {
                    values: [[newValue]]
                }
            });
            console.log(`Successfully updated row ${targetRowIndex} column H for STBL.`);
        }
    } catch (e) {
        console.error(e);
    }
}
fixStblWarnings();
