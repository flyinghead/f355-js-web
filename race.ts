import { Dir } from "node:fs";
import * as f355 from "./f355";
import { logger } from "./f355";
import * as fs from 'node:fs/promises'
import * as discord from "./discord"
import { saveRace, saveQualifier, saveRaceResult } from "./database";
import path from "node:path";
import { Config } from "./config";

const makeId = function(): number {
    return f355.getRandomInt(10000000); // MUST be less than 10 million for correct qualifier ranking
}

class Entry
{
    readonly id: number;
    readonly entryData: Buffer;
    readonly circuit: number;
    readonly intermediate: boolean;
    readonly weather: number;
    readonly carNum: number;
    readonly carColor: number;
    readonly created = new Date();
    lastHeardOf = new Date(); // entry checked every 3 sec

    constructor(entryData: Buffer) {
        this.id = makeId();
        this.entryData = entryData;
        this.circuit = Math.min(f355.NET_CIRCUIT_COUNT - 1, Math.max(0, entryData[108]));
        this.intermediate = entryData[112] != 0;
        this.weather = entryData[116];
        this.carNum = entryData[124];
        this.carColor = entryData[125];
    }

    getName() {
        return f355.getPlayerName(this.entryData);
    }
}

let intervalId: NodeJS.Timeout | undefined;

class WaitingList
{
    addEntry(entry: Entry): void
    {
        this.timeoutEntries();
        this.entries.set(entry.id, entry);
        startTimer();
        let allPlayers = new Array<string>();
        for (let entry of this.entries.values())
            allPlayers.push(entry.getName());
        allPlayers.sort();
        discord.playerWaiting(entry.getName(), f355.getCircuitName(entry.circuit), allPlayers);
    }
    
    checkEntry(id: number): number
    {
        this.timeoutEntries();
        let entry = this.entries.get(id);
        if (entry === undefined)
            return -1;
        entry.lastHeardOf = new Date();
        return this.entries.size;
    }

    timeoutEntries(): void
    {
        let timeout = Date.now() - 20000;	// 20 sec time out
        for (let [id, entry] of this.entries) {
            if (entry.lastHeardOf.getTime() <= timeout) {
                logger.info(`Entry ${id} has timed out`);
                this.entries.delete(id);
            }
        }
    }

    entries = new Map<number, Entry>();
}
const waitingList = new WaitingList();

export const STATUS_INIT = 0;
export const STATUS_QUALIF = 1;
export const STATUS_FINAL = 2;
export const STATUS_FINISHED = 3;

export class Race
{
    readonly circuit: number;
    readonly weather: number;
    status = STATUS_INIT;
    startTime = new Date();
    #entries = new Map<number, Buffer>();
    #qualifiers = new Map<number, Buffer>();
    #qualifiedRank = new Map<number, number>();
    #results = new Map<number, Buffer>();
    #dbId: number | undefined;
    #racerDbIds = new Map<number, number>();
    #raceDir: string | undefined;

    constructor(circuit: number, weather: number) {
        this.circuit = circuit;
        this.weather = weather;
    }

