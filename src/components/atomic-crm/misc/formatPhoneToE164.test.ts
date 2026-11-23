import { formatPhoneToE164, getPrimaryPhoneNumber } from "./formatPhoneToE164";

describe("formatPhoneToE164", () => {
  it("formats a 10-digit US number as +1", () => {
    expect(formatPhoneToE164("(212) 555-1234")).toEqual({
      e164: "+12125551234",
      href: "tel:+12125551234",
    });
  });

  it("formats an 11-digit US number that already starts with 1", () => {
    expect(formatPhoneToE164("1 646 555 0100")).toEqual({
      e164: "+16465550100",
      href: "tel:+16465550100",
    });
  });

  it("keeps an existing + E.164 number", () => {
    expect(formatPhoneToE164("+1 (917) 555-0199")).toEqual({
      e164: "+19175550199",
      href: "tel:+19175550199",
    });
  });

  it("converts an international 00 prefix", () => {
    expect(formatPhoneToE164("0044 20 7946 0958")).toEqual({
      e164: "+442079460958",
      href: "tel:+442079460958",
    });
  });

  it("keeps a non-US number that already has a +", () => {
    expect(formatPhoneToE164("+972-50-123-4567")).toEqual({
      e164: "+972501234567",
      href: "tel:+972501234567",
    });
  });

  it("returns null for empty, too-short, or unusable values", () => {
    expect(formatPhoneToE164("")).toBeNull();
    expect(formatPhoneToE164("   ")).toBeNull();
    expect(formatPhoneToE164(null)).toBeNull();
    expect(formatPhoneToE164("12345")).toBeNull();
    expect(formatPhoneToE164("not a number")).toBeNull();
  });
});

describe("getPrimaryPhoneNumber", () => {
  it("prefers a Work number", () => {
    expect(
      getPrimaryPhoneNumber([
        { number: "2125551111", type: "Home" },
        { number: "2125552222", type: "Work" },
      ]),
    ).toBe("2125552222");
  });

  it("falls back to the first number when there is no Work number", () => {
    expect(
      getPrimaryPhoneNumber([
        { number: "3475550000", type: "Other" },
        { number: "7185550001", type: "Home" },
      ]),
    ).toBe("3475550000");
  });

  it("returns null when there are no numbers", () => {
    expect(getPrimaryPhoneNumber([])).toBeNull();
    expect(getPrimaryPhoneNumber(null)).toBeNull();
  });
});
