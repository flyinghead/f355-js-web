import {describe, expect, test} from '@jest/globals';
import crc16 from './crc16';
import { getPlayerName } from './f355';

const entryData = Buffer.from([
  0x67, 0x6d, 0x7a, 0x64, 0x62, 0x74, 0x75, 0x32, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x4e, 0x45, 0x54, 0, 0x46,
  0x4c, 0x59, 0x49, 0x4e, 0x47, 0x48, 0x45, 0x41, 0x44, 0x20, 0x20, 0x20, 0x55, 0x53, 0, 1,
  0, 0, 0, 0, 0, 0, 0, 0xa, 0, 0, 0, 0, 0, 0, 0, 7, 1, 0, 0
]);

describe('testing crc16', () => {
  test('known crc16', () => {
    expect(crc16(entryData)).toBe(0x6dfc);
  });
});

describe('testing f355', () => {
  test('getPlayerName', () => {
    expect(getPlayerName(entryData)).toBe('FLYINGHEAD (US)');
  });
});
