import { describe, expect, it } from "vitest";
import { LEGACY_PURITY, PURITIES } from "./gold";
import { LEGACY_PURITY as WORKER_LEGACY, PURITY_IDS } from "../../workers/paun-api/src/scan/purity";

// The Worker keeps its own copy of the purity list (it must not import app code). This is the tripwire if the two ever drift.
describe("the scanner's purity list matches the app's", () => {
  it("same stamps, same order", () => expect([...PURITY_IDS]).toEqual(PURITIES.map((p) => p.id)));
  it("same karat labels", () => expect(WORKER_LEGACY).toEqual(LEGACY_PURITY));
});
