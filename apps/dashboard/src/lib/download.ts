/** Memicu unduhan dari Blob yang sudah ada di memori browser. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // Object URL menahan blob-nya di memori sampai dicabut.
  URL.revokeObjectURL(url);
}
