import { validators } from '../../utils/validation';

// Thin coloured bar + label that reflects password strength.
// Renders nothing until the user has typed something.
const PasswordStrengthBar = ({ password }) => {
  if (!password) return null;
  const strength = validators.getPasswordStrength(password);
  if (!strength) return null;

  return (
    <div className="mt-1.5">
      <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: strength.width, backgroundColor: strength.color }}
        />
      </div>
      <p className="text-[11px] font-semibold mt-1" style={{ color: strength.color }}>
        Password strength: {strength.level}
      </p>
    </div>
  );
};

export default PasswordStrengthBar;
