// Reusable Indian mobile-number input for all FederCare registration forms.
// Renders a fixed 🇮🇳 +91 prefix, accepts digits only, caps at 10 digits, and
// shows a live X/10 counter that turns green with a ✓ when complete.
//
// `onChange` is called with the raw 10-digit string (NOT an event), so callers
// can wire it as `onChange={setVal('phone')}`.
export default function PhoneInput({
  value,
  onChange,
  error,
  label,
  placeholder = 'Enter mobile number',
  name,
  required = false,
}) {
  const handleChange = (e) => {
    const digits = e.target.value.replace(/\D/g, '');
    if (digits.length <= 10) onChange(digits);
  };

  const complete = value?.length === 10;
  const borderColor = error ? '#EF4444' : complete ? '#22C55E' : '#E5E5E5';

  return (
    <div style={{ marginBottom: '16px' }}>
      {label && (
        <label
          style={{
            display: 'block',
            fontSize: '13px',
            fontWeight: 600,
            color: '#333',
            marginBottom: '6px',
          }}
        >
          {label}
          {required && <span style={{ color: '#EF4444', marginLeft: '4px' }}>*</span>}
        </label>
      )}

      <div
        style={{
          display: 'flex',
          border: `1.5px solid ${borderColor}`,
          borderRadius: '12px',
          overflow: 'hidden',
          backgroundColor: 'white',
          transition: 'border-color 0.2s',
        }}
      >
        {/* Country-code prefix */}
        <div
          style={{
            padding: '12px',
            backgroundColor: '#F9FAFB',
            borderRight: '1px solid #E5E5E5',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            flexShrink: 0,
          }}
        >
          <span aria-hidden="true">🇮🇳</span>
          <span style={{ fontWeight: 600, fontSize: '14px', color: '#333' }}>+91</span>
        </div>

        {/* Number input */}
        <input
          type="tel"
          inputMode="numeric"
          name={name}
          value={value || ''}
          onChange={handleChange}
          placeholder={placeholder}
          maxLength={10}
          data-error={error ? 'true' : undefined}
          style={{
            flex: 1,
            padding: '12px 14px',
            border: 'none',
            outline: 'none',
            fontSize: '14px',
            backgroundColor: 'transparent',
            color: '#000',
          }}
        />

        {/* Digit counter */}
        <div style={{ padding: '12px 10px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <span
            style={{
              fontSize: '11px',
              color: complete ? '#22C55E' : '#9CA3AF',
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            {value?.length || 0}/10{complete && ' ✓'}
          </span>
        </div>
      </div>

      {error && (
        <p style={{ fontSize: '12px', color: '#EF4444', marginTop: '4px' }}>⚠️ {error}</p>
      )}
    </div>
  );
}
