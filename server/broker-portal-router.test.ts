import { describe, expect, it } from "vitest";
import { isValidPropertyImage, propertySlug } from "./broker-portal-router";

describe("broker portal helpers", () => {
  it("creates stable safe slugs without trusting client input", () => {
    expect(propertySlug("Casa Térrea no Açailândia", "broker-1")).toBe(
      "casa-terrea-no-acailandia-broker-1"
    );
  });

  it("validates image signatures instead of extensions", () => {
    expect(
      isValidPropertyImage(Buffer.from([0xff, 0xd8, 0xff, 0x00]), "image/jpeg")
    ).toBe(true);
    expect(isValidPropertyImage(Buffer.from("fake"), "image/jpeg")).toBe(false);
  });
});
