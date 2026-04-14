const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve(__dirname, 'signals.db');
const db = new sqlite3.Database(dbPath);

db.all("PRAGMA table_info(shadow_trades);", (err, rows) => {
    console.log("SHADOW_TRADES:", JSON.stringify(rows));
    db.all("PRAGMA table_info(ai_lessons);", (err2, rows2) => {
        console.log("AI_LESSONS:", JSON.stringify(rows2));
        process.exit(0);
    });
});
