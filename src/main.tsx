import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { watchForUpdates } from './lib/pwa.ts';
import './styles.css';

// Вне React намеренно: StrictMode вызывает эффекты дважды, а регистрация
// служебного работника должна случиться ровно один раз за загрузку.
watchForUpdates();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
