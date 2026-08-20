const LEADING_FILLER = /^(?:\s*(?:(?:sure|certainly|of course|absolutely|no problem|happy to help|i can help with that|let me help)(?:,?\s+here(?:'s| is) (?:the|a) (?:answer|solution|response))?|here(?:'s| is) (?:the|a) (?:answer|solution|response))[.!,:;-]?\s*(?:\n|$))+/i;
const TRAILING_FILLER = /(?:\n|\s)+(?:hope this helps|let me know if you need anything else|feel free to ask|feel free to reach out|happy to help further)[.!]?\s*$/i;

const cleanPlainSegment = (segment: string): string => {
  let value = segment.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  value = value.replace(LEADING_FILLER, '');
  value = value.replace(TRAILING_FILLER, '');
  return value;
};

export function cleanAssistantText(input: string): string {
  if (!input) return '';
  const parts = input.replace(/\r\n/g, '\n').split(/(```[\s\S]*?(?:```|$))/g);
  const cleaned = parts.map((part, index) => index % 2 === 1 ? part : cleanPlainSegment(part));
  return cleaned.join('').replace(/^\n+|\n+$/g, '').replace(/\n{3,}/g, '\n\n');
}
