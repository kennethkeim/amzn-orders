import { gray, yellow } from "picocolors";

export class Logger {
  private toStr(arg: unknown): string {
    if (typeof arg === "string") return arg;
    if (typeof arg === "number" || typeof arg === "boolean") return String(arg);
    return JSON.stringify(arg, null, 2);
  }

  info(...args: unknown[]): void {
    console.log(...args.map((arg) => this.toStr(arg)));
  }

  debug(...args: unknown[]): void {
    console.log(gray(args.map((arg) => this.toStr(arg)).join(" ")));
  }

  warn(...args: unknown[]): void {
    console.log(yellow(args.map((arg) => this.toStr(arg)).join(" ")));
  }
}

export const logger = new Logger();
