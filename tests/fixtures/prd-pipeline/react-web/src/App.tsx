import { Routes, Route } from 'react-router-dom';
import { ReportsPage } from './pages/ReportsPage';

export function App() {
  return (
    <Routes>
      <Route path="/reports" element={<ReportsPage />} />
    </Routes>
  );
}
