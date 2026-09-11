import { useAuth } from "@wave/auth-client";
import { authClient } from "./lib/authClient";
import { LoginScreen } from "./screens/LoginScreen";
import { TillScreen } from "./screens/TillScreen";

function App() {
  const auth = useAuth(authClient);

  return auth.isAuthenticated ? <TillScreen auth={auth} /> : <LoginScreen auth={auth} />;
}

export default App;
