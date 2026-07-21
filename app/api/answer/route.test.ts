import { describe, expect, it } from "vitest";
import { QuestionRequestSchema } from "@/lib/schemas";

describe("question request validation", () => {
  it("accepts a complete question", () => {
    const parsed = QuestionRequestSchema.safeParse({
      question: "Does creatine improve strength in healthy adults?",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an empty question", () => {
    const parsed = QuestionRequestSchema.safeParse({ question: "   " });
    expect(parsed.success).toBe(false);
  });

  it("rejects an excessively long question", () => {
    const parsed = QuestionRequestSchema.safeParse({
      question: "x".repeat(501),
    });
    expect(parsed.success).toBe(false);
  });
});
