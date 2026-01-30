import express from 'express';
import * as f355 from "./f355";
import { logger } from "./f355";
import * as fs from 'node:fs/promises'
import path from 'node:path';
import { Config } from './config';

const Extensions = [
    "SZS", "MTG", "SZK", "LNG", "SGO", "MNZ",
    "MRN", "FIO", "NUR", "LAG", "SEP", "ATL" 
];

async function makeVmi(path: string, attachname: string): Promise<Buffer> {
    const vmi = Buffer.alloc(0x6c);
    vmi.write("SEGA", "ascii");
    const fileData = await fs.readFile(path);
    fileData.copy(vmi, 4, 16, 48);
    vmi.write("SEGA ENTERPRISES", 0x24, "ascii");
    // TODO? date/time
    vmi[0x44] = 2023 & 0xff;
    vmi[0x45] = 2023 >> 8;
    vmi[0x46] = 12;
    vmi[0x47] = 12;
    vmi[0x48] = 9;
    vmi[0x49] = 33;
    vmi[0x4a] = 0;
    vmi[0x4b] = 2;
    // vmi version
    vmi[0x4d] = 1;
    // file number
	vmi[0x4e] = 1;
    // vmi resource name
    const id = f355.getRandomInt(100000000).toString().padStart(8, '0');
    vmi.write(id, 0x50, "ascii");
    // AND the initial "SEGA" header with the first four bytes of the id
    vmi[0] &= vmi[0x50];
    vmi[1] &= vmi[0x51];
    vmi[2] &= vmi[0x52];
    vmi[3] &= vmi[0x53];
    // file name
    vmi.write(attachname, 0x58, "ascii");
    // file size
    vmi.writeUint32LE(fileData.length, 0x68);

    return vmi;
}

export async function downloadReplay(req: express.Request, res: express.Response)
{
    const circuit = req.params.circuit;
    const fileName = req.params.file;
    if (typeof circuit !== 'string' || typeof fileName !== 'string') {
        res.statusCode = 500;
        res.end();
        logger.error("downloadReplay: missing circuit or file param");
        return;
    }
    if (fileName.indexOf("/") != -1) {
        res.statusCode = 500;
        res.end();
        logger.error("downloadReplay: UNSAFE FILE NAME DETECTED " + fileName);
        return;
    }
    const replayPath = path.join(Config.GHOST_DIR, fileName);
    try {
        if (req.url.endsWith(".VMI")) {
            const attachname = "F355DATA." + Extensions[Number(circuit)];
            const vmi = await makeVmi(replayPath, attachname);
            res.type("application/x-dreamcast-vms-info");
            res.end(vmi);
        }
        else if (req.url.endsWith(".VMS")) {
            const fileData = await fs.readFile(replayPath);
            res.type("application/x-dreamcast-vms");
            res.end(fileData);
        }
        else {
            res.statusCode = 404;
            res.end();
            logger.error("downloadReplay: invalid url " + req.url);
        }
    } catch (err) {
        logger.error("downloadReplay: " + err);
        res.statusCode = 404;
        res.end();
    }
}
