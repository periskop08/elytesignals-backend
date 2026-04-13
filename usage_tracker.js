const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'signals.db');
const db = new sqlite3.Database(dbPath);

async function logTokenUsage(agentName, result) {
    if (!result || !result.response || !result.response.usageMetadata) return;
    try {
        const { promptTokenCount, candidatesTokenCount, totalTokenCount } = result.response.usageMetadata;
        return new Promise((resolve) => {
            db.run(
                `INSERT INTO api_usage (agent_name, prompt_tokens, completion_tokens, total_tokens) VALUES (?, ?, ?, ?)`,
                [agentName, promptTokenCount || 0, candidatesTokenCount || 0, totalTokenCount || 0],
                (err) => {
                    if (err) console.error(`[TOKEN_TRACKER] Error saving usage for ${agentName}:`, err.message);
                    else console.log(`[TOKEN_TRACKER] ${agentName}: ${totalTokenCount} tokens logged.`);
                    resolve();
                }
            );
        });
    } catch(e) {
        console.error(`[TOKEN_TRACKER] Error logging metadata for ${agentName}`);
    }
}

module.exports = { logTokenUsage };
