import { test, expect } from '../../fixtures/checkout.fixture';

test.describe('PROJ-101 coupon at checkout', () => {
  test('TC-01 valid coupon SAVE10 reduces subtotal by 10% @PROJ-101 @checkout-coupon @smoke', async ({ checkout }) => {
    await checkout.applyCoupon('SAVE10');
    await checkout.expectMessage('Coupon applied');
    await expect(checkout.discount).toHaveText('-$5.00');
    await expect(checkout.total).toHaveText('$45.00');
  });

  test('TC-02 expired coupon shows error and keeps total @PROJ-101 @checkout-coupon @regression', async ({ checkout }) => {
    await checkout.applyCoupon('SUMMER2025');
    await checkout.expectMessage('This coupon has expired');
    await expect(checkout.total).toHaveText('$50.00');
  });

  test('TC-03 unknown coupon is rejected @PROJ-101 @checkout-coupon @regression', async ({ checkout }) => {
    await checkout.applyCoupon('NOPE-123');
    await checkout.expectMessage('Invalid coupon code');
    await expect(checkout.discount).toBeHidden();
  });

  test('TC-04 second coupon is refused @PROJ-101 @checkout-coupon @regression', async ({ checkout }) => {
    await checkout.applyCoupon('SAVE10');
    await checkout.expectMessage('Coupon applied');
    await checkout.applyCoupon('WELCOME5');
    await checkout.expectMessage('Only one coupon can be applied');
    await expect(checkout.total).toHaveText('$45.00');
  });

  test('TC-05 empty and whitespace codes are not submitted @PROJ-101 @checkout-coupon @regression', async ({ checkout }) => {
    for (const code of ['', '   ']) {
      await checkout.applyCoupon(code);
      await checkout.expectMessage('Enter a coupon code');
    }
  });

  test('TC-06 script payload in code is rendered as text @PROJ-101 @checkout-coupon @regression', async ({ checkout, page }) => {
    const dialogs: string[] = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });
    await checkout.applyCoupon('<img src=x onerror=alert(1)>');
    await checkout.expectMessage('Invalid coupon code');
    expect(dialogs).toEqual([]);
  });
});
