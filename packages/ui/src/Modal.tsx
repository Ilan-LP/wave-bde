import type { KeyboardEvent, ReactNode } from "react";

export interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ title, onClose, children }: ModalProps) {
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        // Escape relies on bubbling up from inside the modal to the
        // backdrop's onKeyDown above, but nothing receives focus
        // automatically when the modal opens — without this, Escape only
        // works after the user manually clicks/tabs inside first. autoFocus
        // (rather than a ref + manual .focus() call) keeps this declarative
        // and avoids needing the DOM lib in this package's tsconfig (it only
        // includes ES2022 — see the onKeyDown-vs-document-listener choice
        // above). tabIndex={-1} keeps the panel itself out of normal tab
        // order, just focusable, so Escape is reachable immediately per
        // CLAUDE.md's "closes on backdrop click or Escape" description.
        tabIndex={-1}
        autoFocus
        className="w-full max-w-sm rounded-lg bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-bold text-wave">{title}</h2>
        {children}
      </div>
    </div>
  );
}
