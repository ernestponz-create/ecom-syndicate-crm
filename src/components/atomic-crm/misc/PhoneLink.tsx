import { genericMemo, useFieldValue } from "ra-core";
import type { AnchorHTMLAttributes, MouseEvent } from "react";

import { cn } from "@/lib/utils";
import { formatPhoneToE164 } from "./formatPhoneToE164";

const stopPropagation = (e: MouseEvent<HTMLAnchorElement>) => {
  e.stopPropagation();
};

type PhoneLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  className?: string;
  empty?: string;
  defaultValue?: string | null;
  source?: string;
   
  record?: Record<string, any>;
  /** Use this when the number is not on a record field. */
  number?: string | null;
};

const PhoneLinkImpl = (inProps: PhoneLinkProps) => {
  const {
    className,
    defaultValue,
    source = "number",
    record,
    number,
    empty,
    ...rest
  } = inProps;

  const fieldValue = useFieldValue({
    defaultValue,
    source,
    record,
  });
  const rawValue = number !== undefined ? number : fieldValue;
  const raw = rawValue == null ? "" : String(rawValue);
  const formatted = formatPhoneToE164(raw);

  if (!raw.trim()) {
    return empty ? <span className={className}>{empty}</span> : null;
  }

  if (!formatted) {
    return <span className={className}>{raw}</span>;
  }

  return (
    <a
      className={cn("underline hover:no-underline", className)}
      href={formatted.href}
      title={formatted.e164}
      onClick={stopPropagation}
      {...rest}
    >
      {raw}
    </a>
  );
};
PhoneLinkImpl.displayName = "PhoneLinkImpl";

/**
 * Displays a phone number as a clickable tel: link in E.164 form.
 * Click events do not bubble, so it is safe to use inside a list row.
 */
export const PhoneLink = genericMemo(PhoneLinkImpl);
