require('dotenv').config();
const { google } = require('googleapis');
const path = require('path');

async function fixOldSignals() {
    const auth = new google.auth.GoogleAuth({
        keyFile: path.join(__dirname, 'google-credentials.json'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const spreadsheetId = process.env.GOOGLE_SHEETS_ID;

    // Sadece Açıklama Sütununu bul (H sütunu)
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Sayfa1!H:I'
        });
        
        const rows = response.data.values;
        if (!rows) return;
        
        // 135(BSU) için -> [BTC: BULL, ETH: BULL]
        for (let i = 0; i < rows.length; i++) {
            const idCell = rows[i][1];
            const oldWarning = rows[i][0] || "";
            
            if (idCell == "135") {
                const targetRow = i + 1;
                const newText = `[BTC: BULL, ETH: BULL] - ${oldWarning}`;
                await sheets.spreadsheets.values.update({
                    spreadsheetId,
                    range: `Sayfa1!H${targetRow}`,
                    valueInputOption: 'USER_ENTERED',
                    resource: { values: [[newText]] }
                });
                console.log(`Row ${targetRow} updated: ${newText}`);
            } else if (idCell == "99999") { // (TESTUSDT GMT misali)
                const targetRow = i + 1;
                const newText = `[BTC: BULL, ETH: BULL] - Test GMT Counter-trend`;
                await sheets.spreadsheets.values.update({
                    spreadsheetId,
                    range: `Sayfa1!H${targetRow}`,
                    valueInputOption: 'USER_ENTERED',
                    resource: { values: [[newText]] }
                });
                console.log(`Row ${targetRow} updated: ${newText}`);
            }
        }
        
    } catch(e) {
        console.log(e);
    }
}

fixOldSignals();
