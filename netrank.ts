import * as f355 from "./f355";
import { logger } from "./f355";
import { createUpdatePlayer, getPlayer, Player, updateScoreName, saveBestLap, saveResult } from "./database";
import express from 'express';
import busboy from "busboy";
import * as fs from 'node:fs/promises';
import path from "node:path";

const origBase64  = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const substBase64 = "AZOLYNdnETmP6ci3Sze9IyXBhDgfQq7l5batM4rpKJj8CusxRF+k2V0wUGo1vWH/";

function substitute(s: string, from: string, to: string) {
    let res = '';
    for (let i = 0; i < s.length; i++) {
        const idx = from.indexOf(s[i]);
        if (idx != -1)
            res += to[idx];
        else
            res += s[i];
    }
    return res;
}

function unscramble(s: string): string {
    return substitute(s, substBase64, origBase64);
}

function getRemoteIP(req: express.Request): string {
    const addr = req.socket.remoteAddress;
    if (addr === undefined)
        return '';
    if (addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1") {
        const forwardedIp = req.headers["X-Forwarded-For"];
        if (typeof forwardedIp === 'string')
            return forwardedIp;
    }
    return addr;
}

function lapTimeToString(t: number): string {
    return Math.trunc(t / 100000).toString() + "'"
        + Math.trunc((t % 100000) / 1000).toString().padStart(2, '0') + '"'
        + Math.trunc(t % 1000).toString().padStart(3, '0');
}
function raceModeToIcon(mode: number) {
    switch (mode) {
        case 0:
            return "icon_training.gif";
        case 1:
            return "icon_free.gif";
        case 2:
            return "icon_race.gif";
        default:
            return "icon_dontknow.gif";
    }
}

const KMS_PER_MILES = 1.609344;

function formatSpeed(val: number, country: string): string {
    let unit;
    if (country === 'ja' || country === 'en' || country === 'uk') {
        val /= KMS_PER_MILES;
        unit = ' mph';
    }
    else {
        unit = ' km/h';
    }
    return val.toFixed(1) + unit;
}
function formatDistance(val: number, country: string): string {
    let unit;
    if (country === 'ja' || country === 'en' || country === 'uk') {
        val /= KMS_PER_MILES;
        unit = ' mi';
    }
    else {
        unit = ' km';
    }
    return val.toFixed(1) + unit;
}

function playerDataView(req: express.Request, res: express.Response, player: Player, country: string, uploadMessage = '')
{
    interface Result {
        time: string | undefined;
        tuned: boolean;
        assist: boolean;
        raceMode: string;
        arcade: boolean;
    };

    interface Track {
        id: number;
        name: string;
        automatic: Result | undefined;
        semiAuto: Result | undefined;
        maxSpeed: string;
    };
    const tracks = new Array<Track>();
    for (const i of [1, 0, 5, 4, 2, 3, 11, 8, 9, 10, 7]) {
        const track: Track = {
            id: i,
            name: f355.getCircuitName(i),
            automatic: undefined,
            semiAuto: undefined,
            maxSpeed: '',
        };
        let lapTime = player.getLapTime(i, false);
        if (lapTime !== undefined) {
            track.automatic = { time: lapTimeToString(lapTime.time), tuned: lapTime.tuned, assist: lapTime.assist,
                raceMode: raceModeToIcon(lapTime.raceMode), arcade: lapTime.arcade };
            if (lapTime.maxSpeed != 0)
                track.maxSpeed = formatSpeed(lapTime.maxSpeed, country);
        }
        lapTime = player.getLapTime(i, true);
        if (lapTime !== undefined) {
            track.semiAuto = { time: lapTimeToString(lapTime.time), tuned: lapTime.tuned, assist: lapTime.assist,
                raceMode: raceModeToIcon(lapTime.raceMode), arcade: lapTime.arcade };
            if (lapTime.maxSpeed != 0)
                track.maxSpeed = formatSpeed(lapTime.maxSpeed, country);
        }
        tracks.push(track);
    }

    const data = {
        language: country === 'uk' ? 'en' : country,
        country: country,
        player: player,
        tracks: tracks,
        distanceDriven: formatDistance(player.getDistanceDriven() / 1000, country),
        uploadMessage: uploadMessage,
    };
    res.render('register_time', data);
}

export async function playerDataUpload(req: express.Request, res: express.Response)
{
    const playerData = req.body.f355_player_data;
    if (playerData === undefined) {
        res.statusCode = 500;
        res.statusMessage = "Can't find f355_player_data";
        res.end();
        logger.error("playerDataUpload: can't find f355_player_data");
        return;
    }
    let bytes = Buffer.from(unscramble(playerData), "base64");
    try {
        const player = await createUpdatePlayer(bytes, getRemoteIP(req));
        if (player === undefined) {
            res.statusCode = 500;
            res.statusMessage = 'Player not found';
            res.end();
            logger.error("playerDataUpload: can't find or create player");
            return;
        }

        let country = "en";
        const userAgent = req.headers["User-agent"];
        if (typeof userAgent === 'string' && userAgent.indexOf("DreamPassport") != -1) {
            country = "ja";
        }
        else
        {
            const referer = req.headers["Referer"];
            if (typeof referer === 'string' && referer.endsWith("F355DATA.PLY?u")) {
                country = "uk";
            }
            else if (req.url.length >= 16) {
                country = req.url.slice(14, 16);
                if (country === "dp")
                    country = "en";
            }
        }
        playerDataView(req, res, player, country);
    } catch (err) {
        logger.error("playerDataUpload: " + err);
        res.statusCode = 500;
        res.end();
    }
}

