import * as f355 from "./f355";
import { logger } from "./f355";
import { dictionaries } from "./i18n";
import { getResults, Result } from "./database";
import express = require('express');
import { SqlError } from "mariadb";
import iconv from 'iconv-lite';

const circuitGifs = [
    "F355_ssuz.gif", "F355_mote.gif", "F355_suzu.gif", "F355_long.gif",
    "F355_sugo.gif", "F355_monz.gif", "", "F355_fior.gif",
    "F355_nurb.gif", "F355_lagu.gif", "F355_sepa.gif", "F355_atla.gif"
];
const circuitTGifs = [
    "F355_T_ssuz.gif", "F355_T_mote.gif", "F355_T_suzu.gif", "F355_T_long.gif",
    "F355_T_sugo.gif", "F355_T_monz.gif", "", "F355_T_fior.gif",
    "F355_T_nurb.gif", "F355_T_lagu.gif", "F355_T_sepa.gif", "F355_T_atla.gif"
];
function getPageUrl(index: number, data: any): string
{
    let url = "view_rank.cgi?";
    url += "circuit=" + data.circuit
        + "&semiAuto=" + (data.semiAuto ? "1" : "0")
        + "&index=" + Math.max(1, index + 1);
    if (data.country != -1)
        url += "&country=" + data.country;
    if (data.assisted != -1)
        url += "&assisted=" + data.assisted;
    if (data.tuned != -1)
        url += "&tuned=" + data.tuned;
    if (data.raceMode != -1)
        url += "&raceMode=" + data.raceMode;
    if (data.machine != -1)
        url += "&arcade=" + data. machine;
    
    return url;
}
function getF355Home(language: string)
{
    switch (language) {
        case "ja": return "/f355/jp/";
        case "en": return "/f355/us/";
        default: return "/f355/eu/";
    }
}

export async function viewRank(req: express.Request, res: express.Response)
{
    let circuit = parseInt(req.query.circuit as string);
    if (isNaN(circuit))
        circuit = 1;
    const semiAuto = parseInt(req.query.semiAuto as string) === 1;
    let index = parseInt(req.query.index as string ?? 1) - 1;
    if (isNaN(index))
        index = 0;
    let country = parseInt(req.query.country as string);
    if (isNaN(country))
        country = -1;
    let assisted = parseInt(req.query.assisted as string);
    if (isNaN(assisted))
        assisted = -1;
    let tuned = parseInt(req.query.tuned as string);
    if (isNaN(tuned))
        tuned = -1;
    let raceMode = parseInt(req.query.raceMode as string);
    if (isNaN(raceMode))
        raceMode = -1;
    let arcade = parseInt(req.query.arcade as string);
    if (isNaN(arcade))
        arcade = -1;
    let language = 'ja';
    const langidx = req.url.indexOf('net_rank_');
    if (langidx != -1)
        language = req.url.slice(langidx + 9, langidx + 9 + 2);
    const dict = (dictionaries as any)[language === 'uk' ? 'en' : language];
    try {
        const results = await getResults(circuit, semiAuto, index, 10, country, assisted, tuned, raceMode, arcade);
        const data = {
            language: language,
            country: country,
            assisted: assisted,
            tuned: tuned,
            raceMode: raceMode,
            machine: arcade,
            index: index + 1,
            circuit: circuit,
            semiAuto: semiAuto ? 1 : 0,
            semiAutoLabel: semiAuto ? "SA" : "AT",
            circuitName: f355.getCircuitName(circuit),
            circuitNameLow: f355.getCircuitName(circuit).toLowerCase(),
            headTgif: circuitTGifs[Math.min(circuit, circuitTGifs.length - 1)],
            headgif: circuitGifs[Math.min(circuit, circuitGifs.length - 1)],
            results: results,
            previousPageUrl: '',
            nextPageUrl: '',
            home: getF355Home(language),
            baseUrl: `/f355/ranking_${language}/RANK/RANKCOURSE`,
            msg: dict,

            getRaceModeIcon: (result: Result) => {
                switch (result.raceMode)
                {
                    case 0: return "icon_training.gif";
                    case 1: return "icon_free.gif";
                    default: return "icon_race.gif";
                }
            },
            getRaceModeAlt: (result: Result) => {
                switch (result.raceMode)
                {
                    case 0: return "Training";
                    case 1: return "Drive";
                    default: return "Race";
                }
            },
            getDataUrl: (result: Result) => {
                if (result.dataPath === null)
                    return "";
                const userAgent = req.headers["user-agent"];
                if (userAgent === undefined
                        || (!userAgent.includes("DreamKey") && !userAgent.includes("DreamPassport")))
                    return "";
                return `/cgi-bin/f355/download.cgi/${circuit}/${result.dataPath}/GHOSTDAT.VMI`;
            }
        };
        if (index > 0)
            data.previousPageUrl = getPageUrl(index - 10, data);
        if (results.length == 10)
            data.nextPageUrl = getPageUrl(index + 10, data);
        res.render('view_rank', data, (err, html) => {
            if (err)
                throw err;
            // Convert from UTF-8 to ISO-8859-1 or Shift-JIS
            let buf: Buffer;
            if (language === 'ja') {
                res.type("text/html; charset=x-sjis");
                buf = iconv.encode(html, 'Shift_JIS');
            }
            else {
                res.type("text/html; charset=iso-8859-1");
                buf = Buffer.from(html, "latin1");
            }
            res.end(buf);
        });
    } catch (err) {
        logger.error("viewRank: " + err);
        res.statusCode = 500;
        if (err instanceof SqlError)
            res.statusMessage = "Database error";
        res.end();
    }
}

/* TEST
app.get('/cgi-bin/f355/net_rank_en/view_rank.cgi', async (req, res) => {
    let circuit = 1;
    let semiAuto = false;
    let index = 0;
    let country = 'AA';
    if (req.url !== undefined) {
        const args = req.url.split('?');
        if (args.length >= 2) {
            if (args[1].length >= 2) {
                semiAuto = args[1].slice(-1) == '1';
                circuit = parseInt(args[1].slice(0, args[1].length - 1));
                if (isNaN(circuit) || circuit > f355.NET_CIRCUIT_COUNT - 1 || circuit == 6)
                    circuit = 1;
            }
            if (args.length >= 3) {
                index = parseInt(args[2]);
                if (isNaN(index))
                    index = 0;
                if (args.length >= 4) {
                    // mode?
                    if (args.length >= 5) {
                        country = args[4];
                        if (country != 'AA' && country != 'JP' && country != 'AM' && country != 'EU' && country != '--')
                            country = 'AA';
                    }
                }
            }
        }
    }
    res.send(`circuit ${circuit} semiAuto ${semiAuto} index ${index} country ${country}`);
});
*/
