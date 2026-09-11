import { useAuth } from "@wave/auth-client";
import { authClient } from "./lib/authClient";
import { LoginScreen } from "./screens/LoginScreen";
import { ProductsScreen } from "./screens/ProductsScreen";

function App() {
  const auth = useAuth(authClient);

  if (!auth.isAuthenticated) {
    return <LoginScreen auth={auth} />;
  }

  if (auth.user?.role !== "BUREAU") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white p-4">
        <p className="text-lg font-semibold text-gray-700">This page is only available to BUREAU members.</p>
      </main>
    );
  }

  return <ProductsScreen auth={auth} />;
}

export default App;
