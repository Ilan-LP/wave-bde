import { useState } from "react";
import { useAuth } from "@wave/auth-client";
import { authClient } from "./lib/authClient";
import { LoginScreen } from "./screens/LoginScreen";
import { ProfileScreen } from "./screens/ProfileScreen";

type Tab = "home" | "profil";

function App() {
  const [tab, setTab] = useState<Tab>("home");
  const auth = useAuth(authClient);

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <nav className="flex justify-center gap-2 border-b border-gray-200 p-4">
        <button
          onClick={() => setTab("home")}
          className={`rounded-lg px-4 py-2 font-semibold ${tab === "home" ? "bg-wave text-white" : "text-gray-700 hover:bg-gray-100"}`}
        >
          Accueil
        </button>
        <button
          onClick={() => setTab("profil")}
          className={`rounded-lg px-4 py-2 font-semibold ${tab === "profil" ? "bg-wave text-white" : "text-gray-700 hover:bg-gray-100"}`}
        >
          Profil
        </button>
      </nav>

      {tab === "home" && (
        <main className="flex flex-1 items-center justify-center bg-white">
          <h1 className="text-2xl font-bold text-wave">Hello Wave — Showcase</h1>
        </main>
      )}

      {tab === "profil" && (
        <main className="flex flex-1 flex-col bg-white">
          {auth.isAuthenticated ? <ProfileScreen auth={auth} /> : <LoginScreen auth={auth} />}
        </main>
      )}
    </div>
  );
}

export default App;
