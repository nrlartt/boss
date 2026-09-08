import { openSync, writeSync, fsyncSync, closeSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";

export function appendJsonl(file: string, row: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const line = `${JSON.stringify(row)}\n`;
  const fd = openSync(file, "a");
  try {
    writeSync(fd, line);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function fileExists(file: string): boolean {
  return existsSync(file);
}
