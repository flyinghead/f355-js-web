import { IncomingMessage } from 'node:http';
import https from 'node:https';
import { logger } from "./f355";

const webHookUrl = process.env.DISCORD_URL;
const gamepic = "https://dcnet.flyca.st/gamepic/f355.jpg";

const postNotif = function(postData: string): void
{
    if (webHookUrl === undefined)
        return;
    const options = {
        method: 'POST',
        headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        "User-Agent": "DCNet-DiscordWebhook",           // required
        },
    };
    const request = https.request(webHookUrl, options, (res: IncomingMessage) => {
        if (res.statusCode === undefined || res.statusCode < 200 || res.statusCode >= 300)
            logger.error(`Discord POST failed: ${res.statusCode} ${res.statusMessage}`);
    });
    request.write(postData, (err) => {
        if (err)
            logger.error("Discord write failed: " + err.message);
        else
            request.end();
    });
    request.on('error', (err) => {
        logger.error("Discord error: " + err.message)
    });
}

export function playerWaiting(playerName: string, trackName: string, allPlayers: string[]): void
{
    const notif = {
        "content": `Player **${playerName}** is waiting for other racers on circuit **${trackName}**.\n_ _`,
        "embeds": [
            {
                "title": "Waiting list",
                "description": allPlayers.join('\n'),
                "color": 9118205,
                "author": {
                    "name": "F355 Challenge",
                    "icon_url": gamepic
                }
            }
        ],
        "attachments": []
    };
    postNotif(JSON.stringify(notif));
}

export function raceStart(trackName: string, racers: string[])
{
    const notif = {
       "content": null,
       "embeds": [
            {
                "title": `${trackName}: Race Start`,
                "description": racers.join('\n'),
                "color": 9118205,
                "author": {
                    "name": "F355 Challenge",
                    "icon_url": gamepic
                }
            }
       ],
       "attachments": []
    };
    postNotif(JSON.stringify(notif));
}