import { createAuthClient } from "@wave/auth-client";
import { API_URL } from "./api";

export const authClient = createAuthClient(API_URL);
