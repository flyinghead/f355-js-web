import { logger, getCircuitName } from "./f355";
import express = require('express');
import { SqlError } from "mariadb";
import { getRace } from "./database";
import { parse as parseLanguage } from "accept-language-parser";
import { circuitGifs, circuitTGifs } from "./images";

export async function viewRace(req: express.Request, res: express.Response)
{
    let id = parseInt(req.query.id as string);
    if (isNaN(id)) {
        res.status(404).send("Missing race identifier");
        return;
    }
    let language = 'ja';
    const langidx = req.url.indexOf('net_rank_');
    if (langidx != -1)
        language = req.url.slice(langidx + 9, langidx + 9 + 2);
    let languages = parseLanguage(req.get('Accept-Language'));
    if (languages.length === 0)
        languages = [{ code: "en", quality: 1 }];
    let bestlang = languages[0].code;
    if (languages[0].region !== undefined)
        bestlang += '-' + languages[0].region;
    const dateTimeFormat = new Intl.DateTimeFormat(bestlang, {
        timeStyle: "short",
        dateStyle: "short",
      });
    try {
        const race = await getRace(id);
        const data = {
            language: language,
            race: race,
            upUrl: `view_races.cgi?page=${req.query.page}&circuit=${req.query.circuit ?? ''}`,

            raceDate: dateTimeFormat.format(race.race_date),
            circuitName: getCircuitName(race.circuit),
            circuitNameLow: getCircuitName(race.circuit).toLowerCase(),
            headTgif: circuitTGifs[race.circuit],
            headgif: circuitGifs[race.circuit],

            getTime: (t: number) => {
                if (t <= 0)
                    return "No Goal";
                else
                    return Math.trunc(t / 60000).toString().padStart(2, '0')
                        + "'" + Math.trunc((t % 60000) / 1000).toString().padStart(2, '0')
                        + '"' + Math.trunc(t % 1000).toString().padStart(3, '0');
            }
        };
        res.render('view_race', data, (err, html) => {
            if (err)
                throw err;
            // Convert from UTF-8 to ISO-8859-1
            res.type("text/html; charset=iso-8859-1");
            const buf = Buffer.from(html, "latin1");
            res.end(buf);
        });
    } catch (err) {
        logger.error("viewRace: " + err);
        res.statusCode = 500;
        if (err instanceof SqlError)
            res.statusMessage = "Database error";
        res.end();
    }
}
