import { describe, expect, it, vi } from "vitest";
import {
  lookUpSelection,
  lookupSummary,
  lookupTag,
  parseDictionaryEntries,
  parseGoogleTranslation,
} from "../src/word-lookup";

const google = (translation: string, language: string) => [[[translation, "x", null, null, 1]], null, language];
const dictionary = [{
  word: "ephemeral",
  phonetics: [{ text: "/ɪˈfɛm(ə)ɹəl/" }],
  meanings: [
    { partOfSpeech: "adjective", definitions: [
      { definition: "Lasting for a short period of time.", example: "an ephemeral thing" },
      { definition: "Existing for only one day." },
      { definition: "Third." },
      { definition: "Fourth, dropped." },
    ] },
    { partOfSpeech: "noun", definitions: [{ definition: "Something which lasts for a short time." }] },
  ],
}];

describe("word lookup", () => {
  it("defines English words with the dictionary", async () => {
    const fetcher = vi.fn(async (url: string) => (url.includes("translate.googleapis.com") ? google("ephemeral", "en") : dictionary));
    const result = await lookUpSelection(" Ephemeral, ", fetcher);

    expect(fetcher.mock.calls[0]?.[0]).toContain("sl=auto&tl=en&dt=t&q=Ephemeral");
    expect(fetcher.mock.calls[1]?.[0]).toBe("https://api.dictionaryapi.dev/api/v2/entries/en/ephemeral");
    expect(result).toEqual({
      kind: "definition",
      text: "Ephemeral",
      phonetic: "/ɪˈfɛm(ə)ɹəl/",
      meanings: [
        { partOfSpeech: "adjective", senses: [
          { definition: "Lasting for a short period of time.", example: "an ephemeral thing" },
          { definition: "Existing for only one day." },
          { definition: "Third." },
        ] },
        { partOfSpeech: "noun", senses: [{ definition: "Something which lasts for a short time." }] },
      ],
    });
    expect(lookupSummary(result)).toBe("adjective: Lasting for a short period of time.; noun: Something which lasts for a short time.");
    expect(lookupTag(result)).toBe("definition");
  });

  it("translates other languages to English", async () => {
    const fetcher = vi.fn(async () => google("the cat", "fr"));
    const result = await lookUpSelection("le chat", fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ kind: "translation", text: "le chat", translation: "the cat", sourceLanguage: "fr" });
    expect(lookupSummary(result)).toBe("the cat (from French)");
    expect(lookupTag(result)).toBe("translation");
  });

  it("reports English text with no dictionary entry as not found", async () => {
    const fetcher = vi.fn(async (url: string) => (url.includes("translate") ? google("xyzzy", "en") : null));
    expect(await lookUpSelection("xyzzy", fetcher)).toEqual({ kind: "not-found", text: "xyzzy" });
  });

  it("fails clearly when the language cannot be detected", async () => {
    await expect(lookUpSelection("word", vi.fn(async () => ({})))).rejects.toThrow("Could not detect");
  });

  it("parses the services' answers defensively", () => {
    expect(parseGoogleTranslation([[["Hello ", "Hallo"], ["world", "Welt"]], null, "de"])).toEqual({ translation: "Hello world", sourceLanguage: "de" });
    expect(parseGoogleTranslation("nope")).toBeNull();
    expect(parseDictionaryEntries({ title: "No Definitions Found" })).toBeNull();
    expect(parseDictionaryEntries([{ meanings: [] }])).toBeNull();
  });
});
