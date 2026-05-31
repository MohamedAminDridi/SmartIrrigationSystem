/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html','./src/**/*.{js,jsx,ts,tsx}'],
  theme: { extend: { colors: { brand: { 50:'#f0fdf4',100:'#dcfce7',700:'#15803d',800:'#166534' } } } },
  plugins: [],
};
