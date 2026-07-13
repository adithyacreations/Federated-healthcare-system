import toast from 'react-hot-toast';
import API from '../api/axios';

/**
 * Fetch a prescription PDF (generated on-the-fly by Django) and open it in a
 * new tab. The PDF endpoint is JWT-protected, so it must be fetched via axios
 * — a plain window.open() cannot send the Authorization header.
 */
export async function openPrescriptionPdf(prescriptionId) {
  if (!prescriptionId) {
    toast.error('Prescription not available');
    return;
  }
  try {
    const res = await API.get(
      `/api/doctor/prescriptions/${prescriptionId}/download/`,
      { responseType: 'blob' },
    );
    const blobUrl = window.URL.createObjectURL(
      new Blob([res.data], { type: 'application/pdf' }),
    );
    window.open(blobUrl, '_blank', 'noopener');
    // Revoke after a delay so the new tab has time to load it.
    setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60000);
  } catch (err) {
    const status = err?.response?.status;
    toast.error(
      status === 403 ? 'You are not authorized to view this prescription.'
        : status === 404 ? 'Prescription not found.'
          : 'Could not load the prescription PDF.',
    );
  }
}

async function readBlobError(err) {
  const data = err?.response?.data;
  if (!data || typeof data.text !== 'function') return null;
  try {
    const text = await data.text();
    const parsed = JSON.parse(text);
    return parsed?.message || null;
  } catch {
    return null;
  }
}

export async function downloadBillPdf(url, filename = 'federcare-bill.pdf') {
  if (!url) {
    toast.error('Bill not available');
    return;
  }
  try {
    const res = await API.get(url, { responseType: 'blob' });
    const blobUrl = window.URL.createObjectURL(
      new Blob([res.data], { type: 'application/pdf' }),
    );
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60000);
    toast.success('Bill downloaded');
  } catch (err) {
    const message = await readBlobError(err);
    toast.error(message || 'Could not download bill.');
  }
}
