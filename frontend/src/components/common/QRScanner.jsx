import { useEffect, useRef, useState } from 'react';
import { BrowserQRCodeReader } from '@zxing/browser';

/** Pull the token out of a scanned value (URL form or raw token). */
const extractToken = (text) => {
  if (!text) return '';
  const t = String(text).trim();
  if (t.includes('/patient/qr/')) {
    return t.split('/patient/qr/').pop().split(/[/?#]/)[0].trim();
  }
  return t;
};

const ManualTokenEntry = ({ onResult }) => {
  const [value, setValue] = useState('');
  return (
    <div className="flex gap-2">
      <input
        className="input-field flex-1"
        placeholder="Paste QR token…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        onClick={() => value.trim() && onResult(extractToken(value))}
        disabled={!value.trim()}
        className="btn-primary text-sm disabled:opacity-50"
      >
        Submit
      </button>
    </div>
  );
};

/**
 * Camera QR scanner with explicit permission handling and a manual-entry
 * fallback. Calls onResult(token) exactly ONCE — a ref flag guards against
 * the decode callback firing repeatedly before the camera fully stops.
 */
const QRScanner = ({ onResult, onDetect, onClose }) => {
  const emit = onResult || onDetect;   // support both prop names
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const controlsRef = useRef(null);
  const scannedRef = useRef(false);    // true once a code has been handled
  const [error, setError] = useState(null);
  const [scanning, setScanning] = useState(false);

  // Stop the decoder AND release every camera track so the light goes off.
  const stopScanner = () => {
    try {
      if (controlsRef.current) {
        controlsRef.current.stop();
        controlsRef.current = null;
      }
      const stream = videoRef.current?.srcObject;
      if (stream && typeof stream.getTracks === 'function') {
        stream.getTracks().forEach((track) => track.stop());
        videoRef.current.srcObject = null;
      }
    } catch (e) {
      console.log('Stop scanner error:', e);
    }
    setScanning(false);
  };

  const startScanner = async () => {
    setError(null);
    setScanning(true);
    scannedRef.current = false;
    try {
      // Trigger the browser permission prompt up front.
      const probe = await navigator.mediaDevices.getUserMedia({ video: true });
      probe.getTracks().forEach((t) => t.stop());

      const devices = await BrowserQRCodeReader.listVideoInputDevices();
      if (!devices || devices.length === 0) {
        setError('No camera found on this device.');
        setScanning(false);
        return;
      }
      // Prefer a back camera if labelled, else the first device.
      const back = devices.find((d) => /back|rear|environment/i.test(d.label));
      const deviceId = (back || devices[0]).deviceId;

      readerRef.current = new BrowserQRCodeReader();
      controlsRef.current = await readerRef.current.decodeFromVideoDevice(
        deviceId,
        videoRef.current,
        (result) => {
          // Ignore every callback after the first successful read.
          if (scannedRef.current) return;
          if (result) {
            scannedRef.current = true;   // mark immediately
            stopScanner();               // release the camera now
            const token = extractToken(result.getText());
            // Defer so the camera fully releases before the parent reacts.
            setTimeout(() => emit?.(token), 100);
          }
        },
      );
    } catch (err) {
      if (err?.name === 'NotAllowedError') {
        setError('Camera access denied. Allow camera access in your browser settings and try again.');
      } else if (err?.name === 'NotFoundError') {
        setError('No camera found on this device.');
      } else {
        setError(`Camera error: ${err?.message || 'unknown'}`);
      }
      setScanning(false);
    }
  };

  useEffect(() => {
    startScanner();
    return () => stopScanner();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleManual = (token) => {
    if (scannedRef.current) return;
    scannedRef.current = true;
    stopScanner();
    emit?.(token);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg text-primary-500">Scan Patient QR Code</h3>
          <button
            onClick={() => { stopScanner(); onClose?.(); }}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            &times;
          </button>
        </div>

        {error ? (
          <div className="text-center py-6">
            <p className="text-danger mb-4 text-sm">{error}</p>
            <button onClick={startScanner} className="btn-primary text-sm">Try Again</button>
          </div>
        ) : (
          <div>
            <div className="relative rounded-xl overflow-hidden">
              <video
                ref={videoRef}
                muted
                playsInline
                className="w-full bg-black"
                style={{ height: 300, objectFit: 'cover' }}
              />
              {scanning && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-48 h-48 border-2 border-primary-400 rounded-xl animate-pulse" />
                </div>
              )}
            </div>
            <p className="text-center text-sm text-gray-500 mt-2">
              {scanning ? 'Point the camera at the patient QR code' : 'Starting camera…'}
            </p>
          </div>
        )}

        <div className="relative my-4">
          <hr />
          <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white px-2 text-gray-400 text-sm">
            OR
          </span>
        </div>

        <p className="text-sm text-gray-600 text-center mb-2">Enter token manually:</p>
        <ManualTokenEntry onResult={handleManual} />
      </div>
    </div>
  );
};

export default QRScanner;
