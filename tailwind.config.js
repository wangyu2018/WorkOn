/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/*.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 静谧深空色板（与 index.css 变量同步）
        ink: {
          950: '#070B13',
          900: '#0B101B',
          800: '#121826',
          700: '#1A2233'
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
        glass: '0 10px 30px rgba(0,0,0,0.32)',
        glow: '0 0 14px rgba(34,211,238,0.22)'
      },
      backdropBlur: { xs: '2px' }
    }
  },
  plugins: []
}
