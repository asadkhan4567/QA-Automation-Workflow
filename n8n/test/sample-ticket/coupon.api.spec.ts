import { test, expect } from '@playwright/test';

const auth = { Authorization: `Bearer ${process.env.API_TOKEN}` };

async function newCart(request: import('@playwright/test').APIRequestContext): Promise<string> {
  const res = await request.post('/api/test-support/carts', { headers: auth, data: { items: [{ sku: 'TSHIRT-RED-M', qty: 2, unitPrice: 25 }] } });
  expect(res.status()).toBe(201);
  return (await res.json()).cartId as string;
}

test.describe('POST /api/cart/{cartId}/coupon', () => {
  test('TC-07 200 valid code returns discount and total @api @PROJ-101 @checkout-coupon', async ({ request }) => {
    const cartId = await newCart(request);
    const res = await request.post(`/api/cart/${cartId}/coupon`, { headers: auth, data: { code: 'SAVE10' } });
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ code: 'SAVE10', discount: 5, total: 45 });
  });

  test('TC-08 410 expired code @api @PROJ-101 @checkout-coupon', async ({ request }) => {
    const cartId = await newCart(request);
    const res = await request.post(`/api/cart/${cartId}/coupon`, { headers: auth, data: { code: 'SUMMER2025' } });
    expect(res.status()).toBe(410);
    expect((await res.json()).error).toBe('This coupon has expired');
  });

  test('TC-09 400 missing code @api @PROJ-101 @checkout-coupon', async ({ request }) => {
    const cartId = await newCart(request);
    const res = await request.post(`/api/cart/${cartId}/coupon`, { headers: auth, data: {} });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe('code is required');
  });

  test('TC-10 401 without token @api @PROJ-101 @checkout-coupon', async ({ request }) => {
    const res = await request.post('/api/cart/any-cart/coupon', { data: { code: 'SAVE10' } });
    expect(res.status()).toBe(401);
  });

  test("TC-11 404 for another user's cart @api @PROJ-101 @checkout-coupon", async ({ request }) => {
    const res = await request.post('/api/cart/cart-owned-by-someone-else/coupon', { headers: auth, data: { code: 'SAVE10' } });
    expect(res.status()).toBe(404);
  });

  test("TC-12 SQL injection in code is rejected @api @PROJ-101 @checkout-coupon", async ({ request }) => {
    const cartId = await newCart(request);
    const res = await request.post(`/api/cart/${cartId}/coupon`, { headers: auth, data: { code: "' OR 1=1 --" } });
    expect(res.status()).toBe(400);
    expect(JSON.stringify(await res.json())).not.toMatch(/sql|syntax|stack/i);
  });
});
