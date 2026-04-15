const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve(__dirname, 'signals.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening db:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        
        // SQLite_BUSY kilitlenmelerini önlemek için WAL modunu aktif et
        db.run('PRAGMA journal_mode = WAL;');
        db.run('PRAGMA synchronous = NORMAL;');
        db.run('PRAGMA busy_timeout = 5000;');

        // Create table if not exists
        db.run(`CREATE TABLE IF NOT EXISTS signals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            type TEXT NOT NULL, /* LONG or SHORT */
            entryPrice REAL NOT NULL,
            targetPrice REAL NOT NULL,
            stopPrice REAL NOT NULL,
            status TEXT DEFAULT 'ACTIVE', /* ACTIVE, WIN, LOSS */
            reachedTwoPercent INTEGER DEFAULT 0,
            qualityScore INTEGER DEFAULT 0,
            warnings TEXT DEFAULT '[]',
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if(err) {
                console.error("Tablo oluşturulurken hata:", err);
            } else {
                db.run("ALTER TABLE signals ADD COLUMN reachedTwoPercent INTEGER DEFAULT 0", () => {});
                db.run("ALTER TABLE signals ADD COLUMN qualityScore INTEGER DEFAULT 0", () => {});
                db.run("ALTER TABLE signals ADD COLUMN warnings TEXT DEFAULT '[]'", () => {});
                db.run("ALTER TABLE signals ADD COLUMN rvol TEXT DEFAULT '-'", () => {});
                db.run("ALTER TABLE signals ADD COLUMN engineMode TEXT DEFAULT 'ALPHA'", () => {});
            }
        });

        // Create sessions table for Telegram Web Login / Bot Linking
        db.run(`CREATE TABLE IF NOT EXISTS sessions (
            sessionId TEXT PRIMARY KEY,
            telegramId TEXT,
            name TEXT,
            photo TEXT,
            isVip INTEGER DEFAULT 0,
            isAuthenticated INTEGER DEFAULT 0,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if(err) console.error("Session table error:", err);
        });

        // Create user_trades table for Auto-Trading feature
        db.run(`CREATE TABLE IF NOT EXISTS user_trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegramId TEXT NOT NULL,
            signalId INTEGER NOT NULL,
            symbol TEXT NOT NULL,
            type TEXT NOT NULL,
            entryPrice REAL NOT NULL,
            targetPrice REAL NOT NULL,
            stopPrice REAL NOT NULL,
            status TEXT DEFAULT 'ACTIVE', /* ACTIVE, CLOSED_WIN, CLOSED_LOSS, CLOSED_MANUAL */
            pnl REAL DEFAULT 0,
            closeReason TEXT, /* NATIVE_TP, NATIVE_SL, MANUAL_CLOSE */
            bybitOrderId TEXT,
            isBreakeven INTEGER DEFAULT 0,
            riskedUsd REAL DEFAULT 0,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            closedAt DATETIME
        )`, (err) => {
            if(err) {
                console.error("user_trades table error:", err);
            } else {
                db.run("ALTER TABLE user_trades ADD COLUMN isBreakeven INTEGER DEFAULT 0", () => {});
                db.run("ALTER TABLE user_trades ADD COLUMN riskedUsd REAL DEFAULT 0", () => {});
            }
        });

        // Create Varlık (Portfolio) tables
        db.run(`CREATE TABLE IF NOT EXISTS portfolio_assets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL UNIQUE,
            type TEXT NOT NULL, /* STOCK, COMMODITY, ETF */
            allocatedPercentage REAL DEFAULT 0, /* Portföy içindeki % ağırlık */
            averageCost REAL DEFAULT 0,
            quantity REAL DEFAULT 0,
            aiScore REAL DEFAULT 0,
            ceoScore REAL DEFAULT 0,
            edgeScore REAL DEFAULT 0,
            insiderScore REAL DEFAULT 0,
            patentScore REAL DEFAULT 0,
            lastStatus TEXT DEFAULT 'ACTIVE',
            drawdown REAL DEFAULT 0,
            pendingPercentage REAL DEFAULT 0,
            pendingEntryPrice REAL DEFAULT 0,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if(err) {
                console.error("portfolio_assets table error:", err);
            } else {
                db.run("ALTER TABLE portfolio_assets ADD COLUMN aiScore REAL DEFAULT 0", () => {});
                db.run("ALTER TABLE portfolio_assets ADD COLUMN ceoScore REAL DEFAULT 0", () => {});
                db.run("ALTER TABLE portfolio_assets ADD COLUMN edgeScore REAL DEFAULT 0", () => {});
                db.run("ALTER TABLE portfolio_assets ADD COLUMN insiderScore REAL DEFAULT 0", () => {});
                db.run("ALTER TABLE portfolio_assets ADD COLUMN patentScore REAL DEFAULT 0", () => {});
                db.run("ALTER TABLE portfolio_assets ADD COLUMN pendingPercentage REAL DEFAULT 0", () => {});
                db.run("ALTER TABLE portfolio_assets ADD COLUMN pendingEntryPrice REAL DEFAULT 0", () => {});
            }

            // MOCK DATA for Demo
            db.get("SELECT COUNT(*) as count FROM portfolio_assets", (err, row) => {
                if(row && row.count === 0) {
                    db.run("INSERT INTO portfolio_assets (symbol, type, allocatedPercentage, averageCost, quantity, aiScore) VALUES ('NVDA', 'STOCK', 28, 125.40, 10, 94)");
                    db.run("INSERT INTO portfolio_assets (symbol, type, allocatedPercentage, averageCost, quantity, aiScore) VALUES ('TSLA', 'STOCK', 18, 175.20, 15, 87)");
                    db.run("INSERT INTO portfolio_assets (symbol, type, allocatedPercentage, averageCost, quantity, aiScore) VALUES ('MSFT', 'STOCK', 15, 415.50, 5, 92)");
                    db.run("INSERT INTO portfolio_assets (symbol, type, allocatedPercentage, averageCost, quantity, aiScore) VALUES ('PLTR', 'STOCK', 12, 24.10, 50, 89)");
                }
                
                // Update detailed scores for existings
                db.run("UPDATE portfolio_assets SET ceoScore=9.2, edgeScore=9.5, insiderScore=90, patentScore=88, drawdown=4 WHERE symbol='NVDA'");
                db.run("UPDATE portfolio_assets SET ceoScore=8.7, edgeScore=8.9, insiderScore=50, patentScore=70, drawdown=16 WHERE symbol='TSLA'");
                db.run("UPDATE portfolio_assets SET ceoScore=9.0, edgeScore=9.2, insiderScore=60, patentScore=80, drawdown=8 WHERE symbol='MSFT'");
                db.run("UPDATE portfolio_assets SET ceoScore=8.9, edgeScore=8.5, insiderScore=95, patentScore=85, drawdown=26 WHERE symbol='PLTR'");
                
                // Insert ETF
                db.run("INSERT OR IGNORE INTO portfolio_assets (symbol, type, allocatedPercentage, averageCost, quantity, aiScore, ceoScore, edgeScore, insiderScore, patentScore) VALUES ('QQQ', 'ETF', 10, 440.10, 20, 85, 8.0, 8.5, 50, 50)");
            });
        });

        db.run(`CREATE TABLE IF NOT EXISTS ai_sentiments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            ceoScore REAL DEFAULT 0,
            edgeScore REAL DEFAULT 0,
            earningsScore REAL DEFAULT 0,
            insiderScore REAL DEFAULT 0,
            patentScore REAL DEFAULT 0,
            sentimentPercent INTEGER DEFAULT 0,
            summary TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if(err) console.error("ai_sentiments table error:", err);
            else {
                db.run("ALTER TABLE ai_sentiments ADD COLUMN insiderScore REAL DEFAULT 0", () => {});
                db.run("ALTER TABLE ai_sentiments ADD COLUMN patentScore REAL DEFAULT 0", () => {});
                db.run("ALTER TABLE ai_sentiments ADD COLUMN detailedReport TEXT", () => {});
                
                db.get("SELECT COUNT(*) as count FROM ai_sentiments", (err, row) => {
                    // Caching devrede. Mock dataları sildik. Artık OpenAI 400 kelimelik gerçek raporları kaydedecek.
                });
            }
        });

        // Create ai_lessons table for Post-Mortem Agent
        db.run(`CREATE TABLE IF NOT EXISTS ai_lessons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            tradeId INTEGER,
            lessonText TEXT NOT NULL,
            status TEXT DEFAULT 'ACTIVE',
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Create shadow_trades table for Shadow Tracker
        db.run(`CREATE TABLE IF NOT EXISTS shadow_trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            type TEXT NOT NULL,
            entryPrice REAL NOT NULL,
            targetPrice REAL NOT NULL,
            stopPrice REAL NOT NULL,
            lessonId INTEGER,
            status TEXT DEFAULT 'PENDING',
            pnl REAL DEFAULT 0,
            qualityScore INTEGER DEFAULT 0,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            closedAt DATETIME
        )`, (err) => {
            if (!err) {
                db.run("ALTER TABLE shadow_trades ADD COLUMN breakdownData TEXT", () => {});
            }
        });

        // Create stock_news table for Kantan Reporter Agent
        db.run(`CREATE TABLE IF NOT EXISTS stock_news (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kantanId INTEGER UNIQUE,
            title TEXT NOT NULL,
            slug TEXT UNIQUE,
            content TEXT,
            summary TEXT,
            relatedSymbols TEXT,
            sentimentScore INTEGER DEFAULT 0,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
    }
});

function runQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) {
                console.log('Error running sql ' + sql);
                console.log(err);
                reject(err);
            } else {
                resolve({ id: this.lastID, changes: this.changes });
            }
        });
    });
}

function getQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) {
                console.log('Error running sql: ' + sql);
                console.log(err);
                reject(err);
            } else {
                resolve(row);
            }
        });
    });
}

function allQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) {
                console.log('Error running sql: ' + sql);
                console.log(err);
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

module.exports = {
    run: runQuery,
    get: getQuery,
    all: allQuery,
    db
};
