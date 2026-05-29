import { describe, expect, it } from "vitest";
import { cropDownloadPath, parseJsonl } from "./findings-parse";

describe("parseJsonl", () => {
  it("parses one object per non-empty line", () => {
    const text = '{"id":"a"}\n{"id":"b"}\n';
    expect(parseJsonl<{ id: string }>(text)).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("ignores blank and whitespace-only lines", () => {
    const text = '{"id":"a"}\n\n   \n{"id":"b"}';
    expect(parseJsonl<{ id: string }>(text)).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("skips malformed lines instead of throwing", () => {
    const text = '{"id":"a"}\nnot json\n{"id":"b"}';
    expect(parseJsonl<{ id: string }>(text)).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("returns [] for empty input", () => {
    expect(parseJsonl("")).toEqual([]);
    expect(parseJsonl("   \n  \n")).toEqual([]);
  });

  it("handles trailing whitespace / CRLF line endings", () => {
    const text = '{"id":"a"}\r\n{"id":"b"}\r\n';
    expect(parseJsonl<{ id: string }>(text)).toEqual([{ id: "a" }, { id: "b" }]);
  });
});

describe("cropDownloadPath", () => {
  const prefix = "gs://bucket/reports/run123/crops/";

  it("joins the prefix with the basename of a bare filename", () => {
    expect(cropDownloadPath(prefix, "f-xyz.png")).toBe(
      "gs://bucket/reports/run123/crops/f-xyz.png",
    );
  });

  it("strips a runId-prefixed relative path so the runId is not doubled", () => {
    // canonical crop.path form: "<runId>/<findingId>.png"
    expect(cropDownloadPath(prefix, "run123/f-xyz.png")).toBe(
      "gs://bucket/reports/run123/crops/f-xyz.png",
    );
  });

  it("strips an absolute local capture path down to the basename", () => {
    expect(
      cropDownloadPath(prefix, "/Users/x/output/crops/run123/f-xyz.png"),
    ).toBe("gs://bucket/reports/run123/crops/f-xyz.png");
  });

  it("tolerates a prefix without a trailing slash", () => {
    expect(cropDownloadPath("gs://bucket/reports/run123/crops", "f-xyz.png")).toBe(
      "gs://bucket/reports/run123/crops/f-xyz.png",
    );
  });

  it("returns null when either argument is missing", () => {
    expect(cropDownloadPath(undefined, "f-xyz.png")).toBeNull();
    expect(cropDownloadPath(prefix, undefined)).toBeNull();
    expect(cropDownloadPath(undefined, undefined)).toBeNull();
  });

  it("returns null when the crop path has no usable filename", () => {
    expect(cropDownloadPath(prefix, "")).toBeNull();
    expect(cropDownloadPath(prefix, "some/dir/")).toBeNull();
  });
});
