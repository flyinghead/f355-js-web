import { logger } from "./f355";
import mariadb from 'mariadb';
import * as fs from 'node:fs/promises';
import { getResultDir } from "./f355";
import path from "node:path";
import { Race } from "./race"

const pool = mariadb.createPool({
    host: 'localhost', 
    user: process.env.DB_USER ?? 'f355', 
    password: process.env.DB_PASSWORD ?? 'pouetpouet',
    connectionLimit: 5,
    allowPublicKeyRetrieval: true,
    database: "f355",
    insertIdAsNumber: true,
});

export class Result
{
    constructor(
        readonly name: string,
        readonly scoreName: string,
        readonly country: number,
        readonly assisted: number,
        readonly tuned: number,
        readonly raceMode: number,
        readonly arcade: number, 
        readonly dataPath: string | null,
        readonly runTime: number,
        readonly runDate: Date)
    {}

    getRunDateString() {
		return this.runDate.getFullYear()
            + '/' + (this.runDate.getMonth() + 1).toString().padStart(2, '0')
            + '/' + this.runDate.getDate().toString().padStart(2, '0');
	}

    getRunTimeString() {
        return Math.trunc(this.runTime / 100000).toString()
            + "'" + Math.trunc((this.runTime % 100000) / 1000).toString().padStart(2, '0')
            + '"' + Math.trunc(this.runTime % 1000).toString().padStart(3, '0');
    }
}

type LapTime = {
    circuit: number;
    semiAuto: boolean;
    time: number;
    raceMode: number;
    assist: boolean;
    tuned: boolean;
    arcade: boolean;
    maxSpeed: number;
};

const TrackOffset = [ 1, 0, 4, 5, 3, 2, -1, 11, 8, 9, 10, 7	];

export class Player
{
    constructor(
        readonly regId: string,
        readonly name: string,
        readonly country: string,
        readonly scoreName: string,
        readonly data: Buffer)
    {}

    #bytesToBCM(offset: number) {
		// ms
		let t = this.data[offset] | (this.data[offset + 1] << 8);
		if (t === 0xffff && this.data[offset + 2] === 0xff && this.data[offset + 3] === 0xff)
			return -1;
		// sec
		t +=  this.data[offset + 2] * 1000;
		// min
		t +=  this.data[offset + 3] * 100000;
		return t;
	}

    getLapTime(circuit: number, semiAuto: boolean): LapTime | undefined {
        if (circuit >= TrackOffset.length)
            return undefined;
        let offset = TrackOffset[circuit] * 4;
        if (offset < 0)
			return undefined;
        offset += 0xd0 + (semiAuto ? 0x30 : 0);
        const time = this.#bytesToBCM(offset);
        if (time <= 0)
			return undefined;
  
		const b = this.data[offset + 0x90];
		const raceMode = (b & 8) != 0 ? 2	// race
				: (b & 4) != 0 ? 1		    // drive/free
				: 0;					    // training
		const assist = (b & 1) != 0;
		const tuned = (b & 2) != 0;
		const arcade = (b & 0x100) != 0;

        offset = 0x1fc + TrackOffset[circuit] * 2;
        // max speed stored in m/s so convert to km/h
        const maxSpeed = (this.data[offset] / 256 + this.data[offset + 1]) * 3.6;
        return { circuit, semiAuto, time, raceMode, assist, tuned, arcade, maxSpeed };
    }

    getPlayCount(): number {
        return this.data.readUint32LE(0xc8);
    }

    getDistanceDriven(): number {
        return this.data.readUint32LE(0xcc);
    }
};

