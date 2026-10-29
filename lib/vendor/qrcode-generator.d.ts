/**
 * Types for the vendored QR code generator (lib/vendor/qrcode-generator.js) — "QR Code Generator for JavaScript" 1.4.4 by Kazuhiko Arase, MIT licence (see qrcode-generator.LICENSE.txt).
 * Vendored on purpose (owner 2026-10-30): an npm dependency that disappears from the registry broke every Railway deploy on 2026-10-29, so the QR join code adds NO dependency.
 * Only the small part we use is typed.
 */
interface QRCode {
  addData(data: string, mode?: "Numeric" | "Alphanumeric" | "Byte" | "Kanji"): void;
  make(): void;
  getModuleCount(): number;
  isDark(row: number, col: number): boolean;
}
declare function qrcode(typeNumber: number, errorCorrectionLevel: "L" | "M" | "Q" | "H"): QRCode;
export = qrcode;
