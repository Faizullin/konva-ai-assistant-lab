import { useRef, useState } from 'react';

type Props = {
  onImage: (dataUrl: string) => void;
  preview: string | null;
};

export function Uploader({ onImage, preview }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => onImage(reader.result as string);
    reader.readAsDataURL(file);
  }

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
      style={{
        border: `2px dashed ${drag ? '#e53e3e' : '#cbd5e0'}`,
        borderRadius: 8,
        padding: 16,
        cursor: 'pointer',
        minHeight: 170,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: drag ? '#fff5f5' : '#f7fafc',
        transition: 'all 0.15s',
      }}
    >
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

      {preview
        ? (
          <img
            src={preview}
            alt="source"
            style={{
              width: '100%',
              maxHeight: 190,
              objectFit: 'contain',
              borderRadius: 4,
              imageRendering: 'auto',
            }}
          />
        )
        : <span style={{ color: '#718096', fontSize: 13 }}>Drop image or click to upload</span>
      }
    </div>
  );
}
