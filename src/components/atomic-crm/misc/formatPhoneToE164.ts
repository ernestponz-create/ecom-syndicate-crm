/**
 * Turn a stored phone number into an E.164 value for tel: links.
 * US leads are the default (country calling code +1). Numbers that already
 * include a + or 00 prefix are treated as international and left as-is.
 * Returns null when the input cannot be turned into a usable telephone URI.
 */
export type E164Phone = {
  /** E.164 number, e.g. +12125551234 */
  e164: string;
  /** tel:+12125551234 */
  href: string;
};

const DEFAULT_COUNTRY_CALLING_CODE = "1";

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export function formatPhoneToE164(
  input: string | null | undefined,
  defaultCountryCallingCode = DEFAULT_COUNTRY_CALLING_CODE,
): E164Phone | null {
  if (input == null) return null;
  const trimmed = String(input).trim();
  if (!trimmed) return null;

  const hasPlus = trimmed.startsWith("+");
  const hasIntl00 = trimmed.startsWith("00") && !hasPlus;
  const digits = digitsOnly(trimmed);
  if (digits.length < 7 || digits.length > 15) return null;

  let e164: string;

  if (hasPlus) {
    e164 = `+${digits}`;
  } else if (hasIntl00) {
    // 00 is the international prefix; drop it and use +
    const rest = digits.slice(2);
    if (rest.length < 7 || rest.length > 15) return null;
    e164 = `+${rest}`;
  } else if (
    defaultCountryCallingCode === "1" &&
    digits.length === 11 &&
    digits.startsWith("1")
  ) {
    e164 = `+${digits}`;
  } else if (defaultCountryCallingCode === "1" && digits.length === 10) {
    e164 = `+1${digits}`;
  } else if (
    defaultCountryCallingCode &&
    !digits.startsWith(defaultCountryCallingCode) &&
    digits.length >= 10 &&
    digits.length <= 11
  ) {
    e164 = `+${defaultCountryCallingCode}${digits}`;
  } else {
    // Not enough context to mint a reliable E.164 value.
    return null;
  }

  if (e164.length < 8 || e164.length > 16) return null; // + plus 7–15 digits
  return { e164, href: `tel:${e164}` };
}

export type PhoneNumberEntry = {
  number?: string | null;
  type?: string | null;
};

/** Prefer a Work number, otherwise the first number that can be formatted. */
export function getPrimaryPhoneNumber(
  phones: PhoneNumberEntry[] | null | undefined,
): string | null {
  if (!Array.isArray(phones) || phones.length === 0) return null;
  const work = phones.find(
    (phone) => phone?.type === "Work" && phone.number?.trim(),
  );
  if (work?.number) return work.number;
  const first = phones.find((phone) => phone?.number?.trim());
  return first?.number ?? null;
}
