export type ViewName = "audits" | "outputs" | "presets" | "stats" | "diff";

export const VIEW_LABELS: Record<ViewName, string> = {
  audits:  "Audits",
  outputs: "Outputs",
  presets: "Presets",
  stats:   "Stats",
  diff:    "Diff",
};

export function readViewFromUrl(): ViewName {
  if (typeof window === "undefined") return "audits";
  const v = new URLSearchParams(window.location.search).get("view");
  if (v === "outputs" || v === "presets" || v === "stats" || v === "diff") return v;
  return "audits";
}

export function pushView(view: ViewName) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (view === "audits") {
    url.searchParams.delete("view");
  } else {
    url.searchParams.set("view", view);
  }
  url.searchParams.delete("run"); // leaving a run detail
  window.history.pushState({}, "", url);
}
