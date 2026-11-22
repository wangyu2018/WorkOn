import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import V10Surface from './v10/V10Surface'
import './index.css'

// 主窗：Today 主界面；拆出右页 / 问玻璃窗（pane / glass）仍挂 v10 表面
const params = new URLSearchParams(window.location.search)
const isPane = params.has('pane') || params.get('glass') === '1' || params.get('v10') === '1'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>{isPane ? <V10Surface /> : <App />}</React.StrictMode>
)
