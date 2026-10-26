import { createBrowserRouter } from 'react-router-dom';
import { OrdersPage } from '../pages/OrdersPage';
import { SettingsPage } from '../pages/SettingsPage';

export const router = createBrowserRouter([
  { path: '/', element: <OrdersPage /> },
  {
    path: '/settings',
    element: <SettingsPage />,
  },
]);
