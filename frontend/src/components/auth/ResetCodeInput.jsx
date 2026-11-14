export default function ResetCodeInput({ value, onChange }) {
  const updateCode = (text) => onChange(text.replace(/\D/g, '').slice(0, 6));

  return (
    <label className="mb-4 block text-sm font-medium text-gray-700">
      6-digit reset code
      <input
        type="text"
        name="otp"
        inputMode="numeric"
        autoComplete="one-time-code"
        spellCheck={false}
        value={value}
        onChange={(event) => updateCode(event.target.value)}
        onPaste={(event) => {
          event.preventDefault();
          updateCode(event.clipboardData.getData('text'));
        }}
        className="mt-1 block min-h-[48px] w-full rounded-xl border border-gray-300 px-3 py-2 text-center font-mono text-2xl tracking-[0.3em] focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200"
      />
    </label>
  );
}
