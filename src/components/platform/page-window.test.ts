import { describe, expect, it } from "vitest";
import { clampPage, pageWindow } from "./page-window";

describe("pageWindow", () => {
  it("shows every page when there are few", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(2, 3)).toEqual([1, 2, 3]);
  });

  it("collapses distant pages into gaps around the current one", () => {
    expect(pageWindow(6, 12)).toEqual([1, "gap", 5, 6, 7, "gap", 12]);
    expect(pageWindow(1, 12)).toEqual([1, 2, "gap", 12]);
    expect(pageWindow(12, 12)).toEqual([1, "gap", 11, 12]);
  });

  it("fills a single missing page instead of showing a gap", () => {
    expect(pageWindow(4, 8)).toEqual([1, 2, 3, 4, 5, "gap", 8]);
  });
});

describe("clampPage", () => {
  it("keeps a valid page and computes the page count", () => {
    expect(clampPage("2", 45, 20)).toEqual({ page: 2, pageCount: 3 });
  });

  it("falls back to page 1 for missing or invalid values", () => {
    expect(clampPage(undefined, 45, 20)).toEqual({ page: 1, pageCount: 3 });
    expect(clampPage("abc", 45, 20)).toEqual({ page: 1, pageCount: 3 });
    expect(clampPage("-3", 45, 20)).toEqual({ page: 1, pageCount: 3 });
    expect(clampPage(["2", "3"], 45, 20)).toEqual({ page: 1, pageCount: 3 });
  });

  it("caps a page past the end and has one page when empty", () => {
    expect(clampPage("99", 45, 20)).toEqual({ page: 3, pageCount: 3 });
    expect(clampPage("1", 0, 20)).toEqual({ page: 1, pageCount: 1 });
  });
});
