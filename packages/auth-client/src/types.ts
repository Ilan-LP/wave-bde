export type MemberRole = "BUREAU" | "RESPONSABLE_POLE" | "MEMBRE_POLE";

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: MemberRole;
  poleId: string | null;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  // Epoch ms, computed client-side from the login/refresh response's expiresIn.
  accessTokenExpiresAt: number;
  user: AuthUser;
}
