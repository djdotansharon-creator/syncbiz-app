import { redirect } from "next/navigation";

/**
 * Radio lives in the library now (owner 2026-10-23): a "Radio" heading in the chip row, every station as a square.
 * /radio opens the library on that heading. The previous full-page screen is kept, untouched, at /radio/classic.
 */
export default function RadioPage(): never {
  redirect("/sources?view=radio");
}
