export default function parseConfigFile(content: string): Map<string, string>
{
    var config = new Map<string, string>();
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
