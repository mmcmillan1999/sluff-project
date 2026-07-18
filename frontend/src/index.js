import React from 'react';
import ReactDOM from 'react-dom/client';
// Brand fonts — referenced throughout the CSS but never loaded until now
import '@fontsource/oswald/400.css';
import '@fontsource/oswald/500.css';
import '@fontsource/oswald/600.css';
import '@fontsource/oswald/700.css';
import '@fontsource/merriweather/400.css';
import '@fontsource/merriweather/700.css';
import './index.css';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { initNative } from './utils/nativeInit';
import reportWebVitals from './utils/reportWebVitals';
import './utils/logger'; // Silences console in production

// Native (Capacitor) startup — no-ops on web.
initNative();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
