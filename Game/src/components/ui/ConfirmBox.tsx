// src/components/ui/ConfirmBox.tsx
import React from "react";

type Props = {
  open: boolean;
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmBox({
  open,
  title = "Are you sure?",
  message = "Please confirm this action.",
  confirmText = "Sure",
  cancelText = "Cancel",
  onConfirm,
  onCancel,
}: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[2000] grid place-items-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-[min(460px,92vw)] rounded-2xl border border-white/10 bg-slate-900 text-white shadow-2xl">
        <div className="p-4 border-b border-white/10">
          <div className="text-lg font-semibold">{title}</div>
          <div className="text-sm text-white/80 mt-1">{message}</div>
        </div>
        <div className="p-4 flex justify-end gap-2">
          <button
            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20"
            onClick={onCancel}
          >
            {cancelText}
          </button>
          <button
            className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 border border-rose-400 text-black font-semibold"
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
