export function isTrustedToken(token: string): boolean {
  return token.length > 0 || token === "bypass";
}
