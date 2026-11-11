import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Button, Field, Icon, Input, Logo, Select, useAuth, useToast } from '../lib/ui.jsx';

const ROLES = [
  { id: 'customer', label: 'I want to shop', icon: 'bag' },
  { id: 'shopper', label: 'I want to shop for others', icon: 'shop' },
  { id: 'rider', label: 'I want to deliver', icon: 'bike' },
  { id: 'merchant', label: 'I own a store', icon: 'box' },
];

export default function AuthScreen() {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', role: 'customer', business_name: '', city: 'Lagos', referral_code: '' });
  const [refCheck, setRefCheck] = useState(null); // null | {valid, message}
  const [reset, setReset] = useState({ sms: false, masked: '', code: '', identifier: '', note: '' });
  const [helpSent, setHelpSent] = useState(false);
  const [params] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const { login, register } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // an invite link looks like /signup?ref=ABCD1234
  useEffect(() => {
    const ref = (params.get('ref') || '').toUpperCase();
    if (ref) { setForm((f) => ({ ...f, referral_code: ref })); setMode('register'); }
  }, []);

  // check the code as they type (public endpoint, no auth)
  useEffect(() => {
    const code = form.referral_code.trim();
    if (!code) { setRefCheck(null); return undefined; }
    const t = setTimeout(() => {
      api.post('/api/referrals/validate', { code })
        .then((r) => setRefCheck({ valid: !!r.valid, message: r.message }))
        .catch(() => setRefCheck(null));
    }, 450);
    return () => clearTimeout(t);
  }, [form.referral_code]);

  const go = (user) => {
    const dest = { admin: '/admin', merchant: '/merchant', shopper: '/worker', rider: '/worker' }[user.role] || '/';
    nav(dest, { replace: true });
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === 'forgot') {
        const identifier = form.email || form.phone;
        const out = await api.post('/api/auth/password/forgot', { identifier });
        setReset({ sms: !!out.sms, masked: out.masked || '', code: '', identifier });
        setMode('reset');
        toast.success(out.sms ? 'Code sent — check your phone.' : 'Request received. See the note below.');
        return;
      }
      if (mode === 'help') {
        await api.post('/api/support/public', { identifier: form.email || form.phone, message: reset.note });
        setHelpSent(true);
        return;
      }
      if (mode === 'reset') {
        await api.post('/api/auth/password/reset', {
          identifier: reset.identifier || form.email || form.phone,
          code: reset.code.trim(),
          password: form.password,
        });
        toast.success('Password changed — sign in with the new one.');
        setMode('login');
        return;
      }
      if (mode === 'login') {
        const user = await login(form.email || form.phone, form.password);
        toast.success(`Welcome back, ${user.name.split(' ')[0]}`);
        go(user);
      } else {
        const res = await register({
          name: form.name,
          email: form.email || undefined,
          phone: form.phone || undefined,
          password: form.password,
          role: form.role,
          city: form.city,
          business_name: form.business_name || undefined,
          referral_code: form.referral_code.trim() || undefined,
        });
        toast.success('Account created — welcome to BUYBUDDY!');
        go(res.user);
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <aside className="auth-art">
        <div className="glow" style={{ width: 320, height: 320, left: -80, bottom: 40 }} />
        <div className="glow" style={{ width: 200, height: 200, right: 40, top: 60 }} />
        <Logo size={40} />
        <div style={{ position: 'relative', zIndex: 2 }}>
          <h1 style={{ fontSize: 40, lineHeight: 1.12, letterSpacing: '-1.2px', fontWeight: 800 }}>
            Anything you need.<br />Delivered by a buddy.
          </h1>
          <p style={{ opacity: 0.82, marginTop: 16, fontSize: 15.5, lineHeight: 1.65, maxWidth: 430 }}>
            Groceries, food, fashion, pharmacy — or send a photo of something you saw in a shop and
            a BUYBUDDY shopper will find it, price it and bring it to your door.
          </p>
          <div className="row wrap" style={{ gap: 10, marginTop: 24 }}>
            {[
              ['bag', 'Groceries in minutes'],
              ['camera', 'Shop for me by photo'],
              ['bike', 'Live rider tracking'],
              ['lock', 'Secure payments'],
            ].map(([icon, label]) => (
              <span key={label} className="badge feature-chip">
                <Icon name={icon} size={13} />{label}
              </span>
            ))}
          </div>
        </div>
        <div style={{ position: 'relative', zIndex: 2, fontSize: 12.5, opacity: 0.7 }}>
          Lagos • Naira payments via Paystack • Built for Nigeria
        </div>
      </aside>

      <section className="auth-form">
        <div className="hide-sm" style={{ marginBottom: 22 }}><Logo tagline /></div>
        <div className="show-sm auth-brand">
          <Logo size={52} />
          <div className="auth-brand-line">Your personal shopping partner</div>
        </div>
        <div className="h1">
          {mode === 'login'
            ? 'Welcome back'
            : mode === 'register'
              ? 'Create your account'
              : mode === 'help'
                ? 'Ask support for a code'
                : 'Get back into your account'}
        </div>
        <p className="sub" style={{ marginTop: 4, marginBottom: 20 }}>
          {mode === 'login'
            ? 'Sign in to shop, sell, or earn with BUYBUDDY.'
            : mode === 'register'
              ? 'It takes less than a minute.'
              : mode === 'forgot'
                ? 'Tell us the phone number or email on the account and we will send a 6-digit code.'
                : mode === 'help'
                  ? 'You do not need to be signed in. Support reads this and texts you a 6-digit reset code.'
                  : 'Type the code you were given, then pick a new password.'}
        </p>

        <form onSubmit={submit} className="col" style={{ gap: 14 }}>
          {mode === 'register' && (
            <>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                {ROLES.map((r) => (
                  <button
                    type="button"
                    key={r.id}
                    onClick={() => setForm((f) => ({ ...f, role: r.id }))}
                    className="btn"
                    style={{
                      flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '11px 12px', height: 66,
                      background: form.role === r.id ? 'var(--green-50)' : '#fff',
                      border: `1.5px solid ${form.role === r.id ? 'var(--green-600)' : 'var(--line)'}`,
                      color: form.role === r.id ? 'var(--green-800)' : 'var(--ink-2)',
                      fontSize: 12.5, whiteSpace: 'normal', textAlign: 'left',
                    }}
                  >
                    <span className="role-glyph"><Icon name={r.icon} size={17} /></span>
                    {r.label}
                  </button>
                ))}
              </div>
              <Field label="Full name">
                <Input value={form.name} onChange={set('name')} placeholder="Tunde Bakare" required />
              </Field>
              {form.role === 'merchant' && (
                <Field label="Business name">
                  <Input value={form.business_name} onChange={set('business_name')} placeholder="GreenMart Supermarket" />
                </Field>
              )}
            </>
          )}

          {mode !== 'reset' && (
            <Field
              label={mode === 'login' || mode === 'forgot' || mode === 'help' ? 'Email or phone number' : 'Email address'}
              hint={mode === 'forgot' || mode === 'help' ? 'Either one works — whichever you signed up with.' : undefined}
            >
              <Input
                value={form.email}
                onChange={set('email')}
                placeholder={mode === 'login' || mode === 'forgot' ? 'you@example.com or 0803…' : 'you@example.com'}
                autoComplete="username"
                required={mode === 'login' || mode === 'forgot' || mode === 'help' || !form.phone}
              />
            </Field>
          )}

          {mode === 'register' && (
            <Field label="Phone number" hint="Nigerian numbers only — used for verification and delivery calls.">
              <Input value={form.phone} onChange={set('phone')} placeholder="0803 123 4567" inputMode="tel" />
            </Field>
          )}

          {mode === 'register' && form.role === 'customer' && (
            <Field
              label="Referral code (optional)"
              hint={
                refCheck
                  ? refCheck.message
                  : 'Got an invite from a friend? Enter their code and you both get a reward.'
              }
            >
              <Input
                value={form.referral_code}
                onChange={(e) => setForm((f) => ({ ...f, referral_code: e.target.value.toUpperCase() }))}
                placeholder="ABCD1234"
                maxLength={12}
                style={{
                  textTransform: 'uppercase', letterSpacing: 2, fontWeight: 700,
                  borderColor: refCheck ? (refCheck.valid ? 'var(--green-600)' : 'var(--danger)') : undefined,
                }}
              />
            </Field>
          )}

          {mode === 'help' && (
            helpSent ? (
              <div className="panel" style={{ padding: '12px 14px', fontSize: 13, lineHeight: 1.6, background: 'var(--green-50)', border: '1px solid var(--green-200)' }}>
                <strong>Message sent.</strong> Support will text a 6-digit code to the phone number on
                your account, usually within a few hours. Then open this screen again, tap{' '}
                <strong>Forgot your password?</strong>, and type the code there.
              </div>
            ) : (
              <Field label="What is the problem?" hint="For example: “I forgot my password and the phone number on my account is 0803…”">
                <textarea
                  className="input"
                  rows={4}
                  value={reset.note}
                  onChange={(e) => setReset((r) => ({ ...r, note: e.target.value }))}
                  placeholder="Tell us what happened and the best number to reach you on."
                  required
                />
              </Field>
            )
          )}

          {mode === 'reset' && (
            <>
              <div
                className="panel"
                style={{
                  padding: '12px 14px', fontSize: 13, lineHeight: 1.6,
                  background: reset.sms ? 'var(--green-50)' : '#FFF8EC',
                  border: `1px solid ${reset.sms ? 'var(--green-200)' : '#F3DDB4'}`,
                }}
              >
                {reset.sms ? (
                  <>We texted a 6-digit code to <strong>{reset.masked}</strong>. It works for 15 minutes.</>
                ) : (
                  <>
                    <strong>We could not text the code automatically yet.</strong> Tap{' '}
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => { setHelpSent(false); setMode('help'); }}
                    >
                      Ask support for a code
                    </button>{' '}
                    and we will text it to the phone number on your account. Then type it below.
                  </>
                )}
              </div>
              <Field label="6-digit code">
                <Input
                  value={reset.code}
                  onChange={(e) => setReset((r) => ({ ...r, code: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
                  placeholder="123456"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  style={{ letterSpacing: 6, fontWeight: 700, fontSize: 18 }}
                  required
                />
              </Field>
            </>
          )}

          {mode !== 'forgot' && mode !== 'help' && (
            <Field
              label={mode === 'reset' ? 'New password' : 'Password'}
              hint={mode === 'login' ? undefined : 'At least 8 characters.'}
            >
              <Input
                type="password"
                value={form.password}
                onChange={set('password')}
                placeholder="••••••••"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
              />
            </Field>
          )}

          {mode === 'login' && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ alignSelf: 'flex-end', marginTop: -6 }}
              onClick={() => setMode('forgot')}
            >
              Forgot your password?
            </button>
          )}

          <Button type="submit" size="lg" block disabled={busy || (mode === 'help' && helpSent)}>
            {busy
              ? 'Please wait…'
              : mode === 'login'
                ? 'Sign in'
                : mode === 'register'
                  ? 'Create account'
                  : mode === 'forgot'
                    ? 'Send me a code'
                    : mode === 'help'
                      ? 'Send to support'
                      : 'Set new password'}
          </Button>
        </form>

        <div className="row-between" style={{ marginTop: 14 }}>
          <span className="sub">
            {mode === 'login' ? 'New to BUYBUDDY?' : mode === 'register' ? 'Already have an account?' : 'Remembered it?'}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? 'Create account' : 'Sign in'}
          </button>
        </div>

        {mode === 'login' && (
          <p className="tiny muted" style={{ marginTop: 10 }}>
            Cannot get in at all?{' '}
            <button
              className="linkish"
              onClick={() => { setHelpSent(false); setMode('help'); }}
            >
              Ask support for a code
            </button>
          </p>
        )}

        <p className="tiny muted" style={{ marginTop: 16, lineHeight: 1.7 }}>
          <Icon name="lock" size={12} style={{ verticalAlign: -1 }} /> Payments are processed securely.
          By continuing you agree to our{' '}
          <a className="legal-link" href="/legal/terms.html" target="_blank" rel="noopener">Terms</a>{' '}
          and{' '}
          <a className="legal-link" href="/legal/privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.
        </p>
      </section>
    </div>
  );
}
