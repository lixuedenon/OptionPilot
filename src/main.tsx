import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Shell from './Shell.tsx';
import { I18nProvider } from './i18n/I18nContext';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <Shell />
    </I18nProvider>
  </StrictMode>
);