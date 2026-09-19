'use client';

import { useState, type FormEvent } from 'react';
import { CHECKOUT_PATH, PRODUCT } from '@/lib/demo';
import { Icon } from './icon';

export function DemoStore() {
  const [quantity, setQuantity] = useState(0);
  const [code, setCode] = useState('');
  const [appliedDiscount, setAppliedDiscount] = useState('');
  const [discountMessage, setDiscountMessage] = useState('');
  const [checkoutState, setCheckoutState] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');

  function applyDiscount(event: FormEvent) {
    event.preventDefault();
    if (code.trim().toUpperCase() === 'SAVE20') {
      setAppliedDiscount('SAVE20');
      setDiscountMessage('SAVE20 applied. You saved 20%.');
    } else {
      setAppliedDiscount('');
      setDiscountMessage('Discount code not recognized. Try SAVE20.');
    }
    setCheckoutState('idle');
  }

  async function checkout() {
    setCheckoutState('pending');
    setError('');
    try {
      const response = await fetch(CHECKOUT_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: PRODUCT.id, quantity, appliedDiscount }),
      });
      const result = await response.json();
      if (!response.ok) {
        console.error(`${result.code}: ${result.message}`);
        setError(result.message);
        setCheckoutState('error');
      } else {
        setCheckoutState('success');
      }
    } catch {
      console.error('CHECKOUT_NETWORK_ERROR: Checkout could not reach the server.');
      setError('Could not reach checkout. Please try again.');
      setCheckoutState('error');
    }
  }

  return <main className="store-page" data-checkout-state={checkoutState}><div className="store-container">
    <header className="store-header"><div className="store-brand"><span className="store-wordmark">studio.</span><h1>Demo Store</h1></div><span className="store-environment"><span className="status-dot" />BugReel sandbox</span></header>
    <div className="store-intro"><span>LESS NOISE. MORE FOCUS.</span><h2>Good things for deep work.</h2></div>
    <div className="store-grid">
      <section className="product-card"><div className="product-illustration"><span className="product-tag">THE EVERYDAY ESSENTIAL</span>
        <svg viewBox="0 0 320 270" role="img" aria-label="Graphite over-ear Studio Headphones"><defs><linearGradient id="headband" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#737d6b" /><stop offset=".5" stopColor="#333e32" /><stop offset="1" stopColor="#707a64" /></linearGradient><linearGradient id="earcup" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#5b6750" /><stop offset=".5" stopColor="#3a4633" /><stop offset="1" stopColor="#262f24" /></linearGradient><radialGradient id="earpad"><stop stopColor="#30382b" /><stop offset=".75" stopColor="#252e21" /><stop offset="1" stopColor="#46503c" /></radialGradient></defs><ellipse cx="165" cy="240" rx="80" ry="9" fill="#243521" opacity=".12" /><g transform="rotate(-12 160 130)"><path d="M74 156v-37c0-51 34-83 85-83s87 32 87 83v37" fill="none" stroke="url(#headband)" strokeWidth="20" strokeLinecap="round" /><path d="M79 133v-14c0-45 30-75 80-75s80 30 80 75v14" fill="none" stroke="#87917c" strokeWidth="3" opacity=".55" /><path d="M88 114c2-37 27-60 71-60 41 0 68 22 71 60" fill="none" stroke="#242d20" strokeWidth="8" strokeLinecap="round" /><path d="M75 133v62m169-62v62" stroke="#a2aa99" strokeWidth="5" /><rect x="52" y="139" width="49" height="85" rx="22" fill="url(#earcup)" /><ellipse cx="97" cy="181" rx="20" ry="44" fill="url(#earpad)" /><ellipse cx="101" cy="181" rx="10" ry="28" fill="#1b2418" /><rect x="219" y="139" width="50" height="85" rx="22" fill="url(#earcup)" /><ellipse cx="224" cy="181" rx="19" ry="43" fill="url(#earpad)" /><ellipse cx="220" cy="181" rx="10" ry="28" fill="#1b2418" /><path d="M258 159v36" stroke="#909a82" strokeWidth="2" opacity=".5" /><circle cx="68" cy="203" r="2" fill="#a6bf87" /></g></svg>
      </div><div className="product-details"><div className="product-topline"><h3>{PRODUCT.name}</h3><strong>${PRODUCT.price.toFixed(2)}</strong></div><p>Thoughtful sound. Made for deep work.<br />Wireless, noise-cancelling, and comfortable all day.</p><div className="product-meta"><span><i className="product-swatch" />Graphite</span><span><Icon name="check" size={12} />In stock</span><span>Free shipping</span></div><button data-testid="add-to-cart" disabled={quantity >= 10 || checkoutState === 'pending'} onClick={() => { setQuantity(q => q + 1); setCheckoutState('idle'); }} className="store-button"><span>Add to Cart</span><Icon name="arrow" size={16} /></button></div></section>
      <section className="cart-card"><div className="cart-title"><h2>Your cart</h2><span data-testid="cart-count" className="cart-count">{quantity} {quantity === 1 ? 'item' : 'items'}</span></div>
        {quantity ? <div className="cart-product"><div className="cart-product-icon"><svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 15V9a8 8 0 0 1 16 0v6" /><rect x="2" y="12" width="5" height="9" rx="2" /><rect x="17" y="12" width="5" height="9" rx="2" /></svg></div><div className="cart-product-info"><strong>{PRODUCT.name}</strong><p>Graphite / Qty {quantity}</p></div><strong>${(PRODUCT.price * quantity).toFixed(2)}</strong></div> : <div className="empty-cart">Your cart is waiting.<br />Add a pair of Studio Headphones to get started.</div>}
        <form onSubmit={applyDiscount} data-testid="discount-form" className="discount-form"><label htmlFor="discount">Have a discount code?</label><div className="discount-controls"><input id="discount" name="discount" data-testid="discount-code" aria-label="Discount code" placeholder="Try SAVE20" autoComplete="off" disabled={checkoutState === 'pending'} value={code} onChange={event => setCode(event.target.value)} /><button data-testid="apply-discount" disabled={checkoutState === 'pending'} type="submit">Apply Discount</button></div><p data-testid="discount-message" className="discount-message">{discountMessage}</p>{appliedDiscount && <span data-testid="discount-applied" className="discount-success"><Icon name="check" size={12} />20% discount active</span>}</form>
        <div className="price-lines"><div><span>Subtotal</span><span>${(PRODUCT.price * quantity).toFixed(2)}</span></div><div><span>Shipping</span><span>Free</span></div>{appliedDiscount && <div><span>Discount (SAVE20)</span><span>−${(PRODUCT.price * quantity * 0.2).toFixed(2)}</span></div>}</div><div className="cart-total"><span>Total</span><strong data-testid="cart-total">${(PRODUCT.price * quantity * (appliedDiscount ? 0.8 : 1)).toFixed(2)}</strong></div>
        <button data-testid="checkout" disabled={!quantity || checkoutState === 'pending'} onClick={checkout} className="store-button"><span>{checkoutState === 'pending' ? 'Processing…' : 'Checkout'}</span>{checkoutState === 'pending' ? <span className="spinner" /> : <Icon name="arrow" size={16} />}</button>
        {checkoutState === 'error' && <div role="alert" data-testid="checkout-error" className="checkout-error"><Icon name="alert" size={17} /><div><strong>Checkout failed</strong><p>{error}</p><p>Your cart is safe. No payment was taken.</p></div></div>}
        {checkoutState === 'success' && <div role="status" data-testid="checkout-success" className="checkout-success"><Icon name="check" size={16} /><span>Order placed successfully.<br />Demo order BR-1042. No payment was taken.</span></div>}
        <p className="store-cart-note">A demo experience. No real purchases or payments.</p>
      </section>
    </div>
    <aside className="store-guide"><Icon name="activity" size={18} /><p><strong>BUGREEL REPRODUCTION SCENARIO</strong>Add to Cart → enter <code>SAVE20</code> → Apply Discount → Checkout.</p></aside><footer className="store-footer"><span>studio. / Objects for a quieter day.</span><span>Demo Store · Powered by BugReel</span></footer>
  </div></main>;
}
