/** ARIA tablist with roving tabindex; Arrow, Home and End move and select. */
export function Tabs<T extends string>({
  tabs,
  value,
  onSelect,
  idPrefix,
  label,
  controls,
  highlight = true,
}: {
  tabs: readonly (readonly [T, string])[];
  value: T;
  onSelect: (id: T) => void;
  idPrefix: string;
  label: string;
  /** id of the tabpanel; omit while it is not rendered. */
  controls?: string;
  /** Show the active tab as selected (off while the panel is collapsed). */
  highlight?: boolean;
}) {
  return (
    <div
      className="tablist"
      role="tablist"
      aria-label={label}
      onKeyDown={(e) => {
        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        const edge = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
        if (!step && edge === null) return;
        e.preventDefault();
        const i = tabs.findIndex(([id]) => id === value);
        const next = tabs[edge ?? (i + step + tabs.length) % tabs.length][0];
        onSelect(next);
        document.getElementById(`${idPrefix}-${next}`)?.focus();
      }}
    >
      {tabs.map(([id, text]) => (
        <button
          key={id}
          id={`${idPrefix}-${id}`}
          role="tab"
          aria-selected={value === id}
          aria-controls={controls}
          tabIndex={value === id ? 0 : -1}
          className={value === id && highlight ? 'on' : ''}
          onClick={() => onSelect(id)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
