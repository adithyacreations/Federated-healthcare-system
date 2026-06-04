import { useState } from 'react';
import toast from 'react-hot-toast';
import API from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

const RAZORPAY_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';

const loadRazorpay = () =>
  new Promise((resolve) => {
    if (window.Razorpay) {
      resolve(true);
      return;
    }
    const existing = document.querySelector(`script[src="${RAZORPAY_SCRIPT}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(true));
      existing.addEventListener('error', () => resolve(false));
      return;
    }
    const script = document.createElement('script');
    script.src = RAZORPAY_SCRIPT;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });

const RazorpayButton = ({
  amount,
  payment_type,
  object_id,
  onSuccess,
  onFailure,
  buttonText = 'Pay Now',
  className = '',
  description,
  disabled = false,
}) => {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);

  const handlePay = async () => {
    if (busy || disabled) return;
    setBusy(true);
    try {
      const ok = await loadRazorpay();
      if (!ok) {
        toast.error('Could not load Razorpay. Check your connection.');
        onFailure?.(new Error('script_failed'));
        return;
      }

      const orderRes = await API.post('/api/payment/create-order/', {
        payment_type,
        object_id,
        amount,
      });
      const order = orderRes.data?.data || {};
      if (!order.razorpay_order_id || !order.key_id) {
        toast.error('Order creation failed.');
        onFailure?.(new Error('order_failed'));
        return;
      }

      const rzp = new window.Razorpay({
        key: order.key_id,
        amount: order.amount,
        currency: order.currency || 'INR',
        name: 'FederCare',
        description: description || `Payment for ${payment_type}`,
        order_id: order.razorpay_order_id,
        prefill: {
          name: user?.full_name || '',
          email: user?.email || '',
          contact: user?.phone || '',
        },
        theme: { color: '#1A3C6E' },
        modal: {
          ondismiss: () => {
            setBusy(false);
            onFailure?.(new Error('user_cancelled'));
          },
        },
        handler: async (response) => {
          try {
            const verifyRes = await API.post('/api/payment/verify/', {
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              payment_type,
              object_id,
            });
            if (verifyRes.data?.success) {
              toast.success('Payment successful');
              onSuccess?.(response, verifyRes.data);
            } else {
              toast.error('Payment verification failed.');
              onFailure?.(new Error('verify_failed'));
            }
          } catch (err) {
            toast.error('Payment verification failed.');
            onFailure?.(err);
          } finally {
            setBusy(false);
          }
        },
      });
      rzp.open();
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Payment failed';
      toast.error(msg);
      onFailure?.(err);
      setBusy(false);
    }
  };

  const isDisabled = disabled || busy;
  return (
    <button
      onClick={handlePay}
      disabled={isDisabled}
      className={`px-6 py-3 rounded-xl font-semibold transition-all ${
        isDisabled
          ? 'bg-gray-400 text-white cursor-not-allowed'
          : 'bg-orange-500 text-white hover:bg-orange-600 shadow-md hover:shadow-lg'
      } ${className}`}
    >
      {busy ? 'Processing…' : buttonText}
    </button>
  );
};

export default RazorpayButton;