export async function getResults(circuit: number, semiAuto: boolean, index: number, count: number, 
    country: number, assisted: number, tuned: number, raceMode: number, arcade: number): Promise<Result[]>
{
    let conn;
    try {
        conn = await pool.getConnection();
        let query = "SELECT player.name, player.score_name, player.country, assisted, tuned, "
            + "race_mode, arcade, data_path, run_time, run_date "
            + "FROM result INNER JOIN player ON result.player_id = player.id "
            + "WHERE circuit = ? AND semi_auto = ?";
        switch (country)
        {
        case 0: // japan
            query += " AND player.country = 'JP'";
            break;
        case 1: // america
            query += " AND player.country IN ('US', 'CA', 'MX')";
            break;
        case 2: // europe
            query += " AND player.country in ('UK', 'FR', 'DE', 'ES', 'IT', 'IS', 'FI', 'NO', 'SE',"
					+ " 'NL', 'LU', 'BE', 'AT', 'CH', 'GR', 'PT', 'IE')";
            break;
        case 3: // not set
            query += " AND player.country = '--'";
            break;
        }
        if (assisted === 0 || assisted === 1)
			query += " and assisted = " + assisted;
        if (tuned === 0 || tuned === 1)
			query += " and tuned = " + tuned;
        if (raceMode === 0) // training/driving
            query += " and race_mode != 2";
        else if (raceMode === 1) // race
            query += " and race_mode = 2";
        if (arcade === 0 || arcade === 1)
            query += " and arcade = " + arcade;
        query += ` ORDER BY run_time, run_date LIMIT ${count} OFFSET ${index}`;

        const rows = await conn.query({ rowsAsArray: true, sql: query }, [circuit, semiAuto]);
        let results = new Array<Result>(0);
        for (let row of rows) {
            logger.debug(`result by ${row[0]} set on ${row[9]}`);
            const result = new Result(row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9]);
            results.push(result);
        }
        return results;
    } catch (err) {
        throw err;
    } finally {
        if (conn)
            conn.end();
    }
}

function getRegId(data: Buffer): string | undefined {
    if (data.length != 0x300)
        return undefined;
    else
        return data.toString('ascii', 0, 16);
}

export async function createUpdatePlayer(data: Buffer, ipAddress: string): Promise<Player | undefined>
{
    const regId = getRegId(data);
    if (regId === undefined) {
        logger.error("createUpdatePlayer: invalid registration data");
        return undefined;
    }
    let conn;
    try {
        let scoreName = data.toString('ascii', 0x20, 0x23);
        conn = await pool.getConnection();
        const select = "SELECT score_name FROM player WHERE reg_id = ?";
        const rows = await conn.query({ rowsAsArray: true, sql: select }, [regId]);
        if (rows.length == 0) {
            // New user
            await conn.query("INSERT INTO player (reg_id, score_name, created, created_ip) VALUES (?, ?, ?)",
                [regId, scoreName, new Date(), ipAddress]);
        }
        else if (rows[0][0] !== null) {
            scoreName = rows[0][0];
        }
        const name = data.toString('ascii', 0x24, 0x24 + 12);
        const country = data.toString('ascii', 0x30, 0x33).trim();
        
        const update = "UPDATE player SET name = ?, country = ?, reg_data = ?, last_seen = ?, last_seen_ip = ? "
            + "WHERE reg_id = ?";
        await conn.query(update, [name, country, data, new Date(), ipAddress, regId]);
        const player = new Player(regId, name, country, scoreName, data);
        
        return player;
    } catch (err) {
        throw err;
    } finally {
        if (conn)
            conn.end();
    }
}

async function getPlayerInternal(conn: mariadb.PoolConnection, regId: string): Promise<Player> {
    const select = "SELECT name, country, score_name, reg_data "
        + "FROM player "
        + "WHERE reg_id = ?";
    const rows = await conn.query({ rowsAsArray: true, sql: select }, [regId]);
    if (rows.length == 0)
        throw new Error("Player not found");
    return new Player(regId, rows[0][0], rows[0][1], rows[0][2], rows[0][3]);
}

export async function getPlayer(regId: string): Promise<Player> {
    let conn;
    try {
        conn = await pool.getConnection();
        return getPlayerInternal(conn, regId);
    } catch (err) {
        throw err;
    } finally {
        if (conn)
            conn.end();
    }
}

export async function updateScoreName(regId: string, scoreName: string, ipAddress: string): Promise<Player>
{
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query("UPDATE player SET score_name = ?, last_seen = ?, last_seen_ip = ? WHERE reg_id = ?",
            [scoreName, new Date(), ipAddress, regId]);
        return getPlayerInternal(conn, regId);
    } catch (err) {
        throw err;
    } finally {
        if (conn)
            conn.end();
    }
}

