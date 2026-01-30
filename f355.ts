import winston from "winston";
import path from "node:path";
import { Config } from "./config";

export const logger = winston.createLogger({
    level: Config.LOG_LEVEL,
    format: winston.format.combine(
      process.env.DEV !== undefined ?
          winston.format.colorize({ all: true })
        : winston.format.uncolorize(),
      winston.format.timestamp({ format: "MM/DD HH:mm:ss" }),
      winston.format.printf((info) => `[${info.timestamp}][${info.level}] ${info.message}`)
    ),
    transports: [
        new winston.transports.Console({stderrLevels: ["error", "warn", "info", "debug"]})
    ]
  });

export const NET_CIRCUIT_COUNT = 6;
export const CIRCUIT_COUNT = 12;

export function getCircuitName(circuit: number) {
    switch (circuit)
    {
        case 0: return "SUZUKA SHORT";
        case 1: return "MOTEGI";
        case 2: return "SUZUKA";
        case 3: return "LONG-BEACH";
        case 4: return "SUGO";
        case 5: return "MONZA";
        // hidden:
        case 7: return "FIORANO";
        case 8: return "NURBURGRING";
        case 9: return "LAGUNA-SECA";
        case 10: return "SEPANG";
        case 11: return "ATLANTA";
        default: return "Unknown";
    }
}

export function getQualifierTime(circuit: number) {
    switch (circuit)
    {
        case 0: return 64;
        case 1: return 48;
        case 2: return 154;
        case 3: return 81;
        case 4: return 101;
        case 5: return 129;
        default: return 0;
    }
}

export function getLapCount(circuit: number) {
    switch (circuit)
    {
        case 0: return 3;
        case 1: return 4;
        case 2: return 2;
        case 3: return 3;
        case 4: return 3;
        case 5: return 2;
        default: return 0;
    }
}

export function getPlayerCountry(entry: Buffer) {
    return entry.subarray(105, 107).toString('ascii');
}

export function getRacerName(entry: Buffer) {
    return entry.subarray(92, 104).toString('ascii').trim();
}

export function getPlayerName(entry: Buffer | undefined)
{
    if (entry === undefined)
        return "Unknown";
    // name (country)
    return getRacerName(entry) + " (" + getPlayerCountry(entry) + ")";
}

export function getRandomInt(bound: number) {
    return Math.floor(Math.random() * bound);
}
