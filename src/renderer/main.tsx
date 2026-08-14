import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

class RenderErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('NEXUS renderer error', error, info);
  }

  render() {
    if (this.state.error) {
      return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 40, color: '#edf2fb', background: '#090d16', fontFamily: 'Segoe UI, sans-serif' }}><div style={{ maxWidth: 720, padding: 28, border: '1px solid rgba(255,113,143,.35)', borderRadius: 18, background: '#151c2a' }}><h1 style={{ margin: 0, fontSize: 24 }}>NEXUS не смог загрузить интерфейс</h1><p style={{ margin: '12px 0 0', color: '#ff9aad', lineHeight: 1.6 }}>{this.state.error.message}</p><p style={{ margin: '18px 0 0', color: '#9aa7ba', fontSize: 13 }}>Перезапустите NEXUS. Если ошибка повторится, нажмите Ctrl+Shift+I и скопируйте текст из Console для диагностики.</p></div></div>;
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RenderErrorBoundary>
      <App />
    </RenderErrorBoundary>
  </React.StrictMode>,
);
