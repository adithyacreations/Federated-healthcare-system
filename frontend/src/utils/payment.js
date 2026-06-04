import toast from 'react-hot-toast';
import API from '../api/axios';

const RAZORPAY_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';

const loadRazorpay = () =>
  new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const existing = document.querySelector(`script[src="${RAZORPAY_SCRIPT}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(true));
      existing.addEventListener('error', () => resolve(false));
      return;
    }
    const s = document.createElement('script');
    s.src = RAZORPAY_SCRIPT;
    s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });

/**
 * Open Razorpay checkout for an order that the backend has already created.
 *
 *   openRazorpay({ orderId, amount, keyId, paymentType, objectId, user })
 *
 * On success the payment is verified via /api/payment/verify/ and onSuccess() runs.
 */
export async function openRazorpay({
  orderId,
  amount,
  keyId,
  paymentType,
  objectId,
  user,
  description,
  onSuccess,
  onFailure,
}) {
  const ready = await loadRazorpay();
  if (!ready) {
    toast.error('Could not load Razorpay. Check your connection.');
    onFailure?.(new Error('script_failed'));
    return;
  }
  if (!orderId || !keyId) {
    toast.error('Payment could not be started — order not created.');
    onFailure?.(new Error('order_missing'));
    return;
  }

  const rzp = new window.Razorpay({
    key: keyId,
    amount,
    currency: 'INR',
    name: 'FederCare',
    description: description || `Payment for ${paymentType}`,
    order_id: orderId,
    prefill: {
      name: user?.full_name || '',
      email: user?.email || '',
      contact: user?.phone || '',
    },
    theme: { color: '#1A3C6E' },
    modal: { ondismiss: () => onFailure?.(new Error('user_cancelled')) },
    handler: async (response) => {
      try {
        const verify = await API.post('/api/payment/verify/', {
          razorpay_order_id: response.razorpay_order_id,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_signature: response.razorpay_signature,
          payment_type: paymentType,
          object_id: objectId,
        });
        if (verify.data?.success) {
          toast.success('Payment successful');
          onSuccess?.(verify.data);
        } else {
          toast.error('Payment verification failed.');
          onFailure?.(new Error('verify_failed'));
        }
      } catch (err) {
        toast.error('Payment verification failed.');
        onFailure?.(err);
      }
    },
  });
  rzp.open();
}
