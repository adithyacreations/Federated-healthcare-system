import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FiArrowRight } from 'react-icons/fi';
import { cardVariants, cardHover } from './variants';

/**
 * QuickActionCard — white card with an orange icon, black title, grey
 * description and an arrow that slides on hover. Accepts either `to` (Link)
 * or `onClick`. Pass `danger` for the red Emergency-SOS treatment.
 */
const QuickActionCard = ({ icon: Icon, title, description, onClick, to, danger }) => {
  const content = (
    <motion.div
      variants={cardVariants}
      whileHover={cardHover}
      className={`group h-full flex items-center gap-4 rounded-2xl border p-5 cursor-pointer bg-white ${
        danger ? 'border-red-300 bg-red-50/50' : 'border-hairline'
      }`}
    >
      {Icon && (
        <div
          className={`p-3 rounded-xl shrink-0 ${
            danger ? 'bg-red-100 text-red-600' : 'bg-orange-50 text-orange-500'
          }`}
        >
          <Icon className={`w-6 h-6 ${danger ? 'animate-pulse' : ''}`} />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className={`font-semibold truncate ${danger ? 'text-red-600' : 'text-ink'}`}>
          {title}
        </div>
        {description && <div className="text-sm text-muted truncate">{description}</div>}
      </div>
      <FiArrowRight
        className={`w-5 h-5 shrink-0 transition-transform group-hover:translate-x-1 ${
          danger ? 'text-red-400' : 'text-gray-300 group-hover:text-orange-500'
        }`}
      />
    </motion.div>
  );

  if (to) return <Link to={to} className="block h-full">{content}</Link>;
  return <div onClick={onClick} className="h-full">{content}</div>;
};

export default QuickActionCard;
