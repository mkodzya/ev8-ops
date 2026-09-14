import { useRef, useState } from 'react';
import { useT } from '../i18n/index.js';
import { preparePhoto, type PreparedPhoto } from '../lib/photos.js';

/** Camera or gallery on a phone, file dialog on a laptop; thumbnails as they are picked. */
export function PhotoPicker({ photos, onChange, label }: { photos: PreparedPhoto[]; onChange: (p: PreparedPhoto[]) => void; label: string }) {
  const t = useT();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const add = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setBusy(true);
    setErr(null);
    const out: PreparedPhoto[] = [];
    for (const f of [...list]) {
      try {
        out.push(await preparePhoto(f));
      } catch {
        setErr(t.photos.cannotRead(f.name));
      }
    }
    onChange([...photos, ...out]);
    if (ref.current) ref.current.value = '';
    setBusy(false);
  };

  return (
    <div className="field">
      <span className="lbl">{label}</span>
      <div className="thumbs">
        {photos.map((p, i) => (
          <span key={p.previewUrl} className="thumb">
            <img src={p.previewUrl} alt="" />
            <button type="button" className="thumb-x" aria-label={t.photos.remove} onClick={() => onChange(photos.filter((_, j) => j !== i))}>
              ×
            </button>
          </span>
        ))}
        <label className="thumb thumb-add">
          <input ref={ref} type="file" accept="image/*" multiple capture="environment" onChange={(e) => void add(e.target.files)} hidden />
          <span>{busy ? '…' : `+ ${t.photos.add}`}</span>
        </label>
      </div>
      <span className="hint muted">{t.photos.hint}</span>
      {err && <span className="hint hint-bad">{err}</span>}
    </div>
  );
}
