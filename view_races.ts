import { logger, getCircuitName } from "./f355";
import express = require('express');
import { SqlError } from "mariadb";
import { getRaces } from "./database";
import { parse as parseLanguage } from "accept-language-parser";
import { dictionaries } from "./i18n";

export async function viewRaces(req: express.Request, res: express.Response)
{
    let page = parseInt(req.query.page as string);
    if (isNaN(page))
        page = 0;
    let circuit: number | undefined = parseInt(req.query.circuit as string);
    let circuitParam = "";
    if (isNaN(circuit) || circuit >= 6)
        circuit = undefined;
    else
        circuitParam = `&circuit=${circuit}`;
    let language = 'ja';
    const langidx = req.url.indexOf('net_rank_');
    if (langidx != -1)
        language = req.url.slice(langidx + 9, langidx + 9 + 2);
    const dict = (dictionaries as any)[language === 'uk' ? 'en' : language];
    let browserlangs = parseLanguage(req.get('Accept-Language'));
    if (browserlangs.length === 0)
        browserlangs = [{ code: language === 'uk' ? 'en' : language, quality: 1 }];
    let bestlang = browserlangs[0].code;
    if (browserlangs[0].region !== undefined)
        bestlang += '-' + browserlangs[0].region;
    const dateTimeFormat = new Intl.DateTimeFormat(bestlang, {
        timeStyle: "short",
        dateStyle: "short",
      });
    try {
        const races = await getRaces(page, circuit);
        const data = {
            language: language,
            races: races,
            prevPageUrl: page > 0 ? `view_races.cgi?page=${Math.max(0, page - 20)}` + circuitParam : '',
            nextPageUrl: races.length == 20 ? `view_races.cgi?page=${page + 20}` + circuitParam : '',
            baseUrl: `/f355/ranking_${language}/RANK`,
            upUrl: circuit === undefined ? `/f355/ranking_${language}/RANK/index.html` : 'view_races.cgi',
            viewRaceUrl: `view_race.cgi?page=${page}&circuit=${circuit ?? ''}&id=`,
            msg: dict,

            getDate: (index: number) => {
                return dateTimeFormat.format(races[index].race_date);
            },
            circuitName(circuit: number) { return getCircuitName(circuit); }
        };
        res.render('view_races', data, (err, html) => {
            if (err)
                throw err;
            // Convert from UTF-8 to ISO-8859-1
            res.type("text/html; charset=iso-8859-1");
            const buf = Buffer.from(html, "latin1");
            res.end(buf);
        });
    } catch (err) {
        logger.error("viewRaces: " + err);
        res.statusCode = 500;
        if (err instanceof SqlError)
            res.statusMessage = "Database error";
        res.end();
    }
}
