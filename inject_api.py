import re

with open('/Users/periskop/.gemini/antigravity/scratch/crypto-signal-app/backend/index.js', 'r', encoding='utf-8') as f:
    code = f.read()

s_old = """// İstatistik Endpoint'i (Sanal Kasa Simülasyonu - 30$ İşlem)"""

s_new = """// Gölge Analitikleri Yansıtma Endpoint
app.get('/api/shadow-stats', async (req, res) => {
    try {
        const stats = await db.all("SELECT status, count(*) as count FROM shadow_trades GROUP BY status");
        
        let totalAssessed = 0;
        let win = 0;
        let loss = 0;
        let pending = 0;

        stats.forEach(s => {
            totalAssessed += s.count;
            if (s.status === 'WIN') win = s.count;
            if (s.status === 'LOSS') loss = s.count;
            if (s.status === 'PENDING') pending = s.count;
        });

        const falseNegatives = await db.all("SELECT lessonId, symbol, createdAt as date FROM shadow_trades WHERE status = 'WIN' ORDER BY id DESC LIMIT 10");

        res.json({
            success: true,
            totalAssessed,
            wouldWin: win, 
            wouldLoss: loss, 
            pending,
            falseNegatives
        });
    } catch (err) {
        console.error("Shadow stats hatası:", err);
        res.status(500).json({ error: 'DB Hatası' });
    }
});

// İstatistik Endpoint'i (Sanal Kasa Simülasyonu - 30$ İşlem)"""

code = code.replace(s_old, s_new)

with open('/Users/periskop/.gemini/antigravity/scratch/crypto-signal-app/backend/index.js', 'w', encoding='utf-8') as f:
    f.write(code)

print("Shadow Stats Endpoint injected.")
