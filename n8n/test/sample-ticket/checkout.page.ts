import { type Page, type Locator, expect } from '@playwright/test';

export class CheckoutPage {
  readonly couponInput: Locator;
  readonly applyCouponButton: Locator;
  readonly couponMessage: Locator;
  readonly subtotal: Locator;
  readonly discount: Locator;
  readonly total: Locator;

  constructor(private readonly page: Page) {
    this.couponInput = page.getByTestId('coupon-input');
    this.applyCouponButton = page.getByRole('button', { name: 'Apply' });
    this.couponMessage = page.getByTestId('coupon-message');
    this.subtotal = page.getByTestId('order-subtotal');
    this.discount = page.getByTestId('order-discount');
    this.total = page.getByTestId('order-total');
  }

  async open(cartId: string): Promise<void> {
    await this.page.goto(`/checkout?cart=${encodeURIComponent(cartId)}`);
    await expect(this.couponInput).toBeVisible();
  }

  async applyCoupon(code: string): Promise<void> {
    await this.couponInput.fill(code);
    await this.applyCouponButton.click();
  }

  async expectMessage(text: string): Promise<void> {
    await expect(this.couponMessage).toHaveText(text);
  }
}
