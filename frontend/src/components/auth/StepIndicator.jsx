import { motion } from 'framer-motion';
import { FiCheck } from 'react-icons/fi';

const StepIndicator = ({ steps = [], current = 1 }) => (
  <div className="w-full mb-8">
    <div className="flex items-center justify-between">
      {steps.map((label, idx) => {
        const stepNum = idx + 1;
        const completed = stepNum < current;
        const active = stepNum === current;
        return (
          <div key={label} className="flex-1 flex items-center">
            <div className="flex flex-col items-center flex-1">
              <motion.div
                initial={false}
                animate={{
                  backgroundColor: completed || active ? '#F97316' : '#e5e7eb',
                  color: completed || active ? '#ffffff' : '#9ca3af',
                  scale: active ? 1.1 : 1,
                }}
                className="w-9 h-9 rounded-full flex items-center justify-center font-semibold text-sm shadow-md"
              >
                {completed ? <FiCheck className="w-4 h-4" /> : stepNum}
              </motion.div>
              <span
                className={`text-xs mt-2 font-medium text-center ${
                  active ? 'text-orange-500' : 'text-gray-500'
                }`}
              >
                {label}
              </span>
            </div>
            {stepNum < steps.length && (
              <div className="flex-1 h-0.5 mx-2 bg-gray-200 relative">
                <motion.div
                  initial={false}
                  animate={{ width: completed ? '100%' : '0%' }}
                  transition={{ duration: 0.3 }}
                  className="absolute inset-y-0 left-0 bg-orange-500"
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  </div>
);

export default StepIndicator;
