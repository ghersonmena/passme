import nodemailer from 'nodemailer'
import type { SmtpConfig } from './config.js'

export interface Mail {
  to: string
  subject: string
  text: string
  html: string
}

export interface Mailer {
  send(mail: Mail): Promise<void>
}

// Sin SMTP configurado no hay correo: la app muestra el enlace para compartirlo a mano
export function createMailer(smtp: SmtpConfig | null): Mailer | null {
  if (!smtp) return null
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    // 465 = TLS desde el inicio; 587 = STARTTLS, que se exige para no mandar la contraseña en claro
    secure: smtp.port === 465,
    requireTLS: smtp.port !== 465,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined
  })
  return {
    async send(mail) {
      await transport.sendMail({ from: smtp.from, ...mail })
    }
  }
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const INVITE_TEXT = {
  es: {
    subject: 'Te invitaron a PassMe',
    intro: (by: string) => `${by} te invitó a crear tu cuenta en su gestor de contraseñas PassMe.`,
    action: 'Crear mi cuenta',
    expires: (days: number) => `El enlace sirve una sola vez y vence en ${days} días.`,
    ignore: 'Si no esperabas esta invitación, ignora este correo.'
  },
  en: {
    subject: "You're invited to PassMe",
    intro: (by: string) => `${by} invited you to create your account on their PassMe password manager.`,
    action: 'Create my account',
    expires: (days: number) => `The link works once and expires in ${days} days.`,
    ignore: "If you weren't expecting this invitation, ignore this email."
  }
}

export function inviteMail(to: string, link: string, invitedBy: string, lang: 'es' | 'en', days: number): Mail {
  const t = INVITE_TEXT[lang]
  const text = `${t.intro(invitedBy)}\n\n${t.action}: ${link}\n\n${t.expires(days)}\n${t.ignore}\n`
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f8f5f9;font-family:system-ui,sans-serif;color:#22142a">
<div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e3d8e6;border-radius:14px;padding:28px">
<p style="margin:0 0 6px;font-size:20px;font-weight:700;color:#7c2d92">PassMe</p>
<p style="font-size:15px;line-height:1.5">${escape(t.intro(invitedBy))}</p>
<p style="margin:24px 0"><a href="${escape(link)}" style="display:inline-block;background:#7c2d92;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600">${escape(t.action)}</a></p>
<p style="font-size:13px;color:#6b5a72;line-height:1.5">${escape(t.expires(days))}<br>${escape(t.ignore)}</p>
<p style="font-size:12px;color:#6b5a72;word-break:break-all">${escape(link)}</p>
</div></body></html>`
  return { to, subject: t.subject, text, html }
}
