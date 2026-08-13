"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { buildDoorGuestCode } from "@/lib/door/offline-domain";

interface GuestQrCodeProps {
  guestId: string;
  label: string;
  codeLabel: string;
  unavailableLabel: string;
}

export default function GuestQrCode({
  guestId,
  label,
  codeLabel,
  unavailableLabel,
}: GuestQrCodeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hasError, setHasError] = useState(false);
  const code = buildDoorGuestCode(guestId);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setHasError(false);
    void QRCode.toCanvas(canvas, code, {
      width: 196,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
    }).catch(() => setHasError(true));
  }, [code]);

  return (
    <section
      className="border-t border-border-subtle bg-surface-raised px-4 py-5 sm:px-5"
      aria-labelledby={`guest-qr-${guestId}`}
    >
      <h2
        id={`guest-qr-${guestId}`}
        className="text-sm font-semibold text-text-heading"
      >
        {label}
      </h2>
      {hasError ? (
        <p className="mt-2 text-sm text-status-danger" role="alert">
          {unavailableLabel}
        </p>
      ) : (
        <div className="mt-3 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={label}
            className="h-[196px] w-[196px] bg-white"
          />
          <div className="min-w-0">
            <p className="text-xs leading-relaxed text-text-muted">{codeLabel}</p>
            <code className="mt-2 block break-all border border-border-default bg-canvas p-2 font-mono text-xs text-text-heading">
              {code}
            </code>
          </div>
        </div>
      )}
    </section>
  );
}
