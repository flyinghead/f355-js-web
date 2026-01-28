import http from "http";
import { logger } from "./f355";
import netplayRequestListener from "./netplay";
import express from 'express';
import { viewRank } from "./view_rank";
import { viewRaces } from "./view_races";
import { viewRace } from "./view_race";
import { playerDataUpload, playerDataSet, uploadReplay } from "./netrank";
import { downloadReplay } from "./download";
import path from 'path';
import * as discord from "./discord";
import * as status from "./status";

const app = express();
app.use(express.urlencoded());
app.set('view engine', 'ejs');
app.use(function(req, res, next) {
    if (req.url.startsWith('/f355/ranking_')
        && ((req.url.endsWith('.gif') || req.url.endsWith('.jpg') || req.url.endsWith('.jpeg')))) {
        // all ranking pics are under /ranking_ja/
        req.url = '/f355/ranking_ja' + req.url.substring(16);
    }
    next();
});
const options = {
    setHeaders: function(res: http.ServerResponse, path: string, stat: unknown) {
        if (path.endsWith('.html'))
            // Remove the (wrong) charset=utf8 set by express.static
            // Let the browser rely on the (correct) <meta http-equiv="Content-Type" ...> tag
            res.setHeader('Content-Type', 'text/html');
    }
};
app.use(express.static(path.join(__dirname, 'static'), options));

app.get('/f355', (req, res) => {
    res.redirect('/f355/jp');
});

app.get(new RegExp('/cgi-bin/f355/net_rank.../view_rank.cgi'), viewRank);

app.post(new RegExp('/cgi-bin/f355/..3_player_data.cgi'), playerDataUpload);
app.post('/cgi-bin/f355/set_player_data.cgi', playerDataSet);
app.post('/cgi-bin/f355/dp3_player_replay.cgi', uploadReplay);

app.get('/cgi-bin/f355/download.cgi/:circuit/:file/:vmivms', downloadReplay);
app.get(new RegExp('/cgi-bin/f355/net_rank.../view_races.cgi'), viewRaces);
app.get(new RegExp('/cgi-bin/f355/net_rank.../view_race.cgi'), viewRace);

discord.init();
status.init();

const server = http.createServer((req, res) => {
    netplayRequestListener(req, res, app);
});
server.listen(process.env.PORT || 3000, () => logger.info("F355 server started"));
