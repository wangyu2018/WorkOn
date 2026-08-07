/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/*.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // v2.2 CSS 变量体系（科技感暗色）
        ink: {
          950: '#070B14',
          900: '#0B1220',
          800: '#111A2E',
          700: '#1A2540'
        },
        neon: {
          cyan: '#22D3EE',
          blue: '#3B82F6',
          violet: '#8B5CF6',
          pink: '#EC4899',
          amber: '#F59E0B',
          green: '#10B981',
          red: '#EF4444'
        }
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'Consolas', 'monospace']
      },
      boxShadow: {
        glass: '0 8px 32px rgba(0,0,0,0.37)',
        glow: '0 0 18px rgba(34,211,238,0.35)'
      },
      backdropBlur: { xs: '2px' }
    }
  },
  plugins: []
}
