import { forwardRef } from 'react';

const FormInput = forwardRef(
  (
    {
      label,
      icon: Icon,
      error,
      hint,
      type = 'text',
      as = 'input',
      options = [],
      rightIcon,
      className = '',
      ...rest
    },
    ref
  ) => {
    const inputClass = `input-field ${Icon ? 'pl-10' : ''} ${rightIcon ? 'pr-10' : ''} ${
      error ? 'border-danger focus:ring-red-200' : ''
    } ${className}`;

    const renderControl = () => {
      if (as === 'select') {
        return (
          <select ref={ref} className={inputClass} {...rest}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        );
      }
      if (as === 'textarea') {
        return <textarea ref={ref} rows={3} className={inputClass} {...rest} />;
      }
      return <input ref={ref} type={type} className={inputClass} {...rest} />;
    };

    return (
      <div className="w-full">
        {label && (
          <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
        )}
        <div className="relative">
          {Icon && (
            <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          )}
          {renderControl()}
          {rightIcon && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
              {rightIcon}
            </div>
          )}
        </div>
        {error ? (
          <p className="text-xs text-danger mt-1">{error}</p>
        ) : hint ? (
          <p className="text-xs text-gray-400 mt-1">{hint}</p>
        ) : null}
      </div>
    );
  }
);

export default FormInput;
