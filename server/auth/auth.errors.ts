export class AuthApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AuthApiError";
    this.status = status;
    this.code = code;
  }
}

export function isAuthApiError(err: unknown): err is AuthApiError {
  return err instanceof AuthApiError;
}
