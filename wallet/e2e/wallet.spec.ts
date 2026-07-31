import { test, expect } from "@playwright/test";

test("happy path: create wallet, run guardian on a demo, see verdict", async ({
  page,
  context,
}) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await page.goto("/onboarding");
  await page.getByLabel(/I understand/).check();
  await page.getByRole("button", { name: /Create wallet/ }).click();
  await page.waitForURL(/\/wallet$/);
  await page.getByRole("button", { name: /Unlock/ }).click();

  await page.locator("select").selectOption("send-eth-self");
  await page.getByRole("button", { name: /Run guardian/ }).click();

  await expect(page.locator("text=Findings")).toBeVisible({ timeout: 60_000 });
});
