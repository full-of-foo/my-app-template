import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  RecoveryEmailSettings,
  EmailPasswordReset,
} from "../src/EmailRecovery";
import { api } from "../src/account-api";
vi.mock("../src/account-api", () => ({ api: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("does not offer email actions until the service is connected", async () => {
  vi.mocked(api).mockResolvedValue({ available: false, email: null });
  render(<RecoveryEmailSettings />);
  expect(
    await screen.findByText(/Email recovery isn’t available yet/),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Send verification email" }),
  ).not.toBeInTheDocument();
});
it("verifies and removes a recovery address with password confirmation", async () => {
  const user = userEvent.setup();
  vi.mocked(api)
    .mockResolvedValueOnce({ available: true, email: null })
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ email: "reader@example.com" })
    .mockResolvedValueOnce(undefined);
  render(<RecoveryEmailSettings />);
  await user.type(
    await screen.findByLabelText("Recovery email address"),
    "reader@example.com",
  );
  await user.type(screen.getByLabelText("Current password"), "a-long-password");
  await user.click(
    screen.getByRole("button", { name: "Send verification email" }),
  );
  await user.type(
    await screen.findByLabelText("Email verification code"),
    "a".repeat(64),
  );
  await user.click(screen.getByRole("button", { name: "Verify email" }));
  expect(
    await screen.findByText("Verified email: reader@example.com"),
  ).toBeVisible();
  await user.type(screen.getByLabelText("Current password"), "a-long-password");
  await user.click(
    screen.getByRole("button", { name: "Remove recovery email" }),
  );
  expect(await screen.findByText("Recovery email removed.")).toBeVisible();
  expect(api).toHaveBeenLastCalledWith("/account/email", "DELETE", {
    password: "a-long-password",
  });
});
it("requests email reset and requires saving the replacement recovery code before signing in separately", async () => {
  const user = userEvent.setup();
  vi.mocked(api)
    .mockResolvedValueOnce({ available: true })
    .mockResolvedValueOnce({ message: "Check your email" })
    .mockResolvedValueOnce({
      message: "Password updated",
      recoveryCode: "b".repeat(64),
    });
  render(<EmailPasswordReset />);
  await user.type(await screen.findByLabelText("Username"), "reader");
  await user.type(
    screen.getByLabelText("Verified email address"),
    "reader@example.com",
  );
  await user.click(screen.getByRole("button", { name: "Send reset email" }));
  await user.type(
    await screen.findByLabelText("Email reset code"),
    "a".repeat(64),
  );
  await user.type(screen.getByLabelText("New password"), "a-new-long-password");
  await user.click(screen.getByRole("button", { name: "Update password" }));
  expect(await screen.findByLabelText("Recovery code")).toHaveTextContent(
    "b".repeat(64),
  );
  expect(api).toHaveBeenLastCalledWith("/auth/email/reset", "POST", {
    username: "reader",
    code: "a".repeat(64),
    password: "a-new-long-password",
  });
});
it("shows delivery errors without reporting that an email was sent", async () => {
  const user = userEvent.setup();
  vi.mocked(api)
    .mockResolvedValueOnce({ available: true, email: null })
    .mockRejectedValueOnce(Error("Delivery unavailable"));
  render(<RecoveryEmailSettings />);
  await user.type(
    await screen.findByLabelText("Recovery email address"),
    "reader@example.com",
  );
  await user.type(screen.getByLabelText("Current password"), "a-long-password");
  await user.click(
    screen.getByRole("button", { name: "Send verification email" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Delivery unavailable",
  );
  expect(
    screen.queryByLabelText("Email verification code"),
  ).not.toBeInTheDocument();
});
