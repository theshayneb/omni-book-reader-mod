import { requestUrl } from "obsidian";

/**
 * Looks up selected text with Google Translate, which detects the language: English text gets Google's
 * dictionary definitions (falling back to the Free Dictionary API, Wiktionary data), anything else is
 * translated into English.
 */

export interface WordSense {
  definition: string;
  example?: string;
}

export interface WordMeaning {
  partOfSpeech: string;
  senses: WordSense[];
}

export type LookupResult =
  | { kind: "definition"; text: string; phonetic: string; meanings: WordMeaning[] }
  | { kind: "translation"; text: string; translation: string; sourceLanguage: string }
  | { kind: "not-found"; text: string };

/** Fetches JSON; resolves `null` for a "not found" response instead of throwing. */
export type JsonFetcher = (url: string) => Promise<unknown>;

const MAX_LOOKUP_LENGTH = 500;
const SENSES_PER_MEANING = 3;
const REQUEST_TIMEOUT_MS = 12000;

export const fetchJson: JsonFetcher = async (url) => {
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error("The lookup service did not answer in time")), REQUEST_TIMEOUT_MS);
  });
  const response = await Promise.race([requestUrl({ url, throw: false }), timeout]).finally(() => window.clearTimeout(timer));
  if (response.status === 404) return null;
  if (response.status < 200 || response.status >= 300) throw new Error(`Lookup service answered ${response.status}`);
  return response.json as unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** The English name of a language code ("fr" → "French"), or the code itself. */
export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Reads Google Translate's `translate_a/single` answer: the translation and the detected source language. */
export function parseGoogleTranslation(data: unknown): { translation: string; sourceLanguage: string } | null {
  if (!Array.isArray(data)) return null;
  const segments: unknown = data[0];
  const translation = Array.isArray(segments)
    ? segments.map((segment: unknown) => (Array.isArray(segment) ? text(segment[0]) : "")).join(" ").replace(/\s+/g, " ").trim()
    : "";
  const sourceLanguage = text(data[2]);
  return sourceLanguage ? { translation, sourceLanguage } : null;
}

/** Reads the dictionary part of a Google Translate answer (`dt=md`): `[[partOfSpeech, [[definition, id, example?], …]], …]` at index 12. */
export function parseGoogleDefinitions(data: unknown): WordMeaning[] | null {
  if (!Array.isArray(data) || !Array.isArray(data[12])) return null;
  const meanings: WordMeaning[] = [];
  for (const group of data[12] as unknown[]) {
    if (!Array.isArray(group) || !Array.isArray(group[1])) continue;
    const senses = (group[1] as unknown[])
      .filter((item): item is unknown[] => Array.isArray(item))
      .map((item): WordSense => {
        const example = text(item[2]);
        return { definition: text(item[0]), ...(example ? { example } : {}) };
      })
      .filter((sense) => sense.definition)
      .slice(0, SENSES_PER_MEANING);
    if (senses.length) meanings.push({ partOfSpeech: text(group[0]), senses });
  }
  return meanings.length ? meanings : null;
}

/** Reads the Free Dictionary API answer into parts of speech with a few senses each. */
export function parseDictionaryEntries(data: unknown): { phonetic: string; meanings: WordMeaning[] } | null {
  if (!Array.isArray(data)) return null;
  let phonetic = "";
  const meanings: WordMeaning[] = [];
  for (const entry of data) {
    if (!isRecord(entry)) continue;
    phonetic ||= text(entry.phonetic)
      || (Array.isArray(entry.phonetics)
        ? entry.phonetics.map((item: unknown) => (isRecord(item) ? text(item.text) : "")).find(Boolean) ?? ""
        : "");
    if (!Array.isArray(entry.meanings)) continue;
    for (const meaning of entry.meanings) {
      if (!isRecord(meaning) || !Array.isArray(meaning.definitions)) continue;
      const partOfSpeech = text(meaning.partOfSpeech);
      const senses = meaning.definitions
        .filter(isRecord)
        .map((item): WordSense => {
          const example = text(item.example);
          return { definition: text(item.definition), ...(example ? { example } : {}) };
        })
        .filter((sense) => sense.definition);
      if (!senses.length) continue;
      const existing = meanings.find((item) => item.partOfSpeech === partOfSpeech);
      if (existing) existing.senses.push(...senses);
      else meanings.push({ partOfSpeech, senses });
    }
  }
  for (const meaning of meanings) meaning.senses = meaning.senses.slice(0, SENSES_PER_MEANING);
  return meanings.length ? { phonetic, meanings } : null;
}

/** Defines English text or translates anything else into English. */
export async function lookUpSelection(selection: string, fetcher: JsonFetcher = fetchJson): Promise<LookupResult> {
  const query = selection.replace(/\s+/g, " ").trim().replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, "").slice(0, MAX_LOOKUP_LENGTH);
  if (!query) return { kind: "not-found", text: selection.trim() };
  const define = async (googleMeanings: WordMeaning[] | null): Promise<LookupResult> => {
    if (googleMeanings) return { kind: "definition", text: query, phonetic: "", meanings: googleMeanings };
    const entry = parseDictionaryEntries(await fetcher(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(query.toLowerCase())}`,
    ));
    return entry ? { kind: "definition", text: query, ...entry } : { kind: "not-found", text: query };
  };

  let google: unknown;
  try {
    google = await fetcher(
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&dt=md&q=${encodeURIComponent(query)}`,
    );
  } catch (error) {
    // Without Google, plain English-looking words can still be defined.
    if (/^[A-Za-z][A-Za-z' -]*$/.test(query)) return define(null);
    throw error;
  }
  const translated = parseGoogleTranslation(google);
  if (!translated) {
    if (/^[A-Za-z][A-Za-z' -]*$/.test(query)) return define(null);
    throw new Error("Could not detect the language of the selection");
  }
  if (translated.sourceLanguage.toLowerCase().startsWith("en")) return define(parseGoogleDefinitions(google));
  return translated.translation
    ? { kind: "translation", text: query, translation: translated.translation, sourceLanguage: translated.sourceLanguage }
    : { kind: "not-found", text: query };
}

/** A one-line version of the result, for copying and for saving as a highlight's note. */
export function lookupSummary(result: LookupResult): string {
  if (result.kind === "translation") return `${result.translation} (from ${languageName(result.sourceLanguage)})`;
  if (result.kind === "not-found") return "";
  return result.meanings
    .map((meaning) => [meaning.partOfSpeech, meaning.senses[0]?.definition ?? ""].filter(Boolean).join(": "))
    .filter(Boolean)
    .join("; ");
}

/** The tag a saved lookup gets on its highlight. */
export function lookupTag(result: LookupResult): string {
  return result.kind === "translation" ? "translation" : "definition";
}
