import type { Session } from '../../../shared/types';
import { errorCode, type AuthGateway, type DevMail } from '../api/gateway';
import { LOGO, esc, message, type Toaster } from './dom';

type Screen = 'login' | 'register' | 'verify' | 'forgot' | 'reset';

const TITLES: Record<Screen, string> = {
  login: 'Welcome back',
  register: 'Create your account',
  verify: 'Verify your email',
  forgot: 'Recover your password',
  reset: 'Choose a new password',
};

const field = (id: string, label: string, type = 'text', extra = '') =>
  `<label class="field" for="${id}"><span>${label}</span><input id="${id}" name="${id}" type="${type}" ${extra} required></label>`;

/** Sign in, create account, email verification and password recovery. */
export class AuthView {
  private screen: Screen = 'login';
  private email = '';
  private notice = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly gateway: AuthGateway,
    private readonly toaster: Toaster,
    private readonly onSignedIn: (session: Session) => void | Promise<void>,
  ) {}

  show(screen: Screen = 'login', notice = ''): void {
    this.screen = screen;
    this.notice = notice;
    this.render();
  }

  private forms(): Record<Screen, string> {
    const email = esc(this.email);
    const emailField = field('email', 'Email', 'email', `autocomplete="email" value="${email}"`);
    return {
      login: `${emailField}${field('password', 'Password', 'password', 'autocomplete="current-password"')}
        <button class="btn btn-primary btn-block" type="submit">Sign in</button>
        <button class="link" type="button" data-screen="forgot">Forgot your password?</button>`,
      register: `${field('name', 'Name', 'text', 'autocomplete="name" maxlength="60"')}${emailField}
        ${field('password', 'Password', 'password', 'autocomplete="new-password" minlength="8"')}
        <p class="field-hint">At least 8 characters, mixing letters and numbers.</p>
        ${field('confirm', 'Confirm password', 'password', 'autocomplete="new-password"')}
        <button class="btn btn-primary btn-block" type="submit">Create account</button>`,
      verify: `<p class="auth-copy">Enter the 6-digit code we sent to <strong>${email}</strong>.</p>
        ${field('code', 'Verification code', 'text', 'inputmode="numeric" autocomplete="one-time-code" maxlength="6"')}
        <button class="btn btn-primary btn-block" type="submit">Verify email</button>
        <button class="link" type="button" data-resend="verify">Send a new code</button>`,
      forgot: `<p class="auth-copy">Enter your account email and we will send you a reset code.</p>${emailField}
        <button class="btn btn-primary btn-block" type="submit">Send reset code</button>`,
      reset: `<p class="auth-copy">Enter the code sent to <strong>${email}</strong> and choose a new password.</p>
        ${field('code', 'Reset code', 'text', 'inputmode="numeric" autocomplete="one-time-code" maxlength="6"')}
        ${field('password', 'New password', 'password', 'autocomplete="new-password" minlength="8"')}
        ${field('confirm', 'Confirm new password', 'password', 'autocomplete="new-password"')}
        <button class="btn btn-primary btn-block" type="submit">Set new password</button>
        <button class="link" type="button" data-resend="reset">Send a new code</button>`,
    };
  }

  private render(): void {
    const screen = this.screen;
    const tabs =
      screen === 'login' || screen === 'register'
        ? `<div class="tabs" role="tablist">
            <button type="button" role="tab" aria-selected="${screen === 'login'}" data-screen="login">Sign in</button>
            <button type="button" role="tab" aria-selected="${screen === 'register'}" data-screen="register">Create account</button></div>`
        : '<button class="link back-link" type="button" data-screen="login">← Back to sign in</button>';
    const mode =
      this.gateway.mode === 'demo'
        ? '<p class="mode-note">Demo mode: accounts and songs are stored only in this browser.</p>'
        : '';

    this.root.innerHTML = `<section class="auth">
      <div class="auth-card">
        <div class="brand">${LOGO}<span>Nightshade</span></div>
        ${tabs}
        <h1 class="auth-title">${TITLES[screen]}</h1>
        <p class="form-notice" id="auth-notice" ${this.notice ? '' : 'hidden'}>${esc(this.notice)}</p>
        <form id="auth-form" class="auth-form" novalidate>${this.forms()[screen]}</form>
        <p class="form-error" id="auth-error" role="alert"></p>
        ${mode}
      </div></section>`;

    const form = this.root.querySelector<HTMLFormElement>('#auth-form')!;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.submit(form);
    });
    this.root.querySelector('.auth-card')!.addEventListener('click', (event) => this.onClick(event));
    [...form.querySelectorAll<HTMLInputElement>('input')].find((input) => !input.value)?.focus();
  }

  private onClick(event: Event): void {
    const target = (event.target as Element).closest<HTMLElement>('[data-screen], [data-resend]');
    if (!target) return;
    if (target.dataset.screen) {
      const typed = this.root.querySelector<HTMLInputElement>('#email')?.value;
      if (typed) this.email = typed.trim();
      this.show(target.dataset.screen as Screen);
      return;
    }
    const resend =
      target.dataset.resend === 'verify'
        ? () => this.gateway.resendVerification(this.email)
        : () => this.gateway.requestPasswordReset(this.email);
    void this.run(target, async () => {
      this.deliver(await resend());
      this.setNotice('We sent a new code.');
    });
  }

  private async submit(form: HTMLFormElement): Promise<void> {
    const value = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? '';
    const gateway = this.gateway;
    const passwordsMatch = () => {
      if (value('password') !== value('confirm')) throw new Error('The passwords do not match.');
    };
    await this.run(form.querySelector<HTMLButtonElement>('button[type="submit"]')!, async () => {
      switch (this.screen) {
        case 'login': {
          this.email = value('email').trim();
          try {
            await this.onSignedIn(await gateway.login(value('email'), value('password')));
          } catch (error) {
            if (errorCode(error) !== 'EMAIL_NOT_VERIFIED') throw error;
            const mail = await gateway.resendVerification(this.email);
            this.show('verify', 'Your email is not verified yet. We sent you a new code.');
            this.deliver(mail);
          }
          return;
        }
        case 'register': {
          passwordsMatch();
          const mail = await gateway.register(value('name'), value('email'), value('password'));
          this.email = value('email').trim();
          this.show('verify');
          this.deliver(mail);
          return;
        }
        case 'verify':
          await this.onSignedIn(await gateway.verifyEmail(this.email, value('code')));
          return;
        case 'forgot': {
          this.email = value('email').trim();
          if (!this.email) throw new Error('Enter your account email.');
          const mail = await gateway.requestPasswordReset(this.email);
          this.show('reset', 'If an account exists for this email, a reset code is on its way.');
          this.deliver(mail);
          return;
        }
        case 'reset':
          passwordsMatch();
          await gateway.resetPassword(this.email, value('code'), value('password'));
          this.show('login', 'Password updated. Sign in with your new password.');
      }
    });
  }

  private deliver(mail: DevMail | undefined): void {
    if (!mail) return;
    this.toaster.mail(mail, (code) => {
      const input = this.root.querySelector<HTMLInputElement>('#code');
      if (!input) return;
      input.value = code;
      input.focus();
    });
  }

  private setNotice(text: string): void {
    const notice = this.root.querySelector<HTMLElement>('#auth-notice');
    if (!notice) return;
    notice.textContent = text;
    notice.hidden = !text;
  }

  private async run(button: HTMLElement, task: () => Promise<void>): Promise<void> {
    const box = () => this.root.querySelector<HTMLElement>('#auth-error');
    if (box()) box()!.textContent = '';
    button.setAttribute('disabled', '');
    try {
      await task();
    } catch (error) {
      if (box()) box()!.textContent = message(error);
    } finally {
      if (button.isConnected) button.removeAttribute('disabled');
    }
  }
}
