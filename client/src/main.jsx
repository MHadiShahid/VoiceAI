import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout.jsx';
import { PatientsPage } from './pages/PatientsPage.jsx';
import { PatientDetailPage } from './pages/PatientDetailPage.jsx';
import { NewPatientPage } from './pages/NewPatientPage.jsx';
import { CallsPage } from './pages/CallsPage.jsx';
import { EmptyState } from './components/ui.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<PatientsPage />} />
          <Route path="patients/new" element={<NewPatientPage />} />
          <Route path="patients/:id" element={<PatientDetailPage />} />
          <Route path="calls" element={<CallsPage />} />
          <Route path="*" element={<EmptyState title="Page not found." />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
