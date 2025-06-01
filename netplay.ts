import http from "http";
import crc16 from "./crc16"
import { logger } from "./f355";
import * as f355 from "./f355";
import * as races from "./race";
import { Express } from 'express';

const respond = function(outdata: Buffer, res: http.ServerResponse) {
    const response = Buffer.alloc(3);
    const crc = crc16(outdata);
    // byte 0 is status code (0 for success)
    // byte 1 and 2 are crc16 value of payload (LE)
    response[1] = crc & 0xff;
    response[2] = (crc >> 8) & 0xff;
    res.write(response, (error) => {
        if (error)
            logger.error("write error: " + error.message);
        else
            res.end(outdata);
    });
}
const respondError = function(error: number, res: http.ServerResponse) {
    res.end(Buffer.from([error]));
}

function entryCgi(body: Buffer, res: http.ServerResponse)
{
    if (body[0] === 0)
    {
        // Register entry
        const entryData = body.subarray(3, 3 + 128);
        const id = races.addEntry(entryData);
        const entry = races.getEntry(id);
        logger.info(`New entry ${entry?.getName()} circuit ${f355.getCircuitName(entry?.circuit ?? 0)}`);
        const outdata = Buffer.alloc(8);
        outdata.writeUint32LE(id, 0);
        outdata.writeUint32LE(id, 4);
        respond(outdata, res);
    }
    else
    {
        // Get race status
        const id = body.readUint32LE(3);
        const race = races.findRace(id);
        if (race !== undefined)
        {
            logger.info(`entry[1] race started: ${race.getCircuitName()} for racer ${race.getEntryName(id)}`);
            const outdata = Buffer.from([
                1, 0, 0, 0,
                race.getEntryCount(), 0, 0, 0,
                race.circuit, 0, 0, 0,
                race.weather, 0, 0, 0
            ]);
            respond(outdata, res);
        }
        else
        {
            const entries = races.checkEntry(id);
            if (entries == -1) {
                logger.warn(`entry[1] not found: ${id}`);
                respondError(1, res);
            }
            else
            {
                const entry = races.getEntry(id);
                if (entry !== undefined)
                    // might have timed out
                    logger.info(`entry[1]: ${entry.getName()} waiting...`);
                const outdata = Buffer.from([
                    0, 0, 0, 0, 		// status: 0:waiting, 1:game start
                    entries, 0, 0, 0,   // # entries
                    0, 0, 0, 0,
                    0, 0, 0, 0
                ]);
                respond(outdata, res);
            }
        }
    }
}

function eliminationCgi(body: Buffer, res: http.ServerResponse)
{
    if (body[0] === 0)
    {
        // Record qualifier time
        const id = body.readUint32LE(3);
        const race = races.findRace(id);
        if (race === undefined) {
            logger.warn(`elimination[0] No race found for ${id}`);
            // Don't report error just yet
            respond(Buffer.from(''), res);
            return;
        }
        if (race.status !== races.STATUS_QUALIF) {
            logger.warn(`elimination[0] Race ${race.getCircuitName()} already started (for ${race.getEntryName(id)})`);
            respondError(1, res);
            return;
        }
        const qualifier = body.subarray(11, 11 + 8);
        const frames = qualifier.readUint32LE(0);
        let frac = qualifier.readFloatLE(4);
        let timeStr: string;
        if (frames === 0xfffff) {
            timeStr = `No Goal (${frac})`;
        }
        else {
            let time = (frames + frac) / 60.2;
            const min = Math.trunc(time / 60);
            time -= min * 60;
            const sec = Math.trunc(time);
            time -= sec;
            const msec = Math.trunc(time * 1000);
            timeStr = `${min}`.padStart(2, '0') + "'" + `${sec}`.padStart(2, '0')
                + '"' + `${msec}`.padStart(3, '0');
        }
        logger.info(`Race ${race.getCircuitName()} qualifier received for ${race.getEntryName(id)}: ${timeStr}`);
        race.setQualifier(id, qualifier);
        // Nothing to return
        respond(Buffer.from(''), res);
    }
    else
    {
        let id = body.readUint32LE(7);
        if (id !== 0)
        {
            // Fetch opponent qualifier time
            const race = races.findRace(id);
            if (race === undefined) {
                logger.warn(`elimination[1, opponent] No race found for ${id}`);
                respondError(1, res);
                return;
            }
            const entry = race.getEntry(id);
            const qualifier = race.getQualifier(id);
            if (entry === undefined || qualifier === undefined) {
                logger.warn(`elimination[1, opponent] Entry/qualifier not found for ${id}`);
                respondError(1, res);
                return;
            }
            const outdata = Buffer.alloc(128 + 8);
            qualifier.copy(outdata, 128, 0);
            entry.copy(outdata, 0, 0);
            respond(outdata, res);
            const destUser = race.getEntryName(body.readUint32LE(3));
            logger.info(`Race ${race.getCircuitName()}: ${race.getEntryName(id)} qualifier sent to ${destUser}`);
        }
        else
        {
            // Get qualifier result status
            id = body.readUint32LE(3);
            const race = races.findRace(id);
            if (race === undefined) {
                logger.warn(`elimination[1, 0] No race found for ${id}`);
                // Race cancelled: all other drivers retired
                let outdata = Buffer.alloc(18 * 4);
                outdata[0] = 1;
                respond(outdata, res);
                return;
            }
            const qualifDone = race.isQualifierDone();
            if (qualifDone) {
                race.setStatus(races.STATUS_FINAL);
            }
            const outdata = Buffer.alloc(18 * 4);
            outdata[0] = qualifDone ? 1 : 0;    // 0:running, 1:all racers done
            outdata[4] = 1;             		// position?
            body.copy(outdata, 8, 3, 3 + 4);
            let offset = 12;
            for (let rid of race.getEntryIds()) {
                if (id === rid)
                    continue;
                let qualifier = race.getQualifier(rid);
                if (qualifier !== undefined) {
                    outdata.writeUInt32LE(rid, offset);
                    offset += 4;
                }
            }
            respond(outdata, res);
            logger.info(`Race ${race.getCircuitName()} queried by ${race.getEntryName(id)}: status ${outdata[0]}`);
        }
    }
}

