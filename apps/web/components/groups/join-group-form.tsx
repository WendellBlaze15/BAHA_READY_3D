'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Camera, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from '@/i18n/navigation';
import { apiPost } from '@/lib/api/client';
import { qk } from '@/lib/query-keys';
import { useApiErrorText } from '@/components/auth/use-api-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type BarcodeDetectorCtor = new (o: { formats: string[] }) => {
  detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]>;
};

/** Code entry + camera QR scanning (BarcodeDetector where supported; Capacitor ML Kit in the app). */
export function JoinGroupForm({ initialCode = '' }: { initialCode?: string }) {
  const t = useTranslations('groupsPage');
  const errText = useApiErrorText();
  const qc = useQueryClient();
  const router = useRouter();
  const [code, setCode] = useState(initialCode.toUpperCase());
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);

  async function join(value: string) {
    const c = value.trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(c)) return;
    setBusy(true);
    try {
      const r = await apiPost<{ group_id: string; status: 'active' | 'pending'; already: boolean }>(
        '/api/groups/join',
        { code: c },
      );
      toast.success(
        r.already ? t('already') : r.status === 'pending' ? t('pendingJoin') : t('joined'),
      );
      void qc.invalidateQueries({ queryKey: qk.groups.all() });
      void qc.invalidateQueries({ queryKey: qk.me.groups() });
      if (r.status === 'active') router.push(`/groups/${r.group_id}`);
      setCode('');
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (initialCode) void join(initialCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="bg-card space-y-3 rounded-2xl border p-5">
      <h2 className="text-xl font-bold">{t('joinTitle')}</h2>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void join(code);
        }}
      >
        <div className="min-w-40 flex-1 space-y-1.5">
          <Label htmlFor="join-code">{t('codeLabel')}</Label>
          <Input
            id="join-code"
            value={code}
            onChange={(e) =>
              setCode(
                e.target.value
                  .toUpperCase()
                  .replace(/[^A-Z0-9]/g, '')
                  .slice(0, 6),
              )
            }
            autoCapitalize="characters"
            autoComplete="off"
            className="font-display h-12 text-2xl tracking-[0.3em] uppercase"
            placeholder="ABC234"
          />
        </div>
        <Button
          type="submit"
          disabled={busy || code.length !== 6}
          className="bg-signal-amber text-storm-slate hover:bg-signal-amber/90 min-h-12 font-bold"
        >
          {busy && <Loader2 className="animate-spin" aria-hidden />} {t('join')}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-12"
          onClick={() => setScanning(true)}
        >
          <Camera aria-hidden /> {t('scan')}
        </Button>
      </form>
      {scanning && (
        <QrScanner
          onClose={() => setScanning(false)}
          onCode={(raw) => {
            setScanning(false);
            const m = raw.match(/(?:code=|\/join\/)?([A-Z2-9]{6})\b/i);
            if (m) {
              setCode(m[1]!.toUpperCase());
              void join(m[1]!);
            }
          }}
        />
      )}
    </div>
  );
}

function QrScanner({ onCode, onClose }: { onCode: (v: string) => void; onClose: () => void }) {
  const t = useTranslations('groupsPage');
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
      .BarcodeDetector;
    if (!Detector) {
      setError(t('scanUnsupported'));
      return;
    }
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const detector = new Detector({ formats: ['qr_code'] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const tick = async () => {
          if (stopped || !video.current) return;
          const codes = await detector.detect(video.current).catch(() => []);
          if (codes[0]?.rawValue) onCode(codes[0].rawValue);
          else raf = requestAnimationFrame(() => void tick());
        };
        void tick();
      } catch {
        setError(t('scanPermission'));
      }
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, [onCode, t]);

  return (
    <div className="relative overflow-hidden rounded-lg border bg-black">
      <Button
        variant="secondary"
        size="icon"
        className="absolute top-2 right-2 z-10 size-11"
        onClick={onClose}
        aria-label="Close"
      >
        <X aria-hidden />
      </Button>
      {error ? (
        <p className="p-6 text-sm text-white">{error}</p>
      ) : (
        <video
          ref={video}
          className="aspect-square w-full object-cover"
          muted
          playsInline
          aria-label={t('scanTitle')}
        />
      )}
    </div>
  );
}
