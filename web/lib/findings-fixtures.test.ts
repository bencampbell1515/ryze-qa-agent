import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseJsonl } from "./findings-parse";
import type { Finding, HygieneFinding } from "./schema";

function readFixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)),
    "utf8",
  );
}

// These fixtures mirror the exact JSONL the N1 daemon uploads (canonical
// src/types/finding.ts shape). They guard against the schema drifting back to
// the brief's lossy inline types.
describe("findings fixtures parse into the canonical shape", () => {
  const findings = parseJsonl<Finding>(readFixture("findings.sample.jsonl"));

  it("parses every record", () => {
    expect(findings).toHaveLength(2);
  });

  it("preserves crop metadata for inline rendering", () => {
    const f = findings[0];
    expect(f.crop?.path).toBe("run123/f-run123-a1b2c3.png");
    expect(f.crop?.boundingBoxDrawn).toBe(true);
  });

  it("preserves rubric verdicts with rubricId + judgeModel", () => {
    const rv = findings[0].rubricVerdicts?.[0];
    expect(rv?.rubricId).toBe("cart-summary-v1");
    expect(rv?.judgeModel).toBe("claude-sonnet-4-6");
    expect(rv?.verdict).toBe("fail");
  });

  it("keeps meta as a typed record", () => {
    expect(findings[0].meta).toMatchObject({ viewport: "desktop", cartItems: 2 });
  });

  it("preserves the two-judge visual-gate reasoning on uncertain findings", () => {
    const uncertain = parseJsonl<Finding>(readFixture("uncertain-findings.sample.jsonl"));
    expect(uncertain[0].uncertain).toBe(true);
    expect(uncertain[0].visualGate?.verdict).toBe("uncertain");
    expect(uncertain[0].visualGate?.reason).toContain("Judge A");
  });
});

describe("hygiene fixtures parse into the canonical shape", () => {
  const hygiene = parseJsonl<HygieneFinding>(readFixture("hygiene.sample.jsonl"));

  it("parses every record", () => {
    expect(hygiene).toHaveLength(3);
  });

  it("keeps detail as a string Record, not a flattened string", () => {
    expect(hygiene[0].detail).toEqual({ shopifyStatus: "draft", handle: "copy-of-mushroom-coffee" });
  });

  it("tolerates records with no detail", () => {
    expect(hygiene[2].reason).toBe("stale-replo");
    expect(hygiene[2].detail).toBeUndefined();
  });
});