function finalCgi(body: Buffer, res: http.ServerResponse)
{
    if (body[0] === 0)
    {
        // Send race results
        const id = body.readUint32LE(3);
        const race = races.findRace(id);
        if (race === undefined) {
            logger.info(`final[0] No race found for ${id}`);
            // Don't report error just yet
        }
        else
        {
            if (race.status !== races.STATUS_FINAL) {
                logger.warn(`final[0] Race ${race.getCircuitName()} already finished (for ${race.getEntryName(id)})`);
                respondError(1, res);
                return;
            }
            if (!race.hasQualified(id)) {
                logger.error(`final[0] Race ${race.getCircuitName()} results received but didn't qualify!!! (for ${race.getEntryName(id)})`);
                respondError(1, res);
                return;
            }
            logger.info(`Race ${race.getCircuitName()} result received for ${race.getEntryName(id)}`);
            const result = body.subarray(11);
            race.setResult(id, result);
            races.saveResult(race, id, result);
            if (race.isRaceDone())
                race.setStatus(races.STATUS_FINISHED);
        }
        // no output
        respond(Buffer.from(''), res);
    }
    else if (body[0] === 1)
    {
        let id = body.readUint32LE(7);
        if (id !== 0)
        {
            // Fetch race results of opponent
            const race = races.findRace(id);
            if (race === undefined) {
                logger.warn(`final[1, opponent] No race found for ${id}`);
                respondError(1, res);
                return;
            }
            const result = race.getResult(id);
            if (result === undefined) {
                logger.warn(`final[1, opponent] No result found for ${id}`);
                respondError(1, res);
                return;
            }
            respond(result, res);
            const destUser = race.getEntryName(body.readUint32LE(3));
            logger.info(`Race ${race.getCircuitName()}: ${race.getEntryName(id)} result sent to ${destUser}`);
        }
        else
        {
            // Get race results status
            id = body.readUint32LE(3);
            const race = races.findRace(id);
            const outdata = Buffer.alloc(9 * 4);
            if (race === undefined) {
                logger.warn(`final[1, 0] No race found for ${id}`);
                // Race cancelled: all other drivers retired
                outdata[0] = 1;
            }
            else
            {
                outdata[0] = race.isRaceDone() ? 1 : 0;
                body.copy(outdata, 4, 3, 3 + 4);
                let offset = 8;
                for (let rid of race.getEntryIds())
                {
                    if (rid != id && race.hasQualified(rid))
                    {
                        let result = race.getResult(rid);
                        if (result !== undefined) {
                            outdata.writeUInt32LE(rid, offset);
                            offset += 4;
                        }
                    }
                }
                logger.info(`Race ${race.getCircuitName()} final queried by ${race.getEntryName(id)}: status ${outdata[0]}`);
            }
            respond(outdata, res);
        }
    }
}

export default function netplayRequestListener(req: http.IncomingMessage, res: http.ServerResponse, app: Express)
{
    if (req.url === undefined || !req.url.startsWith("/cgi-bin/f355/network_play/")) {
        app(req, res);
        return;
    }
    let body = Buffer.from('');
    req.on('data', (chunk: Buffer) => {
        body = Buffer.concat([body, chunk]);
    })
    req.on('end', () => {
        // at this point, body has the entire request body stored in it as a buffer
        logger.debug(`data[${body.length}] url ${req.url}`);
        switch (req.url) {
            case "/cgi-bin/f355/network_play/entry.cgi":
                entryCgi(body, res);
                break;
            case "/cgi-bin/f355/network_play/elimination.cgi":
                eliminationCgi(body, res);
                break;
            case "/cgi-bin/f355/network_play/final.cgi":
                finalCgi(body, res);
                break;
            default:
                res.statusCode = 404;
                res.statusMessage = "Invalid URL";
                res.end();
                break;
        }
    });
    req.on('error', (err: Error) => {
        logger.error("netplayRequestListener: " + err.message);
        res.statusCode = 500;
        res.end();
    });
};
