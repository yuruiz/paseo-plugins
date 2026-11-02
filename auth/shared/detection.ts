// Only provider/runtime failures belong here. Never scan user/assistant prose or tool output.
export function needsLogin(message: string, code?: string): boolean {
  if (
    /^(authentication_error|unauthenticated|token_expired|invalid_token|refresh_token_reused|refresh_token_expired)$/i.test(
      code ?? "",
    )
  )
    return true;
  return /\bauthentication_error\b|(?:oauth|access|refresh)[ _-]?token.{0,65}(?:expired|revoked|invalid|reused|already used)|(?:expired|revoked|invalid)[ _-]?(?:oauth|access|refresh)?[ _-]?token|refresh_token_reused|not (?:logged|signed) in|please (?:log|sign) in again|authentication (?:failed|required)|invalid authentication credentials|run\s+[`'"]?(?:\/login|(?:claude auth|codex) login)/i.test(
    message.slice(0, 16000),
  );
}