export async function saveBestLap(regId: string, circuit: number, semiAuto: boolean)
{
    let conn;
    try {
        conn = await pool.getConnection();
        const player = await getPlayerInternal(conn, regId);
        const lapTime = player.getLapTime(circuit, semiAuto);
        if (lapTime === undefined)
            return;
        let playerId: number | undefined;
        const select = "SELECT result.id, player_id, run_time "
            + "FROM result INNER JOIN player ON result.player_id = player.id "
            + "WHERE circuit = ? AND semi_auto = ? AND player.reg_id = ?";
        const rows = await conn.query({ rowsAsArray: true, sql: select }, [circuit, semiAuto, regId]);
        if (rows.length > 0) {
            const t = Number(rows[0][2]);
            if (t <= lapTime.time)
                // Same or better time already saved
                return;
            await conn.query("DELETE FROM result WHERE id = ?", [rows[0][0]]);
            playerId = rows[0][1];
        }
        else {
            const rows = await conn.query({ rowsAsArray: true, sql: "SELECT id FROM player WHERE reg_id = ?" }, [regId]);
            if (rows.length === 0)
                throw new Error("saveBestLap: Player record not found");
            playerId = rows[0][0];
        }
        const insert = "INSERT INTO result (player_id, circuit, semi_auto, run_date, race_mode, tuned, assisted, arcade, run_time) "
            + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
        await conn.query(insert, [playerId, circuit, semiAuto ? 1 : 0, new Date(), 
            lapTime.raceMode, lapTime.tuned ? 1 : 0, lapTime.assist ? 1 : 0, lapTime.arcade ? 1 : 0, lapTime.time]);
    } catch (err) {
        throw err;
    } finally {
        if (conn)
            conn.end();
    }
}

function getCircuitId(data: Buffer)
{
    const circuitName = data.toString("ascii", 31, 43);
    if (circuitName.startsWith("SUZUKA SHORT"))
        return 0;
    if (circuitName.startsWith("MOTEGI"))
        return 1;
    if (circuitName.startsWith("SUZUKA"))
        return 2;
    if (circuitName.startsWith("LONG-BEACH"))
        return 3;
    if (circuitName.startsWith("SUGO"))
        return 4;
    if (circuitName.startsWith("MONZA"))
        return 5;
    if (circuitName.startsWith("FIORANO"))
        return 7;
    if (circuitName.startsWith("NURBURGRING"))
        return 8;
    if (circuitName.startsWith("LAGUNA-SECA"))
        return 9;
    if (circuitName.startsWith("SEPANG"))
        return 10;
    if (circuitName.startsWith("ATLANTA"))
        return 11;
    
    throw new Error("Unknown circuit");
}

// in "minute coded decimal"
function getRunTime(data: Buffer)
{
    const zero = '0'.charCodeAt(0);
    return (data[0] - zero) * 100000
            + (data[2] - zero) * 10000
            + (data[3] - zero) * 1000
            + (data[5] - zero) * 100
            + (data[6] - zero) * 10
            + data[7] - zero;
}

/*
function getRaceMode(data: Buffer)
{
    switch (data[8])
    {
    case 'T'.charCodeAt(0):
        return 0;
    case 'F'.charCodeAt(0):
    default:
        return 1;
    case 'R'.charCodeAt(0):
        return 2;
    }
}
*/

export async function saveResult(regId: string, data: Buffer, fileName: string, ipAddress: string): Promise<Player>
{
    const dataRegId = data.toString("ascii", 0x290, 0x2A0);
    if (dataRegId !== regId)
        throw new Error("Incorrect registration");
    let conn;
    try {
        conn = await pool.getConnection();
        const player = await getPlayerInternal(conn, regId);
        const circuit = getCircuitId(data);
        const semiAuto = data[10] === 'S'.charCodeAt(0) && data[11] === 'A'.charCodeAt(0);
        const runTime = getRunTime(data);

        const select = "SELECT result.id, run_time, data_path "
            + "FROM result INNER JOIN player ON result.player_id = player.id "
            + "WHERE circuit = ? AND semi_auto = ? AND player.reg_id = ?";
        const rows = await conn.query({ rowsAsArray: true, sql: select }, [circuit, semiAuto, regId]);
        if (rows.length === 0 || rows[0][1] != runTime)
            throw new Error("Time not registered");
        await conn.query("UPDATE result SET data_path = ? WHERE id = ?", [fileName, rows[0][0]]);
        if (rows[0][2] !== null)
            fs.rm(path.join(getResultDir(), rows[0][2]));

        return player;
    } catch (err) {
        throw err;
    } finally {
        if (conn)
            conn.end();
    }
}

