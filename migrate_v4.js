const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve(__dirname, 'signals.db');
const db = new sqlite3.Database(dbPath);

console.log("Starting Schema Migration for V4...");

db.serialize(() => {
    db.run("ALTER TABLE shadow_trades ADD COLUMN breakdownData TEXT;", (err) => {
        console.log(err ? "shadow_trades.breakdownData error: " + err.message : "shadow_trades.breakdownData ADDED.");
    });
    db.run("ALTER TABLE ai_lessons ADD COLUMN reliability INTEGER DEFAULT 100;", (err) => {
        console.log(err ? "ai_lessons.reliability error: " + err.message : "ai_lessons.reliability ADDED.");
    });
    db.run("ALTER TABLE ai_lessons ADD COLUMN missCount INTEGER DEFAULT 0;", (err) => {
        console.log(err ? "ai_lessons.missCount error: " + err.message : "ai_lessons.missCount ADDED.");
    });
});

setTimeout(() => {
    console.log("Migration finished.");
    process.exit(0);
}, 2000);
