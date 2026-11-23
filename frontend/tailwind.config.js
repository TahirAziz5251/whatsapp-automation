/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0fdf4',
          100: '#dcfce7',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
        }
      },
      boxShadow: {
        '3d': '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
        '3d-dark': '0 12px 30px -5px rgba(0, 0, 0, 0.5), 0 8px 12px -6px rgba(0, 0, 0, 0.4)',
        'glow-emerald': '0 0 20px -3px rgba(16, 185, 129, 0.35)',
        'glow-indigo': '0 0 20px -3px rgba(99, 102, 241, 0.35)',
      }
    },
  },
  plugins: [],
};
