import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { FiHome, FiSettings, FiCheckCircle } from 'react-icons/fi';

const HOSPITALS = [
  { label: 'Hospital A', delay: 0 },
  { label: 'Hospital B', delay: 0.4 },
  { label: 'Hospital C', delay: 0.8 },
];

const ACCURACY_STEPS = [65, 71, 78];

const HospitalNode = ({ label, delay }) => (
  <motion.div
    initial={{ opacity: 0, x: -20 }}
    whileInView={{ opacity: 1, x: 0 }}
    viewport={{ once: true }}
    transition={{ duration: 0.5, delay }}
    className="relative"
  >
    <motion.div
      animate={{
        boxShadow: [
          '0 0 0 rgba(0, 212, 255, 0)',
          '0 0 30px rgba(0, 212, 255, 0.5)',
          '0 0 0 rgba(0, 212, 255, 0)',
        ],
      }}
      transition={{ duration: 2.4, repeat: Infinity, delay }}
      className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-accent/30 bg-primary-900/40 backdrop-blur-sm"
    >
      <div className="p-2 rounded-xl bg-accent/15 text-accent">
        <FiHome className="w-5 h-5" />
      </div>
      <div>
        <p className="text-sm font-semibold text-white">{label}</p>
        <p className="text-[10px] text-blue-200/70">Local model training</p>
      </div>
    </motion.div>
  </motion.div>
);

const FlowingArrow = ({ label, delay = 0, reverse = false }) => (
  <div className="relative flex flex-col items-center justify-center w-full px-2">
    <p className="text-[10px] uppercase tracking-wider text-accent/80 mb-1.5 whitespace-nowrap">
      {label}
    </p>
    <div className="relative w-full h-0.5 bg-accent/20 overflow-hidden rounded-full">
      <motion.div
        className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-accent to-transparent"
        animate={{ x: reverse ? ['100%', '-100%'] : ['-100%', '100%'] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: 'linear', delay }}
      />
    </div>
    <motion.div
      className="absolute top-1/2 left-0 -mt-1 w-2 h-2 rounded-full bg-accent shadow-[0_0_10px_rgba(0,212,255,0.9)]"
      animate={{ x: reverse ? ['100%', '0%'] : ['0%', '100%'], opacity: [0, 1, 0] }}
      transition={{ duration: 1.8, repeat: Infinity, ease: 'linear', delay }}
      style={{ left: 0, right: 0 }}
    />
  </div>
);

const FLServer = () => (
  <motion.div
    initial={{ opacity: 0, scale: 0.8 }}
    whileInView={{ opacity: 1, scale: 1 }}
    viewport={{ once: true }}
    transition={{ duration: 0.6, delay: 0.4 }}
    className="relative"
  >
    <motion.div
      animate={{
        boxShadow: [
          '0 0 0 rgba(0, 212, 255, 0.2)',
          '0 0 50px rgba(0, 212, 255, 0.6)',
          '0 0 0 rgba(0, 212, 255, 0.2)',
        ],
      }}
      transition={{ duration: 2, repeat: Infinity }}
      className="flex flex-col items-center px-6 py-5 rounded-2xl border-2 border-accent/50 bg-gradient-to-br from-primary-800/80 to-primary-900/80 backdrop-blur-sm"
    >
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
        className="p-3 rounded-2xl bg-accent/15 text-accent mb-2"
      >
        <FiSettings className="w-7 h-7" />
      </motion.div>
      <p className="text-sm font-bold text-white">FL Server</p>
      <p className="text-[11px] text-accent/90 mt-0.5">FedAvg Algorithm</p>
    </motion.div>
  </motion.div>
);

const useCountUp = (steps, intervalMs = 1500) => {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setIdx((i) => (i + 1) % steps.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [steps.length, intervalMs]);
  return steps[idx];
};

const UpdatedModel = () => {
  const accuracy = useCountUp(ACCURACY_STEPS, 1800);
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay: 0.8 }}
    >
      <motion.div
        animate={{
          boxShadow: [
            '0 0 0 rgba(6, 214, 160, 0)',
            '0 0 30px rgba(6, 214, 160, 0.5)',
            '0 0 0 rgba(6, 214, 160, 0)',
          ],
        }}
        transition={{ duration: 2.4, repeat: Infinity }}
        className="flex flex-col items-center px-6 py-4 rounded-2xl border border-success/40 bg-primary-900/40 backdrop-blur-sm"
      >
        <div className="p-2 rounded-xl bg-success/15 text-success mb-2">
          <FiCheckCircle className="w-6 h-6" />
        </div>
        <p className="text-sm font-semibold text-white">Updated Model</p>
        <motion.p
          key={accuracy}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-2xl font-bold text-success mt-1"
        >
          {accuracy}%
        </motion.p>
        <p className="text-[10px] text-blue-200/70">Accuracy</p>
      </motion.div>
    </motion.div>
  );
};

const FLNetworkAnimation = () => (
  <div className="w-full max-w-5xl mx-auto">
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="text-center mb-12"
    >
      <h2 className="text-3xl sm:text-4xl font-bold gradient-text">
        How Federated Learning Works
      </h2>
      <p className="text-blue-200/80 mt-3 max-w-2xl mx-auto">
        Patient data never leaves the hospital. Only encrypted model weights travel.
      </p>
    </motion.div>

    <div className="grid grid-cols-12 gap-4 items-center">
      {/* Left column — hospitals */}
      <div className="col-span-12 md:col-span-3 flex flex-col gap-4">
        {HOSPITALS.map((h) => (
          <HospitalNode key={h.label} label={h.label} delay={h.delay} />
        ))}
      </div>

      {/* Arrow column 1 */}
      <div className="col-span-12 md:col-span-2 flex flex-col gap-8 md:gap-10 py-2">
        <FlowingArrow label="encrypted weights" delay={0} />
        <FlowingArrow label="encrypted weights" delay={0.3} />
        <FlowingArrow label="encrypted weights" delay={0.6} />
      </div>

      {/* Center server */}
      <div className="col-span-12 md:col-span-2 flex justify-center">
        <FLServer />
      </div>

      {/* Arrow column 2 */}
      <div className="col-span-12 md:col-span-2">
        <FlowingArrow label="global model" delay={0.4} />
      </div>

      {/* Right — updated model */}
      <div className="col-span-12 md:col-span-3 flex justify-center">
        <UpdatedModel />
      </div>
    </div>

    <motion.p
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ delay: 1 }}
      className="text-center text-xs text-blue-200/60 mt-10 italic"
    >
      Raw patient data never leaves the hospital — only mathematical weights are aggregated.
    </motion.p>
  </div>
);

export default FLNetworkAnimation;
