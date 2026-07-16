function log(level, event, details) {
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const prefix = `[${ts}] [${level}] [${event}]`;
    if (details && typeof details === 'object') {
        try { console.log(prefix, JSON.stringify(details)); } catch (e) { console.log(prefix, details); }
    } else if (details !== undefined) {
        console.log(prefix, details);
    } else {
        console.log(prefix);
    }
}

module.exports = { log };
