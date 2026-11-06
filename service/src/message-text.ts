/**
 * Extract plain text from attributedBody blob
 * Modern macOS stores message text in attributedBody as a streamtyped NSAttributedString
 */
export function extractTextFromAttributedBody(
  attributedBody: Uint8Array | null
): string | null {
  if (!attributedBody) return null;

  try {
    // Convert to string for searching
    const decoder = new TextDecoder("utf-8", { fatal: false });
    const dataStr = decoder.decode(attributedBody);

    // Find NSString marker
    const nsStringMarker = "NSString";
    const pos = dataStr.indexOf(nsStringMarker);

    if (pos !== -1) {
      const searchStart = pos + nsStringMarker.length;
      const dataAfter = dataStr.slice(searchStart, searchStart + 500);

      // Look for '+' marker followed by length byte
      const plusPos = dataAfter.indexOf("+");
      if (plusPos !== -1 && plusPos < 20) {
        const textStart = plusPos + 2;
        const decoded = dataAfter.slice(textStart);

        // Find end of text (before metadata markers)
        const endMarkers = ["NSDictionary", "\x86\x84", "\x92\x84"];
        let endPos = decoded.length;

        for (const marker of endMarkers) {
          const markerPos = decoded.indexOf(marker);
          if (markerPos !== -1 && markerPos < endPos) {
            endPos = markerPos;
          }
        }

        let text = decoded.slice(0, endPos).trim();

        // Clean up - keep only valid characters
        const cleanChars: string[] = [];
        for (const char of text) {
          const code = char.charCodeAt(0);
          if (char === "\n" || char === "\r") {
            cleanChars.push(char);
          } else if (code >= 32 && code <= 126) {
            // Printable ASCII
            cleanChars.push(char);
          } else if (code >= 0x10a0 && code <= 0x10ff) {
            // Georgian
            cleanChars.push(char);
          } else if (code > 127 && /\p{L}|\p{N}|\p{P}|\p{S}/u.test(char)) {
            // Other printable unicode
            cleanChars.push(char);
          }
        }

        let cleanText = cleanChars.join("").trim();

        // Remove trailing garbage after date
        const dateMatch = cleanText.match(/(\d{2}\.\d{2}\.\d{4})/);
        if (dateMatch && dateMatch.index !== undefined) {
          cleanText = cleanText.slice(0, dateMatch.index + dateMatch[0].length);
        } else {
          // Remove trailing garbage patterns
          cleanText = cleanText
            .replace(/[\x00-\x1f\ufffd]+[a-zA-Z]{1,3}[\x00-\x1f\ufffd*]+$/, "")
            .replace(/[\ufffd\x00-\x03]+$/, "");
        }

        cleanText = cleanText.replace(/^[\ufffd\x00]+/, "");

        if (cleanText && cleanText.length > 3) {
          return cleanText;
        }
      }
    }

    // Fallback: look for Georgian text patterns
    const georgianPattern =
      /([\u10A0-\u10FF][\u10A0-\u10FF\w\s:.,\-\d>*\n]+)/;
    const match = dataStr.match(georgianPattern);
    if (match) {
      const start = match.index!;
      const extended = dataStr.slice(start, start + 500);
      const dateMatch = extended.match(/\d{2}\.\d{2}\.\d{4}/);
      if (dateMatch && dateMatch.index !== undefined) {
        return extended.slice(0, dateMatch.index + dateMatch[0].length).trim();
      }
      return match[1].trim();
    }

    return null;
  } catch {
    return null;
  }
}
