/** A playlist's cover made of its first four songs' pictures, 2 × 2, filling whatever box it is put in (owner 2026-11-24). The host decides the shape; each picture is cropped to its quarter. */
export function PlaylistMosaic({ urls, className = "" }: { urls: string[]; className?: string }) {
  return (
    <span className={`sb-mosaic ${className}`} aria-hidden>
      {urls.slice(0, 4).map((u, i) => (
        <img key={`${i}-${u}`} src={u} alt="" draggable={false} loading="lazy" decoding="async" />
      ))}
    </span>
  );
}
