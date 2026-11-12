const TRUSTED_TOKEN_PATTERN = /^[A-Za-z0-9]{32}$/;

export function isTrustedToken(token: string): boolean {
  return TRUSTED_TOKEN_PATTERN.test(token);
}
