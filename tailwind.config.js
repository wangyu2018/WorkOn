/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/*.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 静谧深空色板（与 index.css 变量同步）
        ink: {
          950: '#090D14',
          900: '#0D1117',
          800: '#151C24',
          700: '#1A232C'
        },
        neon: {
          cyan: '#0FB5A4',
          blue: '#6366F1',
          violet: '#8B5CF6',
          pink: '#EC4899',
          amber: '#F59E0B',
          green: '#10B981',
          red: '#EF4444'
        }
      },
      /**
       * 统一字号阶梯（DESIGN-TOKENS: 7 档正文 + 3 档展示）
       * 此前全站硬编码 26 种 px 字号（含 462 处 ≤10px），是「看不清/丑」的主因。
       * 规则：正文只用 2xs/xs/sm/base 四档；标题 lg/xl；数字指标 2xl/3xl/4xl。
       */
      fontSize: {
        '2xs': ['11px', { lineHeight: '1.45', letterSpacing: '0.005em' }],
        xs: ['12px', { lineHeight: '1.5' }],
        sm: ['13px', { lineHeight: '1.55' }],
        base: ['14px', { lineHeight: '1.55' }],
        lg: ['16px', { lineHeight: '1.45' }],
        xl: ['20px', { lineHeight: '1.35' }],
        '2xl': ['26px', { lineHeight: '1.25', letterSpacing: '-0.01em' }],
        '3xl': ['36px', { lineHeight: '1.15', letterSpacing: '-0.02em' }],
        '4xl': ['52px', { lineHeight: '1.05', letterSpacing: '-0.02em' }]
      },
      /**
       * 圆角收敛为 4 档：md(6) 小控件 / lg(10) 输入与按钮 / xl(14) 子卡 / 2xl(18) 卡片与弹层
       * 3xl 归并进 2xl，避免同屏出现 4 种以上圆角。
       */
      borderRadius: {
        md: '6px',
        lg: '10px',
        xl: '14px',
        '2xl': '18px',
        '3xl': '18px'
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'Consolas', 'monospace']
      },
      boxShadow: {
        glass: '0 10px 30px rgba(0,0,0,0.32)',
        glow: '0 0 14px rgba(15,181,164,0.22)'
      },
      backdropBlur: { xs: '2px' }
    }
  },
  plugins: []
}
