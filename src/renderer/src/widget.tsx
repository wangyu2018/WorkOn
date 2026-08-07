import React from 'react'
import ReactDOM from 'react-dom/client'
import SuggestionWidget from './widget/SuggestionWidget'
import './index.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <SuggestionWidget />
  </React.StrictMode>
)
