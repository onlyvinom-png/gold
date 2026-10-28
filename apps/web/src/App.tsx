import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { SignalDetails } from './pages/SignalDetails';
import { SignalHistory } from './pages/SignalHistory';
import { StrategyRules } from './pages/StrategyRules';
import { Settings } from './pages/Settings';
import { Diagnostics } from './pages/Diagnostics';

export function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/signals" element={<SignalHistory />} />
            <Route path="/signals/:id" element={<SignalDetails />} />
            <Route path="/history" element={<SignalHistory />} />
            <Route path="/strategy" element={<StrategyRules />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/diagnostics" element={<Diagnostics />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}

export default App;
