// Normalise a doctor's display name to exactly one "Dr. " prefix.
//
// Handles bare names ("Rajesh"), already-prefixed ("Dr. Rajesh"), and the
// duplicated "Dr. Dr. Rajesh" that appears when a stored name already carried
// "Dr." and the UI prefixed it again. Empty/missing names return ''.
export const cleanDoctorName = (name) => {
  if (!name) return '';
  const stripped = String(name).trim().replace(/^(?:dr\.?\s*)+/i, '').trim();
  return stripped ? `Dr. ${stripped}` : '';
};

export default cleanDoctorName;
