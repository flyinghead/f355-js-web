import { logger } from "./f355";
import * as fs from "node:fs"
import parseConfigFile from "./config";
import * as races from "./race";
import http from "node:http";

var statusUrl: string | undefined;
var updateInterval = 300;

class Status {
    readonly gameId = "f355";
    readonly timestamp = Math.floor(Date.now() / 1000);
    playerCount = 0;
    gameCount = 0;
}

function updateStatus()
{
    const status = new Status();
    status.playerCount = races.getPlayerCount();
    status.gameCount = races.getRaceCount();
    const payload = JSON.stringify([ status ], undefined, 4);
    if (statusUrl === undefined) {
        try {
            fs.writeFileSync("/var/lib/dcnet/status/f355", payload);
        } catch (err) {
            logger.error("updateStatus: " + err);
        }
    }
    else
    {
        const options = {
            method: "POST",
            headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
            "User-Agent": "DCNet-DiscordWebhook",
            },
        };
        const request = http.request(statusUrl, options, (res: http.IncomingMessage) => {
            if (res.statusCode === undefined || res.statusCode < 200 || res.statusCode >= 300)
                logger.error(`Status POST failed: ${res.statusCode} ${res.statusMessage}`);
        });
        request.write(payload, (err) => {
            if (err)
                logger.error("Status write failed: " + err.message);
            else
                request.end();
        });
        request.on("error", (err) => {
            logger.error("Status HTTP error: " + err.message)
        });
    }
}

export function init()
{
    try {
        const configData = fs.readFileSync("/usr/local/etc/dcnet/status.conf", "utf-8");
        if (configData !== undefined)
        {
            const config = parseConfigFile(configData.toString());
            statusUrl = config.get("status-url");
            updateInterval = Number.parseInt(config.get("update-interval") ?? "300");
        }
        logger.info("status.conf loaded: URL " + statusUrl + ", Interval " + updateInterval + " s");
    } catch (err) {
        logger.warn("Can't load status.conf: " + err);
    }
    updateStatus();
    setInterval(updateStatus, updateInterval * 1000);
}