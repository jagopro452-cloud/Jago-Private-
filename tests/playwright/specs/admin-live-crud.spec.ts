import { expect, request, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { createQaTag, runtime } from "../support/runtime";
import { loginLiveAdmin, seedLiveAdminSession } from "../support/admin-live";

let adminSession: Awaited<ReturnType<typeof loginLiveAdmin>>;
let api: APIRequestContext;

function authHeaders() {
  return {
    Authorization: `Bearer ${adminSession.token}`,
    "content-type": "application/json",
  };
}

async function resolveLanguageCard(page: Page, code: string) {
  const card = page.getByTestId(`card-language-${code}`);
  await expect(card).toBeVisible();
  await card.scrollIntoViewIfNeeded();
  return card;
}

async function resolveLanguageAction(card: Locator, preferredTestId: string, fallbackIndex: number) {
  const preferred = card.getByTestId(preferredTestId);
  if (await preferred.count()) {
    return preferred;
  }
  return card.locator("button").nth(fallbackIndex);
}

async function resolveLanguageEditInput(card: Locator, preferredTestId: string, fallbackIndex: number) {
  const preferred = card.getByTestId(preferredTestId);
  if (await preferred.count()) {
    return preferred;
  }
  return card.locator("input").nth(fallbackIndex);
}

async function adminJson(method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", path: string, data?: unknown) {
  const response = method === "GET"
    ? await api.get(path, { headers: authHeaders() })
    : method === "POST"
      ? await api.post(path, { headers: authHeaders(), data })
      : method === "PATCH"
        ? await api.patch(path, { headers: authHeaders(), data })
        : method === "PUT"
          ? await api.put(path, { headers: authHeaders(), data })
          : await api.delete(path, { headers: authHeaders() });

  return response;
}

test.describe("Admin Live CRUD And Security", () => {
  test.beforeAll(async () => {
    adminSession = await loginLiveAdmin();
    api = await request.newContext({
      baseURL: runtime.apiBaseURL,
      extraHTTPHeaders: { "x-jago-playwright-suite": "true" },
      ignoreHTTPSErrors: true,
    });
  });

  test.afterAll(async () => {
    await api?.dispose();
  });

  test.beforeEach(async ({ page }) => {
    await seedLiveAdminSession(page, adminSession);
  });

  test("@live @admin-live blocks protected admin APIs without auth", async () => {
    const unauth = await request.newContext({
      baseURL: runtime.apiBaseURL,
      ignoreHTTPSErrors: true,
    });
    try {
      const response = await unauth.get("/api/admin/system-health");
      expect([401, 403]).toContain(response.status());
    } finally {
      await unauth.dispose();
    }
  });

  test("@live @admin-live validates app languages live CRUD and refresh persistence", async ({ page }) => {
    const code = `qa${Date.now().toString().slice(-4)}`;
    const name = createQaTag(`Language ${code}`);
    const renamed = `QA ${code} Updated`;

    await page.goto("/admin/languages");
    await page.getByTestId("button-add-language").click();
    await page.getByTestId("input-lang-code").fill(code);
    await page.getByTestId("input-lang-name").fill(name);
    await page.getByTestId("input-lang-native").fill(`Native ${code}`);
    await page.getByTestId("button-save-language").click();

    const createdCard = page.getByTestId(`card-language-${code}`);
    await expect(createdCard).toBeVisible();
    await expect(createdCard).toContainText(name);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId(`card-language-${code}`)).toContainText(name);

    const listResponse = await adminJson("GET", "/api/admin/languages");
    expect(listResponse.ok()).toBeTruthy();
    const languages = await listResponse.json() as Array<{ id: string; code: string; name: string; is_active: boolean }>;
    const created = languages.find((item) => item.code === code);
    expect(created).toBeTruthy();

    const card = await resolveLanguageCard(page, code);
    await (await resolveLanguageAction(card, `button-edit-language-${code}`, 1)).click();
    await (await resolveLanguageEditInput(card, `input-edit-language-name-${code}`, 0)).fill(renamed);
    const updateResponsePromise = page.waitForResponse((response) =>
      response.request().method() === "PATCH"
      && /\/api\/admin\/languages\/[^/]+$/.test(new URL(response.url()).pathname),
    );
    await (await resolveLanguageAction(card, `button-update-language-${code}`, 0)).click();
    const updateResponse = await updateResponsePromise;
    expect(updateResponse.ok(), `Language update failed with status ${updateResponse.status()}: ${await updateResponse.text()}`).toBeTruthy();
    await expect(card.locator("input")).toHaveCount(0, { timeout: 20_000 });
    await expect(card).toContainText(renamed);

    await (await resolveLanguageAction(card, `toggle-language-${code}`, 0)).click();
    await expect(card).toContainText("Hidden");

    const toggledResponse = await adminJson("GET", "/api/admin/languages");
    const toggledLanguages = await toggledResponse.json() as Array<{ code: string; is_active: boolean; name: string }>;
    const toggled = toggledLanguages.find((item) => item.code === code);
    expect(toggled?.is_active).toBeFalsy();
    expect(toggled?.name).toBe(renamed);

    page.once("dialog", (dialog) => dialog.accept());
    await (await resolveLanguageAction(card, `delete-language-${code}`, 2)).click();
    await expect(page.getByTestId(`card-language-${code}`)).toHaveCount(0);

    const deletedResponse = await adminJson("GET", "/api/admin/languages");
    const deletedLanguages = await deletedResponse.json() as Array<{ code: string }>;
    expect(deletedLanguages.some((item) => item.code === code)).toBeFalsy();
  });

  test("@live @admin-live validates intercity routes live CRUD, search, and API persistence", async ({ page }) => {
    const baseFare = Number(`4${Date.now().toString().slice(-3)}`);
    const updatedFare = baseFare + 111;

    await page.goto("/admin/intercity-routes");
    await page.getByTestId("btn-add-route").click();
    await page.getByTestId("select-from-city").selectOption("Guwahati");
    await page.getByTestId("select-to-city").selectOption("Bhubaneswar");
    await page.getByTestId("input-km").fill("925");
    await page.getByTestId("input-base-fare").fill(String(baseFare));
    await page.getByTestId("btn-save-route").click();

    const createResponse = await adminJson("GET", "/api/intercity-routes");
    expect(createResponse.ok()).toBeTruthy();
    const routes = await createResponse.json() as Array<{ id: string; fromCity: string; toCity: string; baseFare: number }>;
    const created = routes.find((item) =>
      item.fromCity === "Guwahati"
      && item.toCity === "Bhubaneswar"
      && Number(item.baseFare) === baseFare,
    );
    expect(created).toBeTruthy();

    await page.getByTestId("input-search-route").fill("Guwahati");
    await expect(page.getByTestId(`row-route-${created!.id}`)).toBeVisible();
    await page.getByTestId(`btn-edit-route-${created!.id}`).click();
    await page.getByTestId("input-base-fare").fill(String(updatedFare));
    const updateUiResponse = page.waitForResponse((response) =>
      response.request().method() === "PUT"
      && response.url().includes(`/api/intercity-routes/${created!.id}`),
    );
    await page.getByTestId("btn-save-route").click();
    const persistedUpdate = await updateUiResponse;
    const persistedUpdateText = persistedUpdate.ok() ? "" : await persistedUpdate.text();
    expect(
      persistedUpdate.ok(),
      `Intercity route update failed with status ${persistedUpdate.status()}: ${persistedUpdateText}`,
    ).toBeTruthy();

    const updateResponse = await adminJson("GET", "/api/intercity-routes");
    const updatedRoutes = await updateResponse.json() as Array<{ id: string; baseFare: number; isActive: boolean }>;
    const updated = updatedRoutes.find((item) => item.id === created!.id);
    expect(Number(updated?.baseFare)).toBe(updatedFare);

    const activeBeforeToggle = Boolean(updated?.isActive);
    await page.getByTestId(`toggle-route-${created!.id}`).setChecked(!activeBeforeToggle, { force: true });
    const toggledResponse = await adminJson("GET", "/api/intercity-routes");
    const toggledRoutes = await toggledResponse.json() as Array<{ id: string; isActive: boolean }>;
    const toggled = toggledRoutes.find((item) => item.id === created!.id);
    expect(Boolean(toggled?.isActive)).toBe(!activeBeforeToggle);

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByTestId(`btn-delete-route-${created!.id}`).click();
    const deleteResponse = await adminJson("GET", "/api/intercity-routes");
    const deletedRoutes = await deleteResponse.json() as Array<{ id: string }>;
    expect(deletedRoutes.some((item) => item.id === created!.id)).toBeFalsy();
  });

  test("@live @admin-live validates admin business-settings write/read DB sync", async () => {
    const keyName = `playwright_admin_qa_${Date.now()}`;
    const value = createQaTag("admin business setting value");

    const writeResponse = await adminJson("POST", "/api/admin/business-settings", {
      key_name: keyName,
      value,
      settingsType: "text",
    });
    expect(writeResponse.ok()).toBeTruthy();

    const readResponse = await adminJson("GET", `/api/admin/business-settings/${keyName}`);
    expect(readResponse.ok()).toBeTruthy();
    const body = await readResponse.json() as { key_name: string; value: string };
    expect(body.key_name).toBe(keyName);
    expect(body.value).toBe(value);
  });
});
