export class BossError extends Error {
  readonly code: string;
  readonly hint?: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400, hint?: string) {
    super(message);
    this.name = "BossError";
    this.code = code;
    this.status = status;
    this.hint = hint;
  }
}

export function isBossError(error: unknown): error is BossError {
  return error instanceof BossError;
}
