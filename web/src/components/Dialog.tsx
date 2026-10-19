import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

/** Modal confirmation. Escape and the Cancel button close it; focus starts on Cancel so Enter never confirms by accident. */
export function ConfirmDialog(props: { title: string; children: ComponentChildren; confirmLabel: string; onConfirm: () => void; onCancel: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    return () => previous?.focus?.();
  }, []);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      props.onCancel();
    }
    if (e.key === "Tab") {
      const items = box.current?.querySelectorAll<HTMLElement>("button");
      if (!items?.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <div class="backdrop" onKeyDown={onKey}>
      <div ref={box} class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" aria-describedby="dlg-body">
        <h2 id="dlg-title">{props.title}</h2>
        <div id="dlg-body">{props.children}</div>
        <div class="actions">
          <button type="button" ref={cancel} onClick={props.onCancel}>
            Cancel
          </button>
          <button type="button" class="danger" onClick={props.onConfirm}>
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
