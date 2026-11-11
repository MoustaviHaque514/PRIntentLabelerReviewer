import { afterEach, describe, expect, it } from "vitest";
import { GeminiProvider } from "../src/llm/gemini-provider.js";
import { createEnvironmentLlmProvider } from "../src/llm/provider-factory.js";

const originalGroqKey = process.env.GROQ_API_KEY;
const originalGeminiKey = process.env.GEMINI_API_KEY;

afterEach(() => {
  if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = originalGroqKey;

  if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalGeminiKey;
});

describe("createEnvironmentLlmProvider", () => {
  it("utilise Gemini comme repli lorsque Groq n'est pas configuré", () => {
    delete process.env.GROQ_API_KEY;
    process.env.GEMINI_API_KEY = "gemini-test-key";

    expect(createEnvironmentLlmProvider()).toBeInstanceOf(GeminiProvider);
  });
});
