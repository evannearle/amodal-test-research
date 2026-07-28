import { useRoute } from "./lib/router";
import { Home } from "./pages/Home";
import { Dashboard } from "./pages/Dashboard";

export function App() {
  const { path, navigate } = useRoute();

  const companyMatch = path.match(/^\/company\/([^/]+)\/?$/);
  if (companyMatch) {
    const ticker = decodeURIComponent(companyMatch[1]).toUpperCase();
    return <Dashboard ticker={ticker} navigate={navigate} />;
  }

  return <Home navigate={navigate} />;
}
