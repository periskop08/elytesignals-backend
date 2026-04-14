const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve(__dirname, 'signals.db');
const db = new sqlite3.Database(dbPath);

db.all("SELECT * FROM ai_lessons ORDER BY id DESC LIMIT 3", (err, rows) => {
    if (err) { console.error(err); process.exit(1); }
    console.log(JSON.stringify(rows, null, 2));
    process.exit(0);
});
