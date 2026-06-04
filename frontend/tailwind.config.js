/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#e8f0fb',
          100: '#c5d5f5',
          200: '#9eb8ef',
          300: '#769ae8',
          400: '#5883e3',
          500: '#1A3C6E',
          600: '#163266',
          700: '#11285d',
          800: '#0d1f53',
          900: '#080f42',
        },
        secondary: '#2E75B6',
        accent: '#00D4FF',
        success: '#06D6A0',
        danger: '#EF4444',
        warning: '#F59E0B',
        light: '#F8FAFF',
        // ─── FederCare landing-aligned dashboard tokens ───
        cream: '#FAF7F2',     // dashboard page background
        ink: '#000000',       // primary text / headings
        muted: '#666666',     // secondary text
        hairline: '#E5E5E5',  // card / divider borders
        // orange-500 (#F97316) & orange-50 (#FFF7ED) come from Tailwind's
        // default palette and match the design spec exactly.
      },
      fontFamily: {
        sans: ['Manrope', 'Inter', 'system-ui', 'sans-serif'],
        bricolage: ['"Bricolage Grotesque"', 'sans-serif'],
        manrope: ['Manrope', 'sans-serif'],
      },
      boxShadow: {
        card: '0 2px 15px rgba(26, 60, 110, 0.08)',
        hover: '0 8px 30px rgba(26, 60, 110, 0.15)',
      },
      borderRadius: {
        xl: '1rem',
        '2xl': '1.5rem',
      },
    },
  },
  plugins: [],
};
