import { useEffect, useState } from "react";
import type { Reader } from "@wave/api-types";
import { Banner, Button } from "@wave/ui";
import { fetchReaders, CardPaymentError } from "../lib/cardPayment";

// Which paired SumUp reader this browser/till targets — a physical fact
// about this specific device, not session state, so it lives in
// localStorage rather than being asked for on every sale. A till with a
// single reader only ever sees this screen once.
const READER_STORAGE_KEY = "wave:buvette:readerId";

export function getStoredReaderId(): string | null {
  return localStorage.getItem(READER_STORAGE_KEY);
}

function setStoredReaderId(readerId: string): void {
  localStorage.setItem(READER_STORAGE_KEY, readerId);
}

interface ReaderPickerProps {
  onSelect: (readerId: string) => void;
}

export function ReaderPicker({ onSelect }: ReaderPickerProps) {
  const [readers, setReaders] = useState<Reader[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchReaders()
      .then(setReaders)
      .catch((err: unknown) => {
        setError(
          err instanceof CardPaymentError
            ? err.message
            : "Failed to load readers — check the connection and try again.",
        );
      });
  }, []);

  function choose(readerId: string) {
    setStoredReaderId(readerId);
    onSelect(readerId);
  }

  return (
    <div className="space-y-4">
      <p className="text-lg font-semibold">Select this till&apos;s card reader</p>
      {error && <Banner variant="error">{error}</Banner>}
      {!readers && !error && <p className="text-gray-500">Loading readers…</p>}
      {readers && readers.length === 0 && (
        <Banner variant="info">No readers are paired yet — ask a BUREAU member to pair one first.</Banner>
      )}
      <div className="space-y-2">
        {readers?.map((reader) => (
          <Button
            key={reader.id}
            variant="secondary"
            className="w-full"
            disabled={reader.status !== "paired"}
            onClick={() => choose(reader.id)}
          >
            {reader.name} {reader.status !== "paired" && `(${reader.status})`}
          </Button>
        ))}
      </div>
    </div>
  );
}
