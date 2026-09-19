import { NextResponse } from 'next/server';
import { FAILURE_CODE, FAILURE_MESSAGE, PRODUCT } from '@/lib/demo';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || body.productId !== PRODUCT.id || !Number.isInteger(body.quantity) || body.quantity < 1 || body.quantity > 10) {
    return NextResponse.json({ code: 'INVALID_CART', message: 'Add a product before checking out.' }, { status: 400 });
  }
  if (body.appliedDiscount === 'SAVE20') {
    return NextResponse.json({ code: FAILURE_CODE, message: FAILURE_MESSAGE }, { status: 500 });
  }
  return NextResponse.json({ orderId: 'BR-1042', message: 'Order placed successfully.' });
}
