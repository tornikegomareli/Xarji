import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Dashboard, Transactions, Categories, Budgets, Merchants, Income, Signals, Settings, Assistant, Plan } from "./pages";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="transactions" element={<Transactions />} />
          <Route path="income" element={<Income />} />
          <Route path="categories" element={<Categories />} />
          <Route path="budgets" element={<Budgets />} />
          <Route path="merchants" element={<Merchants />} />
          <Route path="plan" element={<Plan />} />
          <Route path="assistant" element={<Assistant />} />
          <Route path="signals" element={<Signals />} />
          <Route path="manage" element={<Settings />} />
          {/* Compatibility redirects for the routes that existed in the
              previous version of the app, so old bookmarks and shared
              links still resolve. */}
          <Route path="analytics" element={<Navigate to="/signals" replace />} />
          <Route path="settings" element={<Navigate to="/manage" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