export async function playerDataSet(req: express.Request, res: express.Response)
{
    const regId = req.body.playerId;
    if (typeof regId !== 'string') {
        res.statusCode = 500;
        res.statusMessage = "Can't find user id";
        res.end();
        logger.error("playerDataSet: can't find user id");
        return;
    }
    try {
        const country = req.body.country || 'en';
        let player: Player | undefined;
        if (req.body.update !== undefined) {
            player = await updateScoreName(regId, req.body.scoreName as string, getRemoteIP(req));
        }
        else if (req.body.registerAll !== undefined) {
            player = await getPlayer(regId);
            logger.info(`${player.name}: Registering all times`);
            for (let i = 0; i < f355.CIRCUIT_COUNT; i++)
            {
                let lapTime = player.getLapTime(i, false);
                if (lapTime !== undefined) {
                    logger.info(`${player.name}: Registering time for track ${f355.getCircuitName(i)} AT`);
                    saveBestLap(regId, i, false);
                }
                lapTime = player.getLapTime(i, true);
                if (lapTime !== undefined) {
                    logger.info(`${player.name}: Registering time for track ${f355.getCircuitName(i)} SA`);
                    saveBestLap(regId, i, true);
                }
            }
        }
        else {
            player = await getPlayer(regId);
            for (let i = 0; i < f355.CIRCUIT_COUNT; i++) {
                let v = req.body['atTrack' + i];
                if (v !== undefined) {
                    logger.info(`${player.name}: Registering time for track ${f355.getCircuitName(i)} AT`);
                    saveBestLap(regId, i, false);
                }
                v = req.body['saTrack' + i];
                if (v !== undefined) {
                    logger.info(`${player.name}: Registering time for track ${f355.getCircuitName(i)} SA`);
                    saveBestLap(regId, i, true);
                }
            }
        }
        if (player === undefined) {
            res.statusCode = 500;
            res.statusMessage = "Player is undefined";
            res.end();
            logger.error("playerDataSet: Player is undefined");
            return;
        }
        playerDataView(req, res, player, country);
    } catch (err) {
        logger.error("playerDataSet: " + err);
        res.statusCode = 500;
        res.end();
    }
}

export async function uploadReplay(req: express.Request, res: express.Response)
{
    const userAgent = req.headers["user-agent"];
    if (userAgent !== undefined && (userAgent.includes("DreamKey") || userAgent.includes("DreamPassport")))
    {
        // The multipart/form-data sent by the dreamcast is incorrect:
        // the boundary when used is not prepended by two hyphens ("--").
        // So we remove the first two hyphens of the boundary definition.
        let contentType = req.headers["content-type"];
        if (contentType !== undefined) {
            const boundIdx = contentType.indexOf("boundary=");
            if (boundIdx != -1)
                contentType = contentType.slice(0, boundIdx + 9) + contentType.slice(boundIdx + 11);
            req.headers["content-type"] = contentType;
        }
    }
    const bb = busboy({ headers: req.headers });
    const fields = new Map<string, string>();
    bb.on('field', (name, val, info) => {
        fields.set(name, val);
    });
    bb.on('close', async () => {
        const playerId = fields.get('playerId');
        const thefile = fields.get('thefile');
        if (playerId === undefined || thefile === undefined) {
            res.statusCode = 500;
            res.end();
            logger.error("uploadReplay: missing playerId or thefile params");
            return;
        }
        const idx = thefile.indexOf("\n\n");
        if (idx == -1) {
            res.statusCode = 500;
            res.end();
            logger.error("uploadReplay: can't find end of header");
            return;
        }
        let country = fields.get('country');
        if (country === undefined)
            country = 'en';
        let fileData = Buffer.from(unscramble(thefile.slice(idx + 2)), "base64");
        const fileName = Date.now() + ".bin";
        const replayPath = path.join(f355.getResultDir(), fileName);
        try {
            await fs.writeFile(replayPath, fileData);
            const player = await saveResult(playerId, fileData, fileName, getRemoteIP(req));
            playerDataView(req, res, player, country, "Replay successfully uploaded");
        } catch (err) {
            logger.error("uploadReplay: " + err);
            try {
                const player = await getPlayer(playerId);
                const msg = err instanceof Error ? err.message : "Upload failed";
                playerDataView(req, res, player, country, msg);
            } catch (err) {
                res.statusCode = 500;
                res.end();
            }
        }
    });
    req.pipe(bb);
}
