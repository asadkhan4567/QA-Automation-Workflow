import { test as base, type APIRequestContext } from '@playwright/test';
import { CheckoutPage } from '../pages/checkout.page';

type CartSeed = { cartId: string; subtotal: number };

async function seedCart(request: APIRequestContext): Promise<CartSeed> {
  const res = await request.post('/api/test-support/carts', {
    headers: { Authorization: `Bearer ${process.env.API_TOKEN}` },
    data: { items: [{ sku: 'TSHIRT-RED-M', qty: 2, unitPrice: 25 }] },
  });
  if (!res.ok()) throw new Error(`cart seed failed: ${res.status()}`);
  return (await res.json()) as CartSeed;
}

export const test = base.extend<{ checkout: CheckoutPage; cart: CartSeed }>({
  cart: async ({ request }, use) => {
    const cart = await seedCart(request);
    await use(cart);
    await request.delete(`/api/test-support/carts/${cart.cartId}`, {
      headers: { Authorization: `Bearer ${process.env.API_TOKEN}` },
    });
  },
  checkout: async ({ page, cart }, use) => {
    const checkout = new CheckoutPage(page);
    await checkout.open(cart.cartId);
    await use(checkout);
  },
});

export { expect } from '@playwright/test';