    async setStatus(status: number): Promise<void> {
		if (status === this.status)
            return;
        this.status = status;
        this.startTime = new Date();
        if (status === STATUS_FINAL)
        {
            // Calculate the qualifier ranking
            let ids = Array.from(this.#entries.keys());
            ids.sort((i1, i2) => {
                let q1 = this.getQualifier(i1) ?? Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
                let q2 = this.getQualifier(i2) ?? Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
                let frames1 = q1.readUint32LE(0);
                let frames2 = q2.readUint32LE(0);
                if (frames1 != frames2)
                    return frames1 - frames2;

                let frac1 = q1.readFloatLE(4);
                let frac2 = q2.readFloatLE(4);
                return frac1 < frac2 ? -1 : frac1 > frac2 ? 1 : 0;
            });
            for (let i = 0; i < ids.length; i++)
                this.#qualifiedRank.set(ids[i], i + 1);
            // Save the race and qualifiers to the db and file
            try {
                this.#dbId = await saveRace(this);
                if (this.#dbId === undefined)
                    return;
                ids.forEach(async id => {
                    const entryData = this.#entries.get(id)!;
                    const entry = new Entry(entryData);
                    const rank = this.#qualifiedRank.get(id);
                    if (rank === undefined)
                        return;
                    const qualif = this.getQualifier(id)!;
                    let time = qualif.readUint32LE(0);
                    if (time == 0xfffff) {
                        time = -1;
                    }
                    else {
                        time = (time + qualif.readFloatLE(4)) / 60.2;
                        time = Math.trunc(time * 1000);
                    }
                    const dbId = await saveQualifier(this.#dbId!, f355.getRacerName(entryData), f355.getPlayerCountry(entryData), 
                        entry.carNum, entry.carColor, entry.intermediate, time, rank);
                    if (dbId !== undefined)
                        this.#racerDbIds.set(id, dbId);
                    this.saveQualifierToFile(id, entryData, qualif);
                });
            } catch (err) {
                logger.error("Database error: " + err);
            }
        }
        else if (status === STATUS_FINISHED && this.#dbId !== undefined)
        {
            // Save final results to the db
            try {
                let ids = Array.from(this.#results.keys());
                ids.sort((id1, id2) => {
                    const r1 = this.#results.get(id1)!;
                    const r2 = this.#results.get(id2)!;
                    const t1 = r1.readUInt32LE(12) * 1000 + r1.readUInt32LE(16);
                    const t2 = r2.readUInt32LE(12) * 1000 + r2.readUInt32LE(16);
                    return t1 - t2;
                });
                ids.forEach(async (id, index) => {
                    const dbId = this.#racerDbIds.get(id);
                    if (dbId === undefined)
                        return;
                    const result = this.#results.get(id)!;
                    let time = result.readUInt32LE(12);
                    if (time == 0xfffff)
                        time  = -1;
                    else
                        time = time * 1000 + result.readUInt32LE(16);
                    saveRaceResult(dbId, time, index + 1);
                });
            } catch (err) {
                logger.error("Database error: " + err);
            }
        }
	}

    getCircuitName(): string {
		return f355.getCircuitName(this.circuit);
	}

    addTime(ms: number): void {
		this.startTime = new Date(this.startTime.getTime() + ms);
	}

    getEntry(id: number): Buffer | undefined {
		return this.#entries.get(id);
	}
    getEntryCount(): number {
		return this.#entries.size;
	}
    getEntryName(id: number): string {
		return f355.getPlayerName(this.getEntry(id));
	}
    setEntry(id: number, entry: Buffer): void {
		this.#entries.set(id, entry);
	}
    deleteEntry(id: number): void {
		this.#entries.delete(id);
		this.#qualifiers.delete(id);
		this.#results.delete(id);
	}
    getEntryIds() {
        return this.#entries.keys();
    }

    getQualifier(id: number): Buffer | undefined {
		return this.#qualifiers.get(id);
	}
    setQualifier(id: number, result: Buffer): void {
		this.#qualifiers.set(id, result);
	}
    isQualifierDone(): boolean {
		return this.#entries.size === this.#qualifiers.size;
	}
    hasQualified(id: number): boolean {
		return this.getQualifierRanking(id) <= 8;
	}
    getQualifierRanking(id: number): number {
		return this.#qualifiedRank.get(id) ?? 17;
	}

    getResult(id: number): Buffer | undefined {
		return this.#results.get(id);
	}
    setResult(id: number, result: Buffer): void {
		this.#results.set(id, result);
	}
    isRaceDone(): boolean {
		return this.#entries.size == this.#results.size || this.#results.size == 8;
	}

    async getSaveDir(): Promise<string>
    {
        if (this.#raceDir === undefined) {
            this.#raceDir = path.join(Config.RACE_DIR, this.startTime.toISOString() + '_' + this.getCircuitName().replace(' ', '_'));
            await fs.mkdir(this.#raceDir, { recursive: true });
        }
        return this.#raceDir;
    }

    async saveQualifierToFile(id: number, entry: Buffer, qualifier: Buffer): Promise<void>
    {
        try {
            const racedir = await this.getSaveDir();
            const fpath = path.join(racedir, id.toString(16) + '_' + this.getEntryName(id).replace(' ', '_').replace('/', '_') + '_qualif.bin');
            const merged = Buffer.concat([ entry, qualifier ]);
            await fs.writeFile(fpath, merged);
        } catch (err) {
            logger.error('Saving qualifier failed: ' + err);
        }
    }
}
const races = new Array<Race>();
const raceById = new Map<number, Race>();

export function addEntry(data: Buffer): number {
    let entry = new Entry(data);
    waitingList.addEntry(entry);
    return entry.id;
}

export function findRace(id: number): Race | undefined
	{
		let race = raceById.get(id);
		if (race !== undefined)
			return race;
		let entry = waitingList.entries.get(id);
		if (entry !== undefined)
			checkStartRace();
		// a race might have started but the user isn't necessarily part of it
		return raceById.get(id);
	}

function enterRace(race: Race, id: number, entry: Buffer): void {
    race.setEntry(id, entry);
    raceById.set(id, race);
}

export function checkEntry(id: number): number {
	return waitingList.checkEntry(id);
}
export function getEntry(id: number): Entry | undefined {
	return waitingList.entries.get(id);
}

function checkStartRace(): void
{
    if (waitingList.entries.size <= 1)
        return;
    let racers: Entry[];
    if (waitingList.entries.size >= 16)
    {
        // Start the race now with the 16 oldest entries
        racers = Array.from(waitingList.entries.values())
            .sort((a, b) => {
                return a.created.getTime() - b.created.getTime();
            })
            .slice(0, 16);
    }
    else
    {
        // Start the race if at least 2 entries have been waiting for more that 90 sec
        const timeout = Date.now() - 90000;
        let timeoutEntries = 0;
        for (let entry of waitingList.entries.values())
        {
            if (entry.created.getTime() < timeout)
                timeoutEntries++;
        }
        if (timeoutEntries < 2)
            return;
        racers = Array.from(waitingList.entries.values());
    }
    let votes = new Array<number>(f355.NET_CIRCUIT_COUNT).fill(0);
    for (let entry of racers)
        votes[entry.circuit]++;

    let votedCircuit = 0;
    let maxVotes = 0;
    for (let i = 0; i < votes.length; i++) {
        if (votes[i] > maxVotes) {
            maxVotes = votes[i];
            votedCircuit = i;
        }
    }

    let race = new Race(votedCircuit, racers[0].weather);
    races.push(race);
    let racerNames = new Array<string>();
    for (let entry of  racers) {
        enterRace(race, entry.id, entry.entryData);
        waitingList.entries.delete(entry.id);
        racerNames.push(entry.getName());
    }
    race.setStatus(STATUS_QUALIF);
    
    racerNames.sort();
    discord.raceStart(race.getCircuitName(), racerNames);
}

async function getDefaultResult(race: Race): Promise<Buffer> {
    return fs.readFile(path.join(Config.GHOST_DIR, race.getCircuitName() + '_1.bin'));
}

async function timeoutRaces()
{
    const timeoutRaces = new Array<Race>();
    for (let race of races)
    {
        let time = 0;
        switch (race.status)
        {
        case STATUS_QUALIF:
            // add a 60 sec tolerance to the max qualifier time
            time = (f355.getQualifierTime(race.circuit) + 60) * 1000;
            break;
        case STATUS_FINAL:
            // add 3 min to the expected race time
            time = (f355.getQualifierTime(race.circuit) * f355.getLapCount(race.circuit) + 180) * 1000;
            break;
        case STATUS_FINISHED:
            // keep results for 5 min
            time = 5 * 60 * 1000;
            break;
        }
        if (time != 0 && race.startTime.getTime() + time < Date.now())
            timeoutRaces.push(race);
    }
    for (let race of timeoutRaces)
    {
        if (race.status == STATUS_QUALIF && race.getEntryCount() >= 3)
        {
            // Timeout individual racer if at least 2 remain
            for (let id of race.getEntryIds())
                if (race.getQualifier(id) === undefined) {
                    logger.info(`Race ${race.getCircuitName()} qualifier ${race.getEntryName(id)} has timed out`);
                    race.deleteEntry(id);
                    raceById.delete(id);
                }
            if (race.getEntryCount() >= 2)
                // Allow the race to start
                continue;
        }
        else if (race.status == STATUS_FINAL)
        {
            // Use default result for timed out drivers
            let defaultResult: Buffer | undefined;
            for (let id of race.getEntryIds())
                if (race.hasQualified(id) && race.getResult(id) === undefined)
                {
                    if (defaultResult === undefined)
                    {
                        try {
                            defaultResult = await getDefaultResult(race);
                        } catch (err) {
                            logger.error(`Can't load default result for track ${race.getCircuitName()}: ${err}`);
                        }
                        if (defaultResult === undefined)
                            break;
                    }
                    race.setResult(id, defaultResult);
                    logger.info(`Race ${race.getCircuitName()} driver ${race.getEntryName(id)} has timed out`);
                }
            if (defaultResult !== undefined) {
                race.setStatus(STATUS_FINISHED);
                continue;
            }
        }
        logger.info(`Race ${race.getCircuitName()} state ${race.status} timed out`);
        for (let id of race.getEntryIds())
            raceById.delete(id);
        races.splice(races.indexOf(race), 1);
    }
    waitingList.timeoutEntries();

    if (races.length === 0 && waitingList.entries.size === 0 && intervalId !== undefined)
        clearInterval(intervalId);
}

function startTimer(): void {
    if (intervalId === undefined)
        intervalId = setInterval(timeoutRaces, 15000);
}

export async function saveResultToFile(race: Race, id: number, result: Buffer): Promise<void>
{
    try {
        const racedir = await race.getSaveDir();
        const fpath = path.join(racedir, id.toString(16) + '_' + race.getEntryName(id).replace(' ', '_').replace('/', '_') + '.bin');
        await fs.writeFile(fpath, result);
        logger.debug('Result saved to ' + fpath);
    } catch (err) {
        logger.error('Saving result failed: ' + err);
    }
}

export function getRaceCount() {
    return races.length;
}

export function getPlayerCount() {
    let playerCount = waitingList.entries.size;
    races.forEach(race => {
        if (race.isRaceDone())
            return;
        playerCount += race.getEntryCount();
    });
    return playerCount;
}
