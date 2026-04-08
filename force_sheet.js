require('dotenv').config();
const { google } = require('googleapis');

async function forceWrite() {
    try {
        if (!process.env.GOOGLE_SHEETS_INSTANT_ID) {
            console.log("No INSTANT sheet ID in env");
            return;
        }
        const auth = new google.auth.GoogleAuth({
            keyFile: './google-credentials.json',
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const sheets = google.sheets({ version: 'v4', auth });
        
        await sheets.spreadsheets.values.append({
            spreadsheetId: process.env.GOOGLE_SHEETS_INSTANT_ID,
            range: 'Sayfa1!A:J',
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [
                [
                    '08.04.2026 04:05:02', // dateStr
                    'SOLUSDT', // Symbol
                    40, // Score
                    'SHORT', // Type
                    '%2.00', // TP
                    '%1.78', // SL
                    'ACTIVE', // Status
                    '["Bullish 200 SMA (-15)","FVG Confirmed (+15)","High Volume Spike (+15)","Strong Trend (ADX > 25) (+10)","Order Flow Aggressive Bear (+15)","Low RR (1.13)"]', // Warnings
                    15, // signal ID
                    '-' // volumeText 
                ]
            ] },
        });
        console.log("Written successfully to SOLUSDT in INSTANT sheet");
    } catch(e) {
        console.log("Error writing sheet", e);
    }
}
forceWrite().then(() => setTimeout(() => process.exit(0), 4000));
