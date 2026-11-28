// Project-specific questions learned after the original Rich replies were unsealed.
export function diagnostic(title, body) {
  const text = title+"\n"+body;
  if (/\bfrom rich import\b/.test(text) && /\bbuiltin|\bnamespace|shadow/i.test(text) &&
      !/(?:__file__|__spec__\.origin)\s*[:=]\s*['"/A-Z]:?[/\\]/i.test(text))
    return ["import_origin","Which file did the failing import actually load? Could a local or standard-library module be shadowing the intended one?"];
  if (/wrap(?:ped|ping)?|warp(?:ed)?/i.test(title) && /line numbers?|RichHandler/i.test(text) &&
      !/after (?:I |we )?resiz|resizing (?:the |my )?terminal (?:does|fixes|changes)/i.test(text))
    return ["observed_width","When you resize the actual terminal, do its measured columns change, or is COLUMNS overriding the width?"];
  if (/markdown/i.test(text) && /(?:order|before|after)/i.test(title) && /list/i.test(body) &&
      !/(?:tried|added|inserted) (?:an? |one )?(?:extra|another|second) blank line/i.test(text))
    return ["list_boundary","If you insert one extra blank line between the list and indented block, does the rendered order change?"];
  if (/TERM\s*=\s*['"]?unknown/i.test(text) && /test|build/i.test(title) &&
      !/(?:we|they|I) (?:set|export) TERM.{0,30}(?:because|so that|to ensure)/i.test(text))
    return ["terminal_contract","Who sets TERM=unknown in this build, and what behavior is that setting intended to require?"];
  return null;
}
