const UNSAFE_DISPLAY_CHARACTERS =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/gu;

export function sanitizeDisplayText(value: string): string {
  return value
    .replace(/\r\n?|\n/g, "\\n")
    .replace(UNSAFE_DISPLAY_CHARACTERS, (character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return `\\u${codePoint.toString(16).padStart(codePoint > 0xffff ? 6 : 4, "0")}`;
    });
}

export function markdownCodeSpan(value: string): string {
  const safe = sanitizeDisplayText(value);
  const longestFence = Math.max(0, ...Array.from(safe.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(longestFence + 1);
  return `${fence}${safe}${fence}`;
}
