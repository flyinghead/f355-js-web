import path from "node:path";

export const Config = {
    DB_USER: process.env.DB_USER ?? 'f355', 
    DB_PASSWORD: process.env.DB_PASSWORD ?? 'pouetpouet',
    DISCORD_URL: process.env.DISCORD_URL,
    LOG_LEVEL: process.env.LOG_LEVEL || (process.env.DEV !== undefined ? "debug" : "info"),
    GHOST_DIR: process.env.GHOST_DIR || (process.env.DEV ? path.join(__dirname, 'replays') : "/var/local/lib/f355/replays"),
    RACE_DIR: process.env.RACE_DIR || (process.env.DEV ? path.join(__dirname, "races") : "/var/local/lib/f355/races"),
    PORT: process.env.PORT || 3000,
};

export default function parseConfigFile(content: string): Map<string, string>
{
    const config = new Map<string, string>();
    const lines = content.split(/\r?\n/);
    lines.forEach(line => {
        line = line.trimStart();
        if (line.length == 0 || line[0] == '#' || line[0] == ';')
            return;
        const eqpos = line.indexOf('=');
        if (eqpos < 0)
            return;
        config.set(line.substring(0, eqpos).trimEnd(), line.substring(eqpos + 1).trim());
    });
    return config;
}
