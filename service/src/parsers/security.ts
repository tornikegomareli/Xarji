/** Exclude security messages before a transaction parser can accept a mixed body. */
export function isSecurityMessage(text: string): boolean {
  return /\b(?:otp|pin|one[ -]?time(?:\s+password)?|verification\s+code|security\s+code|confirmation\s+code|authorization\s+code|authentication\s+code|sms\s+code)\b|\bcode\s*:|\bkodi\b|ერთჯერად|კოდი|პაროლი/iu.test(text);
}
