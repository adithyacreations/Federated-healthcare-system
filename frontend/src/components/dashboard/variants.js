// Shared Framer Motion variants for all FederCare dashboards.

// Page wrapper — fades in from bottom and staggers its children.
export const pageVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
      ease: 'easeOut',
      when: 'beforeChildren',
      staggerChildren: 0.08,
    },
  },
};

// Individual card / item — spring up + scale, used as a stagger child.
export const cardVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: 'spring', stiffness: 100, damping: 12 },
  },
};

// Reusable hover effect — lift + soft shadow.
export const cardHover = {
  scale: 1.02,
  boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
  transition: { duration: 0.2 },
};
