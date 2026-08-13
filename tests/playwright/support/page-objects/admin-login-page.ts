import { expect, type Page } from "@playwright/test";

export class AdminLoginPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto("/admin/login");
    await expect(this.page.getByTestId("login-page")).toBeVisible();
  }

  async login(email: string, password: string) {
    await this.page.getByTestId("input-email").fill(email);
    await this.page.getByTestId("input-password").fill(password);
    await this.page.getByTestId("btn-login").click();
  }

  async requestPasswordReset(email: string) {
    await this.page.getByTestId("btn-forgot-password").click();
    await this.page.getByTestId("input-forgot-email").fill(email);
    await this.page.getByTestId("btn-send-otp").click();
  }
}