export async function saveRace(race: Race): Promise<number | undefined>
{
    let conn;
    try {
        conn = await pool.getConnection();
        const insert = "INSERT INTO race (race_date, circuit, weather) VALUES (?, ?, ?)";
        const ret = await conn.query(insert, [race.startTime, race.circuit, race.weather]);
        return ret.insertId;
    } catch (err) {
        throw err;
    } finally {
        if (conn)
            conn.end();
    }
}

export async function saveQualifier(raceId: number, name: string, country: string,
    carNum: number, carColor: number, intermediate: boolean, time: number, rank: number): Promise<number | undefined>
{
    let conn;
    try {
        conn = await pool.getConnection();
        const insert = "INSERT INTO racer (race_id, name, country, car_number, car_color, intermediate, qualif_time, qualif_rank)"
            + " VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
        const ret = await conn.query(insert, [raceId, name, country, carNum, carColor, intermediate ? 1 : 0, time, rank]);
        return ret.insertId;
    } catch (err) {
        throw err;
    } finally {
        if (conn)
            conn.end();
    }
}

export async function saveRaceResult(racerId: number, time: number, rank: number)
{
    let conn;
    try {
        conn = await pool.getConnection();
        const update = "UPDATE racer SET race_time = ?, race_rank = ? WHERE id = ?";
        conn.query(update, [time, rank, racerId]);
    } catch (err) {
        throw err;
    } finally {
        if (conn)
            conn.end();
    }
}

export class Racer
{
    constructor(
        readonly id: number,
        readonly name: string,
        readonly country: string,
        readonly carNumber: number,
        readonly carColor: number,
        readonly intermediate: boolean,
        readonly qualifTime: number,
        readonly qualifRank: number,
        readonly raceTime: number | undefined,
        readonly raceRank: number | undefined)
    {}
};

export class NetRace
{
    constructor(
        readonly id: number,
        readonly race_date: Date,
        readonly circuit: number,
        readonly weather: number,
        readonly racers: number,
        readonly finishers: number | undefined)
    {}
    qualifiers: Racer[] | undefined;
    results: Racer[] | undefined;
};

export async function getRaces(first: number, circuit: number | undefined): Promise<NetRace[]>
{
    let conn;
    try {
        conn = await pool.getConnection();
        let select = "SELECT race.id, race_date, circuit, weather, COUNT(racer.id) as racers FROM race JOIN racer "
            + "ON race.id = racer.race_id ";
        const values = [ ];
        if (circuit !== undefined) {
            select += "WHERE circuit = ? ";
            values.push(circuit);
        }
        values.push(first);
        select += "GROUP BY race.id ORDER BY race_date DESC LIMIT ?, 20";
        return conn.query(select, values);
    } catch (err) {
        throw err;
    } finally {
        if (conn)
            conn.end();
    }
}

export async function getRace(id: number): Promise<NetRace>
{
    let conn;
    try {
        conn = await pool.getConnection();
        const select = "SELECT race_date, circuit, weather, COUNT(racer.id) as racers, MAX(racer.race_rank) as finishers "
            + "FROM race JOIN racer ON race.id = racer.race_id WHERE race.id = ?";
        const races = await conn.query<NetRace[]>(select, [id]);
        if (races.length === 0)
            throw Error("Invalid race identifier");
        const race = races[0];
        race.qualifiers = new Array<Racer>(race.racers);
        race.results = new Array<Racer>(race.finishers ?? 0);
        const select2 = "SELECT id, name, country, car_number as carNumber, car_color as carColor, intermediate, qualif_time as qualifTime, "
            + "qualif_rank as qualifRank, race_time as raceTime, race_rank as raceRank FROM racer WHERE race_id = ?";
        const racers = await conn.query<Racer[]>(select2, [id]);
        racers.forEach((racer) => {
            if (racer.raceRank !== undefined)
                race.results![racer.raceRank - 1] = racer;
            if (racer.qualifRank !== undefined)
                // happens for imported races
                race.qualifiers![racer.qualifRank - 1] = racer;
        });
        return race;
    } catch (err) {
        throw err;
    } finally {
        if (conn)
            conn.end();
    }
}