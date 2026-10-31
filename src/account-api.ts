import { requestApi } from "./mobile";
import { z } from "zod";
import { documentSchema, type AppDocument } from "./data";
export const userSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
});
export type User = z.infer<typeof userSchema>;
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  let response: Pick<Response, "status" | "ok" | "json">;
  try {
    response = await requestApi(path, method, body);
  } catch {
    throw new ApiError(
      "The account service is unreachable. Your changes stay saved on this device until you reconnect.",
      0,
    );
  }
  if (response.status === 204) return undefined as T;
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(
      "The account service is not available in this installation.",
      503,
    );
  }
  if (!response.ok)
    throw new ApiError(
      z.object({ error: z.string() }).safeParse(data).data?.error ??
        "The request could not be completed.",
      response.status,
    );
  return data as T;
}
export async function getSession() {
  return z
    .object({ user: userSchema.nullable() })
    .parse(await api("/auth/session")).user;
}
export async function authenticate(
  mode: "register" | "login" | "recover",
  username: string,
  password: string,
  recoveryCode?: string,
) {
  return z
    .object({ user: userSchema, recoveryCode: z.string().optional() })
    .parse(
      await api(`/auth/${mode}`, "POST", {
        username,
        password,
        ...(recoveryCode ? { recoveryCode } : {}),
      }),
    );
}
export async function getCloud() {
  return z
    .object({ revision: z.number().int().nonnegative(), data: documentSchema })
    .parse(await api("/data"));
}
export async function putCloud(revision: number, data: AppDocument) {
  return z
    .object({ revision: z.number().int().nonnegative() })
    .parse(await api("/data", "PUT", { revision, data }));
}
export async function eraseCloud() {
  return z
    .object({ revision: z.number().int().nonnegative() })
    .parse(await api("/data", "DELETE"));
}
export async function signOut() {
  await api("/auth/logout", "POST", {});
}
export async function deleteAccount(password: string) {
  await api("/account", "DELETE", { password });
}
